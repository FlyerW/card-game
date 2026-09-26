import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CardDb } from '@card-game/engine';
import { newProfile, parseProfile, refreshDay, starterDecks, type Profile } from '@card-game/economy';
import type { GoogleIdentity } from './google';

// 帳號：用 Google 登入的玩家，金幣與收藏存在伺服器上。整份資料存成一個 JSON 檔（試玩階段夠用，
// 玩家多了再換資料庫）。寫檔先寫暫存檔再改名，寫到一半當機也不會把舊資料弄壞。
// 登入後發一個隨機的 session token 給瀏覽器；檔案裡只存它的雜湊，檔案外流也拿不到能用的 token。

const SESSION_DAYS = 30;

export interface Account {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
  profile: Profile;
  createdAt: string;
}

/** 給瀏覽器看的帳號資料。 */
export interface AccountInfo {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
}

interface Data {
  accounts: Record<string, Account>;
  /** session token 的 SHA-256 → 哪個帳號、什麼時候過期（毫秒）。 */
  sessions: Record<string, { accountId: string; expires: number }>;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** 伺服器的日期（本地時間），每日任務照這個換日。 */
export function serverDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const accountInfo = (account: Account): AccountInfo => ({
  id: account.id,
  name: account.name,
  email: account.email,
  picture: account.picture,
});

export class AccountStore {
  private data: Data = { accounts: {}, sessions: {} };
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string | null,
    private readonly db: CardDb,
  ) {}

  /** 從資料夾讀出帳號；dir 是 null 就只放在記憶體（測試用）。 */
  static async open(dir: string | null, db: CardDb): Promise<AccountStore> {
    const store = new AccountStore(dir === null ? null : join(dir, 'accounts.json'), db);
    if (dir !== null) {
      await mkdir(dir, { recursive: true });
      try {
        const raw = JSON.parse(await readFile(store.file!, 'utf8')) as Data;
        for (const [id, account] of Object.entries(raw.accounts ?? {})) {
          const profile = parseProfile(account.profile);
          if (profile) store.data.accounts[id] = { ...account, profile };
        }
        store.data.sessions = raw.sessions ?? {};
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return store;
  }

  /** Google 登入：第一次來就開新帳號（五個英雄的起始牌組），發一個新的 session。 */
  async login(identity: GoogleIdentity, now = Date.now()): Promise<{ token: string; account: Account }> {
    const id = `google:${identity.sub}`;
    const existing = this.data.accounts[id];
    const name = identity.name ?? identity.email?.split('@')[0] ?? '玩家';
    const account: Account = existing
      ? { ...existing, name, email: identity.email, picture: identity.picture }
      : { id, name, email: identity.email, picture: identity.picture, profile: newProfile(serverDay(), starterDecks(this.db)), createdAt: new Date(now).toISOString() };
    this.data.accounts[id] = account;
    const token = randomBytes(32).toString('hex');
    this.data.sessions[hash(token)] = { accountId: id, expires: now + SESSION_DAYS * 24 * 3600 * 1000 };
    // 順便清掉過期的 session。
    for (const [key, session] of Object.entries(this.data.sessions)) if (session.expires < now) delete this.data.sessions[key];
    await this.save();
    return { token, account };
  }

  /** 用 session token 找帳號；換日的話先把每日資料換成今天的。 */
  byToken(token: string, now = Date.now()): Account | null {
    const session = this.data.sessions[hash(token)];
    if (!session || session.expires < now) return null;
    const account = this.data.accounts[session.accountId];
    if (!account) return null;
    account.profile = refreshDay(account.profile, serverDay(new Date(now)));
    return account;
  }

  async logout(token: string): Promise<void> {
    delete this.data.sessions[hash(token)];
    await this.save();
  }

  /** 改一個帳號的玩家資料並存檔。 */
  async update(account: Account, profile: Profile): Promise<void> {
    account.profile = profile;
    await this.save();
  }

  /** 一次只寫一個，後面的排隊。 */
  private save(): Promise<void> {
    if (this.file === null) return Promise.resolve();
    const file = this.file;
    const text = JSON.stringify(this.data);
    // 上一次寫失敗不影響這一次。
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await writeFile(`${file}.tmp`, text);
      await rename(`${file}.tmp`, file);
    });
    return this.writing;
  }
}

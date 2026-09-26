import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CardDb } from '@card-game/engine';
import {
  applyRankedResult,
  newProfile,
  newRank,
  parseProfile,
  parseRank,
  recordGame,
  refreshDay,
  rolloverSeason,
  seasonOf,
  starterDecks,
  type GameSummary,
  type Profile,
  type RankState,
} from '@card-game/economy';
import type { GoogleIdentity } from './google';
import type { RankedReport } from './protocol';

// 帳號：用 Google 登入、或開訪客帳號的玩家，金幣、收藏與牌位存在伺服器上。整份資料存成一個 JSON 檔（試玩階段夠用，
// 玩家多了再換資料庫）。寫檔先寫暫存檔再改名，寫到一半當機也不會把舊資料弄壞。
// 登入後發一個隨機的 session token 給瀏覽器；檔案裡只存它的雜湊，檔案外流也拿不到能用的 token。

const SESSION_DAYS = 30;

export interface Account {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
  profile: Profile;
  /** 這季的牌位；沒打過排位就是 undefined。 */
  rank?: RankState;
  /** 換季發的獎勵，下次打開網頁時告訴玩家，說過就清掉。 */
  seasonReward?: { season: string; best: number; gold: number };
  createdAt: string;
}


export interface LeaderboardRow {
  name: string;
  tier: number;
  stars: number;
  mmr: number;
  wins: number;
  losses: number;
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
          if (!profile) continue;
          const { rank: savedRank, ...rest } = account;
          const rank = savedRank === undefined ? null : parseRank(savedRank);
          store.data.accounts[id] = rank ? { ...rest, profile, rank } : { ...rest, profile };
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
    const token = this.issueSession(id, now);
    await this.save();
    return { token, account };
  }

  /** 訪客帳號：不用 Google，取個名字就開一個存在伺服器上的帳號（試玩、排位用）。 */
  async loginGuest(name: string, now = Date.now()): Promise<{ token: string; account: Account }> {
    const id = `guest:${randomBytes(12).toString('hex')}`;
    const clean = name.trim().slice(0, 16) || '訪客';
    const account: Account = {
      id,
      name: clean,
      email: null,
      picture: null,
      profile: newProfile(serverDay(new Date(now)), starterDecks(this.db)),
      createdAt: new Date(now).toISOString(),
    };
    this.data.accounts[id] = account;
    const token = this.issueSession(id, now);
    await this.save();
    return { token, account };
  }

  private issueSession(accountId: string, now: number): string {
    const token = randomBytes(32).toString('hex');
    this.data.sessions[hash(token)] = { accountId, expires: now + SESSION_DAYS * 24 * 3600 * 1000 };
    // 順便清掉過期的 session。
    for (const [key, session] of Object.entries(this.data.sessions)) if (session.expires < now) delete this.data.sessions[key];
    return token;
  }

  byId(id: string): Account | null {
    return this.data.accounts[id] ?? null;
  }

  /** 這季的牌位；換季了就先發上季的獎勵、重置。 */
  rankOf(account: Account, now = Date.now()): RankState {
    const season = seasonOf(serverDay(new Date(now)));
    if (!account.rank) {
      account.rank = newRank(season);
      return account.rank;
    }
    const rolled = rolloverSeason(account.rank, season);
    if (rolled) {
      account.rank = rolled.rank;
      if (rolled.gold > 0) {
        account.profile = { ...account.profile, gold: account.profile.gold + rolled.gold };
        account.seasonReward = { season: rolled.previousSeason, best: rolled.previousBest, gold: rolled.gold };
      }
      void this.save();
    }
    return account.rank;
  }

  /** 讀過換季獎勵的通知就清掉。 */
  async clearSeasonReward(account: Account): Promise<void> {
    delete account.seasonReward;
    await this.save();
  }

  /**
   * 記下一場排位賽：雙方的牌位（照對方比賽前的隱藏分數算）與每日任務、贏場金幣。
   * 結果由伺服器上的對局決定，不是瀏覽器回報的。
   */
  async recordRanked(
    players: [{ id: string; summary: GameSummary }, { id: string; summary: GameSummary }],
    now = Date.now(),
  ): Promise<[RankedReport, RankedReport] | null> {
    const accounts = players.map((player) => this.byId(player.id));
    if (!accounts[0] || !accounts[1]) return null;
    const day = serverDay(new Date(now));
    const before = accounts.map((account) => ({ ...this.rankOf(account!, now) })) as [RankState, RankState];
    const reports = players.map((player, i): RankedReport => {
      const account = accounts[i]!;
      const change = applyRankedResult(before[i]!, player.summary.won, before[1 - i]!.mmr);
      account.rank = change.rank;
      const reward = recordGame(account.profile, player.summary, day);
      account.profile = reward.profile;
      return { won: player.summary.won, before: before[i]!, after: change.rank, starsDelta: change.starsDelta, promoted: change.promoted, demoted: change.demoted, reward };
    }) as [RankedReport, RankedReport];
    await this.save();
    return reports;
  }

  /** 這季排位前幾名：段位、星星、隱藏分數依序比。 */
  leaderboard(limit = 20, now = Date.now()): LeaderboardRow[] {
    const season = seasonOf(serverDay(new Date(now)));
    return Object.values(this.data.accounts)
      .filter((account) => account.rank?.season === season && account.rank.wins + account.rank.losses > 0)
      .map((account) => ({ name: account.name, ...account.rank! }))
      .sort((x, y) => y.tier - x.tier || y.stars - x.stars || y.mmr - x.mmr)
      .slice(0, limit)
      .map(({ name, tier, stars, mmr, wins, losses }) => ({ name, tier, stars, mmr: Math.round(mmr), wins, losses }));
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

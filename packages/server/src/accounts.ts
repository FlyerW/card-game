import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { copyLimit, DEFAULT_RULES, type CardDb } from '@card-game/engine';
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
  withStarterCards,
  unlimitedProfile,
  type GameSummary,
  type Profile,
  type RankState,
  type Topup,
  cleanBook,
  type DeckBook,
} from '@card-game/economy';
import type { GoogleIdentity } from './google';
import type { RankedReport } from './protocol';

// 帳號：用 Google 登入、或用名字＋密碼開帳號的玩家，金幣、收藏與牌位存在伺服器上。
// 存在 SQLite（data/accounts.sqlite，Node 內建的 node:sqlite）：一個帳號一列，改了哪個帳號就只寫那一列，
// 帳號再多存檔也不會變慢（以前整份 JSON 重寫，5000 個帳號一次要卡住伺服器 65 毫秒）。開伺服器時全部讀進記憶體。
// 舊的 data/accounts.json 第一次開時自動搬進來，原檔改名留著（accounts.migrated-*.json）。
// 登入後發一個隨機的 session token 給瀏覽器；資料庫裡只存它的雜湊，外流也拿不到能用的 token。

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
  /** 名字＋密碼帳號的密碼（scrypt 雜湊）；Google 帳號沒有。舊的訪客帳號也沒有，第一次用名字登入時設定。 */
  password?: { salt: string; hash: string };
  /** 牌組清單：同一個英雄可以有很多副，記住每個英雄開局用哪一副。存在伺服器上，換裝置也在。 */
  deckBook?: DeckBook;
  /** 超級帳號：金幣用不完、全卡。只能用管理指令開（npm run admin -- unlimited 名字），網頁改不了。 */
  unlimited?: boolean;
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
  /** 超級帳號：網頁切到預覽模式，看得到還沒發布的卡包。 */
  preview?: boolean;
}

interface Data {
  accounts: Record<string, Account>;
  /** session token 的 SHA-256 → 哪個帳號、什麼時候過期（毫秒）。 */
  sessions: Record<string, { accountId: string; expires: number }>;
  /** 儲值訂單：訂單編號 → 訂單。 */
  orders: Record<string, Order>;
}

/** 一筆儲值訂單。付款成功的通知來了才加金幣，同一筆只加一次。 */
export interface Order {
  tradeNo: string;
  accountId: string;
  topup: string;
  /** 新台幣。 */
  amount: number;
  gold: number;
  status: 'pending' | 'paid';
  createdAt: string;
  paidAt?: string;
  /** 綠界的交易編號。 */
  ecpayTradeNo?: string;
  /** 綠界測試環境後台的「模擬付款」。 */
  simulated?: boolean;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** 登入、註冊失敗的原因，直接給玩家看。 */
export class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const NAME_LIMIT = 16;
const PASSWORD_MIN = 4;

// scrypt 很吃 CPU（一次約 20 毫秒）：用非同步版本在背景執行緒算，才不會卡住整個伺服器。參數跟以前一樣，舊密碼照樣對得上。
const scryptAsync = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;

async function hashPassword(password: string, salt = randomBytes(16).toString('hex')): Promise<{ salt: string; hash: string }> {
  return { salt, hash: (await scryptAsync(password, salt, 32)).toString('hex') };
}

async function checkPassword(password: string, stored: { salt: string; hash: string }): Promise<boolean> {
  const attempt = Buffer.from((await hashPassword(password, stored.salt)).hash, 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  return attempt.length === expected.length && timingSafeEqual(attempt, expected);
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** 檔名用的時間：這台機器的當地時間，例如 20260930-1435。 */
function stampOf(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

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
  ...(account.unlimited ? { preview: true } : {}),
});

/** 每天自動備份幾份（data/backups/accounts-YYYYMMDD.sqlite），多的刪掉。 */
const BACKUPS_KEPT = 14;

/** 帳號資料庫：帳號、session、儲值訂單各一張表，內容存成 JSON（跟以前的 accounts.json 一樣的格式）。 */
class AccountDb {
  private readonly sql: DatabaseSync;

  constructor(file: string | null) {
    // 用到才載入 node:sqlite：它會印一行「實驗中」的警告，這時 quiet-warnings.ts 已經裝好了、會把它藏起來。
    const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    this.sql = new Database(file ?? ':memory:');
    // WAL：寫入不會擋住讀取，當機也不會把資料庫弄壞。
    this.sql.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (trade_no TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
  }

  load(): Data {
    const data: Data = { accounts: {}, sessions: {}, orders: {} };
    for (const row of this.sql.prepare('SELECT id, data FROM accounts').all() as { id: string; data: string }[]) data.accounts[row.id] = JSON.parse(row.data);
    for (const row of this.sql.prepare('SELECT hash, account_id, expires FROM sessions').all() as { hash: string; account_id: string; expires: number }[]) {
      data.sessions[row.hash] = { accountId: row.account_id, expires: row.expires };
    }
    for (const row of this.sql.prepare('SELECT trade_no, data FROM orders').all() as { trade_no: string; data: string }[]) data.orders[row.trade_no] = JSON.parse(row.data);
    return data;
  }

  /** 舊的 accounts.json 整份搬進來（一個交易，搬到一半失敗就全部不算）。 */
  import(data: Partial<Data>): void {
    this.sql.exec('BEGIN');
    try {
      for (const account of Object.values(data.accounts ?? {})) this.putAccount(account);
      for (const [key, session] of Object.entries(data.sessions ?? {})) this.putSession(key, session);
      for (const order of Object.values(data.orders ?? {})) this.putOrder(order);
      this.sql.exec('COMMIT');
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }

  putAccount(account: Account): void {
    this.sql.prepare('INSERT INTO accounts (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(account.id, JSON.stringify(account));
  }

  deleteAccount(id: string): void {
    this.sql.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    this.sql.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
  }

  putSession(key: string, session: { accountId: string; expires: number }): void {
    this.sql.prepare('INSERT OR REPLACE INTO sessions (hash, account_id, expires) VALUES (?, ?, ?)').run(key, session.accountId, session.expires);
  }

  deleteSession(key: string): void {
    this.sql.prepare('DELETE FROM sessions WHERE hash = ?').run(key);
  }

  deleteExpiredSessions(now: number): void {
    this.sql.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
  }

  putOrder(order: Order): void {
    this.sql.prepare('INSERT INTO orders (trade_no, data) VALUES (?, ?) ON CONFLICT(trade_no) DO UPDATE SET data = excluded.data').run(order.tradeNo, JSON.stringify(order));
  }

  /** 完整複製一份到 file（資料庫開著、有人在寫也可以）。 */
  backup(file: string): void {
    this.sql.prepare('VACUUM INTO ?').run(file);
  }

  close(): void {
    this.sql.close();
  }
}

export class AccountStore {
  private data: Data = { accounts: {}, sessions: {}, orders: {} };

  private constructor(
    private readonly rows: AccountDb,
    private readonly dir: string | null,
    private readonly db: CardDb,
    private readonly previewDb: CardDb,
  ) {}

  /**
   * 從資料夾讀出帳號；dir 是 null 就只放在記憶體（測試用）。
   * previewDb：包含還沒發布的卡包系列，超級帳號的全卡與牌組用它（沒給就跟 db 一樣）。
   */
  static async open(dir: string | null, db: CardDb, previewDb: CardDb = db): Promise<AccountStore> {
    if (dir !== null) await mkdir(dir, { recursive: true });
    const file = dir === null ? null : join(dir, 'accounts.sqlite');
    const fresh = file === null || !existsSync(file);
    const rows = new AccountDb(file);
    const store = new AccountStore(rows, dir, db, previewDb);
    // 以前存成 accounts.json：第一次開資料庫時整份搬進來，原檔改名留著當備份。
    const legacy = dir === null ? null : join(dir, 'accounts.json');
    if (fresh && legacy && existsSync(legacy)) {
      rows.import(JSON.parse(await readFile(legacy, 'utf8')) as Partial<Data>);
      await rename(legacy, join(dir!, `accounts.migrated-${stampOf(new Date())}.json`));
    }
    const raw = rows.load();
    for (const [id, account] of Object.entries(raw.accounts)) {
      const parsed = parseProfile(account.profile);
      if (!parsed) continue;
      // 起始牌組換過的話，舊帳號補上新起始牌組用到的卡（下次存檔時寫回）。
      const profile = withStarterCards(parsed, starterDecks(db));
      // 舊存檔的牌組是「英雄 id → 卡片清單」（每個英雄一副），轉成牌組清單。
      const { rank: savedRank, decks: oldDecks, deckBook: savedBook, ...rest } = account as Account & { decks?: unknown };
      const rank = savedRank === undefined ? null : parseRank(savedRank);
      // 用包含未發布卡的資料讀牌組：超級帳號的牌組裡可能有預覽的卡（一般帳號存不進去）。
      const book = savedBook !== undefined ? cleanBook(previewDb, savedBook) : oldDecks !== undefined ? cleanBook(previewDb, oldDecks) : null;
      store.data.accounts[id] = { ...rest, profile, ...(rank ? { rank } : {}), ...(book ? { deckBook: book } : {}) };
      store.refill(store.data.accounts[id]!);
    }
    store.data.sessions = raw.sessions;
    store.data.orders = raw.orders;
    return store;
  }

  /** 完整備份一份到 file（管理指令改資料之前用）。 */
  backupTo(file: string): void {
    mkdirSync(dirname(file), { recursive: true });
    this.rows.backup(file);
  }

  /** 關掉資料庫（測試、管理指令用）。 */
  close(): void {
    this.rows.close();
  }

  /** 超級帳號（金幣用不完、全卡）開關；管理指令用。 */
  async setUnlimited(account: Account, on: boolean): Promise<void> {
    if (on) account.unlimited = true;
    else delete account.unlimited;
    this.refill(account);
    this.rows.putAccount(account);
  }

  /** 全部帳號（管理指令列表用）。 */
  allAccounts(): Account[] {
    return Object.values(this.data.accounts);
  }

  /** 全部訂單（管理指令列表用）。 */
  allOrders(): Order[] {
    return Object.values(this.data.orders);
  }

  /**
   * 備份：data/backups/accounts-YYYYMMDD.sqlite，一天一份，留最近 14 份。伺服器每小時叫一次，當天已經有就不做。
   * 回傳這次寫的檔名（沒寫就是 null）。
   */
  async dailyBackup(now = new Date()): Promise<string | null> {
    if (this.dir === null) return null;
    const folder = join(this.dir, 'backups');
    await mkdir(folder, { recursive: true });
    const file = join(folder, `accounts-${stampOf(now).slice(0, 8)}.sqlite`);
    if (existsSync(file)) return null;
    this.rows.backup(file);
    const old = (await readdir(folder)).filter((name) => /^accounts-\d{8}\.sqlite$/.test(name)).sort().slice(0, -BACKUPS_KEPT);
    for (const name of old) await rm(join(folder, name), { force: true });
    return file;
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
    this.rows.putAccount(account);
    const token = this.issueSession(id, now);
    return { token, account };
  }

  /**
   * 名字＋密碼登入。create 是開新帳號（名字不能跟別人重複）；不是就登入既有的帳號。
   * 舊的訪客帳號沒有密碼：第一次用那個名字登入（或開帳號）時設定密碼，同名的舊訪客帳號全部合併成一個。
   */
  async loginWithPassword(name: string, password: string, create: boolean, now = Date.now()): Promise<{ token: string; account: Account }> {
    const clean = name.trim().slice(0, NAME_LIMIT);
    if (!clean) throw new AccountError(400, '取個名字吧');
    if (password.length < PASSWORD_MIN) throw new AccountError(400, `密碼至少 ${PASSWORD_MIN} 個字`);
    const all = Object.values(this.data.accounts).filter((account) => account.id.startsWith('guest:') && sameName(account.name, clean));
    const owned = all.find((account) => account.password);
    const legacy = all.filter((account) => !account.password);
    let account: Account;
    if (owned) {
      if (create) throw new AccountError(409, '這個名字已經有人用了，換一個，或直接登入');
      if (!(await checkPassword(password, owned.password!))) throw new AccountError(401, '名字或密碼不對');
      account = owned;
    } else if (legacy.length > 0) {
      account = await this.claim(legacy, password);
    } else {
      if (!create) throw new AccountError(404, '沒有這個帳號，要開新帳號請按「開新帳號」');
      const password_ = await hashPassword(password);
      // 算密碼的時候（背景執行緒）可能有別人搶先用了同一個名字。
      if (Object.values(this.data.accounts).some((each) => each.id.startsWith('guest:') && sameName(each.name, clean))) {
        throw new AccountError(409, '這個名字已經有人用了，換一個，或直接登入');
      }
      account = await this.createGuest(clean, now);
      account.password = password_;
    }
    this.rows.putAccount(account);
    const token = this.issueSession(account.id, now);
    return { token, account };
  }

  /** 認領舊的訪客帳號：設定密碼，同名的全部合併到收藏最多的那個（抽到的卡加在一起，不超過上限；粉塵與金幣相加）。 */
  private async claim(legacy: Account[], password: string): Promise<Account> {
    const count = (account: Account) => Object.values(account.profile.collection).reduce((sum, n) => sum + n, 0);
    const [keep, ...rest] = [...legacy].sort((a, b) => count(b) - count(a));
    const base = newProfile(keep!.profile.day, starterDecks(this.db)).collection;
    const collection = { ...keep!.profile.collection };
    let dust = keep!.profile.dust;
    let gold = keep!.profile.gold;
    for (const other of rest) {
      // 每個舊帳號都從同一份起始收藏開始，只把多抽到的加進來。
      for (const [id, n] of Object.entries(other.profile.collection)) {
        const extra = n - (base[id] ?? 0);
        if (extra <= 0) continue;
        const card = this.db.cards.get(id);
        const limit = card ? copyLimit(DEFAULT_RULES, card) : this.db.heroes.has(id) ? 1 : 0;
        collection[id] = Math.min(limit, (collection[id] ?? 0) + extra);
      }
      dust += other.profile.dust;
      gold += other.profile.gold;
      delete this.data.accounts[other.id];
      for (const [key, session] of Object.entries(this.data.sessions)) if (session.accountId === other.id) delete this.data.sessions[key];
      this.rows.deleteAccount(other.id);
    }
    keep!.profile = { ...keep!.profile, collection, dust, gold };
    keep!.password = await hashPassword(password);
    return keep!;
  }

  /** 開一個新的名字＋密碼帳號（五個基礎英雄的起始牌組、100 金幣）。 */
  private async createGuest(name: string, now: number): Promise<Account> {
    const account: Account = {
      id: `guest:${randomBytes(12).toString('hex')}`,
      name,
      email: null,
      picture: null,
      profile: newProfile(serverDay(new Date(now)), starterDecks(this.db)),
      createdAt: new Date(now).toISOString(),
    };
    this.data.accounts[account.id] = account;
    return account;
  }

  private issueSession(accountId: string, now: number): string {
    const token = randomBytes(32).toString('hex');
    const session = { accountId, expires: now + SESSION_DAYS * 24 * 3600 * 1000 };
    this.data.sessions[hash(token)] = session;
    this.rows.putSession(hash(token), session);
    // 順便清掉過期的 session。
    for (const [key, each] of Object.entries(this.data.sessions)) if (each.expires < now) delete this.data.sessions[key];
    this.rows.deleteExpiredSessions(now);
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
      this.rows.putAccount(account);
    }
    return account.rank;
  }

  /** 讀過換季獎勵的通知就清掉。 */
  async clearSeasonReward(account: Account): Promise<void> {
    delete account.seasonReward;
    this.rows.putAccount(account);
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
    for (const account of accounts) this.rows.putAccount(account!);
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
    this.refill(account);
    return account;
  }

  /** 超級帳號：把金幣補滿、缺的卡補齊（只改記憶體，下次存檔時一起寫進去）。 */
  private refill(account: Account): void {
    if (account.unlimited) account.profile = unlimitedProfile(account.profile, this.previewDb, DEFAULT_RULES);
  }

  async logout(token: string): Promise<void> {
    delete this.data.sessions[hash(token)];
    this.rows.deleteSession(hash(token));
  }

  /** 建立一筆儲值訂單（還沒付款）。 */
  async createOrder(account: Account, topup: Topup, tradeNo: string, now = Date.now()): Promise<Order> {
    const order: Order = {
      tradeNo,
      accountId: account.id,
      topup: topup.id,
      amount: topup.price,
      gold: topup.gold,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
    };
    this.data.orders[tradeNo] = order;
    this.rows.putOrder(order);
    return order;
  }

  order(tradeNo: string): Order | null {
    return this.data.orders[tradeNo] ?? null;
  }

  /**
   * 付款成功：加金幣。同一筆訂單只加一次（綠界可能重送通知）；金額跟訂單不合就不加。
   * 回傳 credited（這次加了）、already（之前加過）、unknown（沒有這筆）、mismatch（金額不合）。
   */
  async payOrder(
    notice: { tradeNo: string; amount: number; ecpayTradeNo: string; simulated: boolean },
    now = Date.now(),
  ): Promise<'credited' | 'already' | 'unknown' | 'mismatch'> {
    const order = this.data.orders[notice.tradeNo];
    if (!order) return 'unknown';
    if (order.status === 'paid') return 'already';
    if (order.amount !== notice.amount) return 'mismatch';
    const account = this.data.accounts[order.accountId];
    if (!account) return 'unknown';
    account.profile = { ...account.profile, gold: account.profile.gold + order.gold };
    Object.assign(order, { status: 'paid', paidAt: new Date(now).toISOString(), ecpayTradeNo: notice.ecpayTradeNo, simulated: notice.simulated });
    this.rows.putAccount(account);
    this.rows.putOrder(order);
    return 'credited';
  }

  /** 換掉整份牌組清單並存檔。 */
  async saveDeckBook(account: Account, book: DeckBook): Promise<void> {
    account.deckBook = book;
    this.rows.putAccount(account);
  }

  /** 改一個帳號的玩家資料並存檔。 */
  async update(account: Account, profile: Profile): Promise<void> {
    account.profile = profile;
    this.refill(account);
    this.rows.putAccount(account);
  }
}

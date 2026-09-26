import { DEFAULT_RULES, type CardDb } from '@card-game/engine';
import {
  exchange,
  fullProfile,
  openPack,
  parseProfile,
  recordGame,
  refreshDay,
  type EconomyResult,
  type GameReward,
  type GameSummary,
  type PackCard,
  type Profile,
  type RankState,
} from '@card-game/economy';

// 登入：測試帳號或 Google 帳號。
// - 測試帳號：10000 金幣、全部的卡，資料存在這個瀏覽器裡，不需要伺服器（claude.ai 上的試玩版也能用）。
// - Google 帳號：網頁用 Google Identity Services 拿到 ID token，交給遊戲伺服器驗證；
//   金幣與收藏存在伺服器上，開卡包的亂數也在伺服器抽。

const SESSION_KEY = 'card-game.account.v1';
const TEST_PROFILE_KEY = 'card-game.profile.test.v1';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** 從遊戲伺服器打開時，伺服器會在網頁上寫 Google 登入用的 client id；沒設定或不是從伺服器打開就是 null。 */
export const GOOGLE_CLIENT_ID: string | null =
  (window as { CARD_GAME_GOOGLE_CLIENT_ID?: string | null }).CARD_GAME_GOOGLE_CLIENT_ID ?? null;

export interface AccountInfo {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
}

/** 測試帳號存在瀏覽器；Google 帳號與訪客帳號存在遊戲伺服器上，用 token 驗證。 */
export type Session = { kind: 'test'; account: AccountInfo } | { kind: 'google' | 'guest'; account: AccountInfo; token: string };
export type ServerSession = Extract<Session, { token: string }>;

/** 伺服器帳號登入後拿到的資料。 */
export interface ServerMe {
  account: AccountInfo;
  profile: Profile;
  rank: RankState;
  /** 換季發的獎勵，只會出現一次。 */
  seasonReward?: { season: string; best: number; gold: number } | null;
}

const TEST_ACCOUNT: AccountInfo = { id: 'test', name: '測試帳號', email: null, picture: null };

/** 今天的日期（本地時間），每日任務與贏場金幣照這個換日。Google 帳號以伺服器的日期為準。 */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就只留在這次開著的頁面裡。
  }
}

/** 上次登入的帳號；沒有或格式不對就是 null。 */
export function loadSession(): Session | null {
  const raw = read(SESSION_KEY) as Partial<Session> | null;
  if (raw?.kind === 'test') return { kind: 'test', account: TEST_ACCOUNT };
  if ((raw?.kind === 'google' || raw?.kind === 'guest') && typeof raw.token === 'string' && typeof raw.account?.id === 'string') return raw as Session;
  return null;
}

export const saveSession = (session: Session | null) => write(SESSION_KEY, session);

// ─── 測試帳號 ────────────────────────────────────────────────────────────────

/** 測試帳號的資料：存過就讀回來，沒有就建一個全卡、10000 金幣的。 */
export function testProfile(db: CardDb): Profile {
  const saved = parseProfile(read(TEST_PROFILE_KEY));
  if (saved) {
    const collection = Object.fromEntries(Object.entries(saved.collection).filter(([id]) => db.cards.has(id)));
    return refreshDay({ ...saved, collection }, today());
  }
  return resetTestProfile(db);
}

/** 把測試帳號重設回全卡、10000 金幣。 */
export function resetTestProfile(db: CardDb): Profile {
  const profile = fullProfile(db, DEFAULT_RULES, today());
  write(TEST_PROFILE_KEY, profile);
  return profile;
}

export const saveTestProfile = (profile: Profile) => write(TEST_PROFILE_KEY, profile);

// ─── 伺服器 API ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, token: string | null, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, '連不上遊戲伺服器');
  }
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, json.error ?? `伺服器回應 ${response.status}`);
  return json;
}

/** 把 Google 給的 ID token 交給伺服器驗證，登入或開新帳號。 */
export async function googleLogin(credential: string): Promise<{ session: Session; profile: Profile }> {
  const result = await api<{ token: string; account: AccountInfo; profile: Profile }>('/api/login/google', null, { credential });
  return { session: { kind: 'google', account: result.account, token: result.token }, profile: result.profile };
}

/** 開一個訪客帳號：不用 Google，取個名字，金幣、收藏與牌位存在伺服器上。 */
export async function guestLogin(name: string): Promise<{ session: Session; profile: Profile }> {
  const result = await api<{ token: string; account: AccountInfo; profile: Profile }>('/api/login/guest', null, { name });
  return { session: { kind: 'guest', account: result.account, token: result.token }, profile: result.profile };
}

export interface LeaderboardRow {
  name: string;
  tier: number;
  stars: number;
  mmr: number;
  wins: number;
  losses: number;
}

export const fetchLeaderboard = (): Promise<{ rows: LeaderboardRow[] }> => api<{ rows: LeaderboardRow[] }>('/api/leaderboard', null);

/** 用存著的 session 拿最新的資料（含牌位）；session 過期回傳 null。 */
export async function fetchMe(session: ServerSession): Promise<ServerMe | null> {
  try {
    return await api<ServerMe>('/api/me', session.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function logout(session: Session): Promise<void> {
  if (session.kind !== 'test') {
    await api('/api/logout', session.token, {}).catch(() => undefined);
    if (session.kind === 'google') google()?.accounts.id.disableAutoSelect();
  }
  saveSession(null);
}

// ─── 金幣與卡包：測試帳號在瀏覽器裡算，Google 帳號交給伺服器 ─────────────────

export interface Backend {
  openPack(profile: Profile): Promise<EconomyResult<{ profile: Profile; cards: PackCard[] }>>;
  exchange(profile: Profile, cardId: string): Promise<EconomyResult<{ profile: Profile }>>;
  recordGame(profile: Profile, summary: GameSummary): Promise<GameReward>;
}

const failed = (error: unknown): { ok: false; reason: string } => ({
  ok: false,
  reason: error instanceof Error ? error.message : '出錯了',
});

export function backendFor(session: Session, db: CardDb): Backend {
  if (session.kind === 'test') {
    const saved = <T extends { ok: boolean; profile?: Profile }>(result: T): T => {
      if (result.ok && result.profile) saveTestProfile(result.profile);
      return result;
    };
    return {
      openPack: async (profile) => saved(openPack(refreshDay(profile, today()), db, DEFAULT_RULES, Math.random)),
      exchange: async (profile, cardId) => saved(exchange(profile, db, DEFAULT_RULES, cardId)),
      recordGame: async (profile, summary) => {
        const reward = recordGame(profile, summary, today());
        saveTestProfile(reward.profile);
        return reward;
      },
    };
  }
  const { token } = session;
  return {
    openPack: async () => {
      try {
        return { ok: true, ...(await api<{ profile: Profile; cards: PackCard[] }>('/api/pack', token, {})) };
      } catch (error) {
        return failed(error);
      }
    },
    exchange: async (_profile, cardId) => {
      try {
        return { ok: true, ...(await api<{ profile: Profile }>('/api/exchange', token, { cardId })) };
      } catch (error) {
        return failed(error);
      }
    },
    recordGame: (_profile, summary) => api<GameReward>('/api/game', token, { summary }),
  };
}

// ─── Google 登入按鈕 ─────────────────────────────────────────────────────────

interface Gsi {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void; auto_select?: boolean }): void;
      renderButton(element: HTMLElement, options: Record<string, string | number>): void;
      disableAutoSelect(): void;
    };
  };
}

const google = () => (window as { google?: Gsi }).google;

let gsiLoading: Promise<Gsi> | null = null;

/** 載入 Google Identity Services 的程式（只載一次）。 */
function loadGsi(): Promise<Gsi> {
  const loaded = google();
  if (loaded) return Promise.resolve(loaded);
  gsiLoading ??= new Promise<Gsi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => (google() ? resolve(google()!) : reject(new Error('Google 登入載入失敗')));
    script.onerror = () => {
      gsiLoading = null;
      reject(new Error('載入不了 Google 登入，檢查網路或瀏覽器的阻擋設定'));
    };
    document.head.appendChild(script);
  });
  return gsiLoading;
}

let initialized = false;
let onCredential: (credential: string) => void = () => undefined;

/** 在 element 裡放「用 Google 帳號登入」按鈕；按了、選好帳號後呼叫 callback。 */
export async function mountGoogleButton(element: HTMLElement, callback: (credential: string) => void): Promise<void> {
  if (!GOOGLE_CLIENT_ID) return;
  onCredential = callback;
  const gsi = await loadGsi();
  if (!initialized) {
    gsi.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (response) => onCredential(response.credential) });
    initialized = true;
  }
  if (!element.isConnected) return;
  gsi.accounts.id.renderButton(element, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'zh-TW', width: 260 });
}

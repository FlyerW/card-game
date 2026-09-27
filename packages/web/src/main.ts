import {
  createEngine,
  DEFAULT_RULES,
  damageBonus,
  describeAbility,
  describeCard,
  describeColors,
  describeEffects,
  describeEntry,
  cardNames,
  describeHero,
  describePassive,
  other,
  describeTrait,
  RACE_NAMES,
  sampleDb,
  SAMPLE_CARDS,
  SAMPLE_HEROES,
  type Ability,
  type Action,
  type CreatureView,
  type DeckCardDef,
  type GameEvent,
  type GameState,
  type HeroDef,
  type PlayerId,
  type PlayerView,
  type SideView,
  type Target,
  CARD_SETS,
  deckPool,
  setOf,
  decodeDeckCode,
  encodeDeckCode,
} from '@card-game/engine';
import {
  ADVENTURE,
  ADVENTURE_REWARD,
  cleanBook,
  clearedOn,
  DECK_LIMIT,
  DIFFICULTY_NAMES,
  stageUnlocked,
  type AdventureDifficulty,
  DECK_NAME_LIMIT,
  ECONOMY,
  emptyBook,
  emptyTally,
  gameSummary,
  newDeckId,
  newProfile,
  ownsHero,
  putDeck,
  removeDeck,
  selectDeck as selectDeckIn,
  questDef,
  rankLabel,
  refreshDay,
  tallyEvents,
  TIERS,
  type DeckBook,
  type GameTally,
  type Profile,
  type RankState,
  type SavedDeck,
} from '@card-game/economy';
import type { RankedReport } from '@card-game/server/protocol';
import { chooseAction, chooseActionSmart, STYLES } from '@card-game/sim/bot';
import { describeEvents, ZONE, type LogLine } from './log';
import {
  addProblem,
  autoDeck,
  deckIssues,
  deckScreen,
  fillRandom,
  deckStatus,
  loadBook,
  removeOne,
  saveBook,
  type Builder,
  type ColorPick,
  type KindFilter,
} from './deck-builder';
import { CARD_BACKS, cardBack, DEFAULT_BACK } from './card-backs';
import {
  backendFor,
  fetchLeaderboard,
  fetchMe,
  GOOGLE_CLIENT_ID,
  googleLogin,
  passwordLogin,
  loadSession,
  logout,
  mountGoogleButton,
  resetTestProfile,
  saveSession,
  saveTestProfile,
  testProfile,
  today,
  type Backend,
  type LeaderboardRow,
  topupStatus,
  type BotGameRecord,
  type ServerMe,
  type ServerSession,
  type Session,
} from './account';
import { music, type Sound } from './music';
import { ONLINE_AVAILABLE, OnlineClient } from './online';
import { scriptedTurn, startTutorial, STEPS, TUTORIAL_KEY } from './tutorial';
import { newShop, ownedOf, shopClick, shopScreen, walletBar, type Shop } from './shop';
import { artUrl, cardFace, detailLines, esc, pips, rich } from './ui';
import './style.css';

/**
 * 預覽還沒發布的卡包系列：網址加 ?preview，或伺服器用 CARD_PREVIEW=1 開（整個網頁都預覽）；
 * 或是用超級帳號登入（只有這個帳號預覽，記在存下來的登入資料裡，登入、登出時切換要重新載入網頁）。
 * 伺服器沒開預覽時，一般伺服器帳號的牌組存不進還沒發布的卡，所以預覽建議用測試帳號或超級帳號。
 */
const PAGE_PREVIEW = new URLSearchParams(location.search).has('preview') || (window as { CARD_GAME_PREVIEW?: boolean }).CARD_GAME_PREVIEW === true;
const ACCOUNT_PREVIEW = !PAGE_PREVIEW && loadSession()?.account.preview === true;
const PREVIEW = PAGE_PREVIEW || ACCOUNT_PREVIEW;
const db = sampleDb(PREVIEW);
/** 選得到的英雄（預覽時包括還沒發布的系列）；BOSS 不算。 */
const HEROES = [...db.heroes.values()].filter((hero) => !hero.boss);
const engine = createEngine(db);
/** 你的座位。跟電腦打時是 0；連線對戰時由伺服器決定。 */
let YOU: PlayerId = 0;
/** 對手的座位。 */
const THEM = (): PlayerId => other(YOU);
/** 跟電腦打時電腦的座位。 */
const BOT: PlayerId = 1;
const BOT_STEP_MS = 750;
/** 存檔格式。引擎的狀態改了就加一，舊版存下來的對局就不接著打。 */
const SAVE_FORMAT = 7;

// ─── 狀態 ────────────────────────────────────────────────────────────────────

type Selection =
  | { kind: 'hand'; uid: number }
  /** 已經選好召喚或進化的格子，正在選進場效果的目標。 */
  | { kind: 'entry'; uid: number; zone: number }
  /** confirmDismiss：按了「退場」，等再按一次確認。 */
  | { kind: 'creature'; player: PlayerId; zone: number; confirmDismiss?: boolean }
  | { kind: 'skill'; zone: number; skill: number }
  | { kind: 'heroPower' }
  | { kind: 'hero'; player: PlayerId }
  | { kind: 'field'; player: PlayerId };

/** 這局結束時拿到的獎勵，顯示在結算畫面上。 */
interface Reward {
  winGold: number;
  questGold: number;
  /** 結算後的任務進度，例如「召喚 10 隻生物 6/10」。 */
  quest: string;
  /** 自己投降的對局不算。 */
  conceded: boolean;
  /** 沒記到（例如連不上伺服器）的原因。 */
  error?: string;
}

interface Saved {
  format: number;
  screen: 'login' | 'setup' | 'deck' | 'lobby' | 'play' | 'shop' | 'queue' | 'adventure';
  heroId: string;
  /** 這一局是冒險模式的哪一關、什麼難度；一般的電腦對戰是 null。 */
  adventure: { stage: string; difficulty: AdventureDifficulty } | null;
  state: GameState | null;
  log: LogLine[];
  redraw: number[];
  /** 這局你用的牌組，結算任務（例如用有綠色卡的牌組贏）時看顏色。 */
  gameDeck: string[];
  /** 跟電腦打的這一局：對手的英雄與牌組、開始的時間，給對局紀錄用。 */
  botGame: { rival: string; rivalDeck: string[]; startedAt: number; backs?: [string, string] } | null;
  /** 這局邊打邊累計的召喚、抽牌、法術。 */
  tally: GameTally;
  /** 這局的獎勵；null 表示還沒結算。 */
  reward: Reward | null;
}

interface App extends Saved {
  /** 跟電腦打，或連線對戰。 */
  mode: 'bot' | 'online' | 'tutorial';
  /** 新手教學進行到第幾步、對手照劇本打到第幾回合；不在教學就是 null。 */
  tutorial: { step: number; round: number } | null;
  /** 伺服器帳號這季的牌位；測試帳號沒有。 */
  rank: RankState | null;
  /** 牌組清單：同一個英雄可以有很多副，記住每個英雄開局用哪一副。 */
  book: DeckBook;
  /** 冒險模式：開打前的劇情（哪一關、什麼難度）。 */
  story: { stage: string; difficulty: AdventureDifficulty } | null;
  /** 冒險模式打贏後：拿到多少金幣、有沒有出錯。 */
  stageReward: { gold: number; error?: string } | null;
  /** 正在貼上牌組代碼。 */
  importing: boolean;
  importText: string;
  /** 排位賽排隊中：開始排的時間、隊伍裡幾個人。 */
  queue: { since: number; waiting: number } | null;
  /** 現在這個房間是排位賽（結果由伺服器記，不用瀏覽器回報）。 */
  rankedRoom: boolean;
  /** 這場排位賽的結果。 */
  rankedReport: RankedReport | null;
  leaderboard: LeaderboardRow[] | null;
  /** 登入畫面輸入的帳號名字與密碼。 */
  guestName: string;
  guestPassword: string;
  /** 畫面上的局面：你的視角。跟電腦打時由 state 算出來，連線時由伺服器送來。 */
  view: PlayerView | null;
  /** 你現在能做的動作。 */
  legalActions: Action[];
  /** 連線對戰：送出動作後、等伺服器回覆前，先不能再點。 */
  pending: boolean;
  selection: Selection | null;
  busy: boolean;
  toast: string | null;
  builder: Builder;
  /** 卡牌大小：true 縮小、false 放大；null 表示照視窗高度自動決定。 */
  compactPref: boolean | null;
  /** 連線對戰時顯示給對手看的名字。 */
  playerName: string;
  /** 開局畫面上輸入的房號；網址帶 ?room= 時預先填好。 */
  roomCode: string;
  /** 看牌庫頂選牌時，已經點選的牌。 */
  picks: number[];
  /** 登入的帳號；null 就停在登入畫面。 */
  session: Session | null;
  /** 開卡包、兌換、記對局：測試帳號在瀏覽器裡算，Google 帳號交給伺服器。 */
  backend: Backend | null;
  /** 正在登入（等 Google 或伺服器回覆）。 */
  loggingIn: boolean;
  /** 電腦難度：普通是只看一步的貪婪策略，困難會規劃整回合、提防對手下回合。 */
  difficulty: Difficulty;
  /** 金幣、收藏、每日任務。 */
  profile: Profile;
  shop: Shop;
}

const app: App = {
  format: SAVE_FORMAT,
  screen: 'login',
  heroId: SAMPLE_HEROES[1]!.id,
  book: emptyBook(),
  adventure: null,
  story: null,
  stageReward: null,
  importing: false,
  importText: '',
  builder: {
    heroId: SAMPLE_HEROES[1]!.id,
    deckId: '',
    showCode: false,
    confirmDelete: false,
    filter: 'all',
    color: 'all',
    cost: 'all',
    rarity: 'all',
    sets: [],
    focus: null,
  },
  state: null,
  mode: 'bot',
  view: null,
  legalActions: [],
  pending: false,
  log: [],
  redraw: [],
  selection: null,
  busy: false,
  toast: null,
  compactPref: loadDensity(),
  playerName: loadName(),
  roomCode: new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '',
  picks: [],
  gameDeck: [],
  botGame: null,
  tally: emptyTally(),
  reward: null,
  session: null,
  backend: null,
  loggingIn: false,
  profile: newProfile(today(), []),
  shop: newShop(),
  difficulty: loadDifficulty(),
  tutorial: null,
  rank: null,
  queue: null,
  rankedRoom: false,
  rankedReport: null,
  leaderboard: null,
  guestName: loadName(),
  guestPassword: '',
};

/**
 * 從綠界付款頁回來（網址帶 ?topup=訂單編號）：等綠界的付款通知到伺服器，入帳了就更新金幣。
 * 信用卡通常幾秒內就到；ATM、超商代碼要等玩家真的去付款。
 */
async function checkTopupReturn(session: ServerSession): Promise<void> {
  const params = new URLSearchParams(location.search);
  const tradeNo = params.get('topup');
  if (!tradeNo) return;
  params.delete('topup');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const result = await topupStatus(session, tradeNo);
      if (result.status === 'paid') {
        Object.assign(app, { profile: result.profile, toast: `儲值成功：金幣 +${result.gold}` });
        render();
        return;
      }
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  app.toast = '還沒收到付款結果。用 ATM 或超商代碼的話，付款後金幣會自動入帳。';
  render();
}

/** 登入成功：記住帳號、換成這個帳號的資料與牌組。伺服器帳號另外帶牌位。 */
function signIn(session: Session, profile: Profile, me?: ServerMe): void {
  saveSession(session);
  // 超級帳號要用包含未發布卡包的卡牌資料：跟現在的不一樣就重新載入（存下來的登入資料已經記好了）。
  if (!PAGE_PREVIEW && (session.account.preview === true) !== ACCOUNT_PREVIEW) {
    location.reload();
    return;
  }
  const backend = backendFor(session, db);
  Object.assign(app, {
    session,
    backend,
    profile,
    rank: me?.rank ?? null,
    book: bookFor(session, backend, me),
    loggingIn: false,
    toast: null,
    shop: newShop(),
  });
  if (session.kind !== 'test') void checkTopupReturn(session);
  // 換到沒有這個 UR 英雄的帳號：改選第一個基礎英雄。
  if (!ownsHero(profile, db, app.heroId)) app.heroId = SAMPLE_HEROES.find((hero) => hero.rarity === undefined)!.id;
  if (app.screen === 'login') app.screen = 'setup';
  if (me?.seasonReward) {
    app.toast = `上一季（${me.seasonReward.season}）排位最高到${TIERS[me.seasonReward.best]}，獎勵 ${me.seasonReward.gold} 金幣`;
  }
  render();
  if (session.kind !== 'test') refreshLeaderboard();
}

function refreshLeaderboard(): void {
  fetchLeaderboard().then(
    ({ rows }) => {
      app.leaderboard = rows;
      render();
    },
    () => undefined,
  );
}

/** 名字＋密碼登入，或開新帳號（存在伺服器上）。 */
function onPasswordLogin(create: boolean): void {
  const name = app.guestName.trim();
  if (!name || !app.guestPassword) {
    app.toast = '名字和密碼都要填';
    render();
    return;
  }
  app.loggingIn = true;
  render();
  passwordLogin(name, app.guestPassword, create)
    .then(({ session }) => fetchMe(session as Extract<Session, { token: string }>).then((me) => ({ session, me })))
    .then(
      ({ session, me }) => {
        if (!me) throw new Error('登入失敗');
        app.guestPassword = '';
        signIn(session, me.profile, me);
      },
      (error: unknown) => {
        Object.assign(app, { loggingIn: false, toast: error instanceof Error ? error.message : '登入失敗' });
        render();
      },
    );
}

async function signOut(): Promise<void> {
  if (app.session) await logout(app.session);
  // 超級帳號登出：回到一般的卡牌資料。
  if (ACCOUNT_PREVIEW) {
    location.reload();
    return;
  }
  Object.assign(app, { session: null, backend: null, screen: 'login', book: emptyBook(), state: null, view: null, toast: null });
  render();
}

/** Google 選好帳號後：交給伺服器驗證。 */
function onGoogleCredential(credential: string): void {
  app.loggingIn = true;
  render();
  googleLogin(credential).then(
    ({ session, profile }) =>
      fetchMe(session as Extract<Session, { token: string }>).then((me) => signIn(session, me?.profile ?? profile, me ?? undefined)),
    (error: unknown) => {
      Object.assign(app, { loggingIn: false, toast: error instanceof Error ? error.message : 'Google 登入失敗' });
      render();
    },
  );
}

/** 重新整理後回到上次登入的帳號；Google 帳號要問伺服器 session 還有沒有效。 */
function restoreSession(): void {
  const session = loadSession();
  if (session?.kind === 'test') {
    signIn(session, testProfile(db));
  } else if (session?.kind === 'google' || session?.kind === 'guest') {
    if (!ONLINE_AVAILABLE) return saveSession(null);
    app.loggingIn = true;
    fetchMe(session).then(
      (me) => {
        if (me) signIn({ ...session, account: me.account }, me.profile, me);
        else {
          saveSession(null);
          Object.assign(app, { loggingIn: false, screen: 'login', toast: '登入已經過期，請重新登入' });
          render();
        }
      },
      (error: unknown) => {
        Object.assign(app, { loggingIn: false, screen: 'login', toast: error instanceof Error ? error.message : '連不上遊戲伺服器' });
        render();
      },
    );
  }
}

/** 開始新的一局：清掉上一局的累計與獎勵。 */
function resetGameRecord(deck: string[]): void {
  settling = false;
  Object.assign(app, { gameDeck: deck, tally: emptyTally(), reward: null });
}

/** 跟電腦打的這一局的紀錄；連線對戰由伺服器自己記，這裡不送。 */
function botRecord(view: PlayerView): BotGameRecord | undefined {
  const state = app.state;
  if (app.mode !== 'bot' || !app.botGame || !state?.result) return undefined;
  const { winner, reason } = state.result;
  return {
    hero: state.players[YOU].heroId,
    heroEvolution: view.you.heroEvolution,
    deck: app.gameDeck,
    opponentHero: app.botGame.rival,
    opponentHeroEvolution: view.opponent.heroEvolution,
    opponentDeck: app.botGame.rivalDeck,
    difficulty: app.adventure ? (app.adventure.difficulty === 'normal' ? 'normal' : 'hard') : app.difficulty,
    first: state.firstPlayer === YOU,
    winner: winner === 'draw' ? 'draw' : winner === YOU ? 'you' : 'bot',
    reason,
    turns: state.turn,
    seconds: Math.round((Date.now() - app.botGame.startedAt) / 1000),
  };
}

/** 冒險模式打贏一關：記下難度，第一次打過給金幣。 */
function reportStageClear(adventure: NonNullable<App['adventure']>): void {
  if (!app.backend) return;
  app.backend.clearStage(app.profile, adventure.stage, adventure.difficulty).then(
    (cleared) => {
      app.profile = cleared.profile;
      app.stageReward = { gold: cleared.gold };
      render();
    },
    (error: unknown) => {
      app.stageReward = { gold: 0, error: error instanceof Error ? error.message : '出錯了' };
      render();
    },
  );
}

/** 這局已經送去結算了，避免重複。 */
let settling = false;

/** 對局結束：照勝負、這局的累計與牌組發金幣、推進每日任務。每局只結算一次。 */
function settle(view: PlayerView): void {
  // 排位賽的結果由伺服器記（見 'ranked' 訊息），這裡不再回報。
  if (app.reward || settling || !view.result || !app.backend || app.mode === 'tutorial' || app.rankedRoom) return;
  const { winner, reason } = view.result;
  const conceded = reason === 'concede' && winner !== YOU;
  const summary = gameSummary(db, app.tally, app.gameDeck, winner === YOU, conceded);
  settling = true;
  app.backend.recordGame(app.profile, summary, botRecord(view)).then(
    (result) => {
      settling = false;
      app.profile = result.profile;
      const quest = questDef(app.profile.quest.id);
      app.reward = {
        winGold: result.winGold,
        questGold: result.questGold,
        quest: quest ? `${quest.text} ${app.profile.quest.progress}/${quest.goal}` : '',
        conceded,
      };
      if (app.adventure && winner === YOU) reportStageClear(app.adventure);
      render();
    },
    (error: unknown) => {
      settling = false;
      app.reward = { winGold: 0, questGold: 0, quest: '', conceded, error: error instanceof Error ? error.message : '出錯了' };
      render();
    },
  );
}

type Difficulty = 'normal' | 'hard';
const DIFFICULTY_KEY = 'card-game.difficulty';

function loadDifficulty(): Difficulty {
  try {
    return localStorage.getItem(DIFFICULTY_KEY) === 'normal' ? 'normal' : 'hard';
  } catch {
    return 'hard';
  }
}

function loadName(): string {
  try {
    return localStorage.getItem('card-game.name') ?? '';
  } catch {
    return '';
  }
}

// ─── 連線對戰 ────────────────────────────────────────────────────────────────

const online = new OnlineClient();
online.onStatus = () => {
  // 排隊中斷線，伺服器那邊就把你移出隊伍了。
  if (!online.connected && app.screen === 'queue') {
    Object.assign(app, { queue: null, screen: 'setup', toast: '和伺服器斷線，已經離開排隊' });
  }
  render();
};
online.onMessage = (message) => {
  if (message.t === 'room') {
    app.mode = 'online';
    YOU = message.seat;
    app.rankedRoom = message.ranked;
    // 排位賽配對成功：等局面送來就開打，不經過等候畫面。
    if (message.ranked) {
      app.queue = null;
      app.rankedReport = null;
    } else if (app.screen !== 'play') {
      // 還沒開局（等朋友加入）就留在等候畫面；已經在打就只是更新對手的連線狀態。
      app.screen = 'lobby';
    }
    render();
  } else if (message.t === 'queued') {
    app.queue = { since: message.since, waiting: message.waiting };
    app.screen = 'queue';
    render();
  } else if (message.t === 'ranked') {
    app.rankedReport = message.report;
    app.rank = message.report.after;
    if (message.report.reward.profile?.version === 1) app.profile = message.report.reward.profile;
    render();
    refreshLeaderboard();
  } else if (message.t === 'state') {
    app.mode = 'online';
    app.pending = false;
    const fresh = message.view.phase === 'mulligan' && app.view?.phase !== 'mulligan';
    if (fresh) {
      Object.assign(app, { log: [], redraw: [], selection: null, view: null });
      resetGameRecord(app.gameDeck);
    }
    app.screen = 'play';
    step(app.view ?? message.view, message.view, message.legal, message.events);
  } else if (message.t === 'error') {
    app.pending = false;
    app.toast = message.message;
    if (app.screen === 'queue') Object.assign(app, { screen: 'setup', queue: null });
    if (message.fatal) {
      app.mode = 'bot';
      app.screen = 'setup';
      app.view = null;
    }
    render();
  }
};

/** 友誼賽用的名字：自己填的，沒填就用帳號名字。 */
const roomName = (): string => app.playerName.trim() || app.session?.account.name || '';

function createRoom(): void {
  const deck = myDeck();
  resetGameRecord(deck);
  online.send({ t: 'create', name: roomName(), heroId: app.heroId, deck, back: chosenDeck(app.heroId)?.back ?? DEFAULT_BACK });
}

function joinRoom(): void {
  const code = app.roomCode.trim().toUpperCase();
  if (!code) {
    app.toast = '先輸入朋友給你的房號';
    render();
    return;
  }
  const deck = myDeck();
  resetGameRecord(deck);
  online.send({ t: 'join', code, name: roomName(), heroId: app.heroId, deck, back: chosenDeck(app.heroId)?.back ?? DEFAULT_BACK });
}

function leaveRoom(): void {
  online.leave();
  Object.assign(app, { mode: 'bot', screen: 'setup', view: null, state: null, selection: null, toast: null, pending: false, rankedRoom: false });
  history.replaceState(null, '', location.pathname);
  render();
}

// ─── 卡牌大小：整個牌桌要放得進一個畫面 ────────────────────────────────────────

const DENSITY_KEY = 'card-game.density';
/** 視窗比這個矮就自動用小卡牌。 */
const COMPACT_BELOW = 820;

function loadDensity(): boolean | null {
  try {
    const saved = localStorage.getItem('card-game.density');
    return saved === 'compact' ? true : saved === 'large' ? false : null;
  } catch {
    return null;
  }
}

const compact = () => app.compactPref ?? window.innerHeight < COMPACT_BELOW;
const applyDensity = () => document.documentElement.classList.toggle('compact', compact());
applyDensity();
window.addEventListener('resize', applyDensity);
document.addEventListener('fullscreenchange', () => {
  applyDensity();
  render();
});

interface Float {
  key: string;
  text: string;
  tone: 'damage' | 'loss' | 'heal' | 'buff';
}
let floats: Float[] = [];

const root = document.getElementById('app')!;

// ─── 小工具 ──────────────────────────────────────────────────────────────────

const card = (id: string) => db.cards.get(id)!;
const hero = (id: string) => db.heroes.get(id)!;
const nameOf = (id: string) => db.cards.get(id)?.name ?? db.heroes.get(id)?.name ?? id;
/** 卡牌說明用：衍生物帶上數值。 */
const describeName = cardNames(db);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const targetKey = (t: Target) => (t.kind === 'hero' ? `h${t.player}` : t.kind === 'field' ? `f${t.player}` : `z${t.player}${t.zone}`);



// ─── 合法動作與可點的目標 ─────────────────────────────────────────────────────
//
// 畫面上能點的東西全部由引擎的合法動作推出來，網頁不自己判斷規則。

function legal(): Action[] {
  const view = app.view;
  if (view === null || app.busy || app.pending || view.phase !== 'main') return [];
  return app.legalActions;
}

const actsForCard = (uid: number) => legal().filter((a) => 'card' in a && a.card === uid);
const actsForSkill = (zone: number, skill: number) =>
  legal().filter((a) => a.type === 'useSkill' && a.zone === zone && a.skill === skill);
const actsForPower = () => legal().filter((a) => a.type === 'heroPower');
const actsForAttack = (zone: number) => legal().filter((a) => a.type === 'attack' && a.zone === zone);

/** 這隻生物能發動的技能：自己的，加上道具給的。 */
function skillsOf(cv: CreatureView) {
  const def = card(cv.cardId);
  const item = cv.item ? card(cv.item) : null;
  return [...(def.kind === 'creature' ? def.skills : []), ...(item?.kind === 'item' ? (item.skills ?? []) : [])];
}

/** 目前選取狀態下，點哪個位置會執行哪個動作。 */
function choices(): Map<string, Action> {
  const map = new Map<string, Action>();
  const sel = app.selection;
  if (sel === null) return map;
  if (sel.kind === 'entry') {
    for (const a of actsForCard(sel.uid)) {
      if ((a.type === 'summon' || a.type === 'evolve') && a.zone === sel.zone && a.target) map.set(targetKey(a.target), a);
    }
    return map;
  }
  if (sel.kind === 'creature' && sel.player === YOU) {
    // 選了自己的生物：發光的對手生物與英雄就是能攻擊的目標。
    for (const a of actsForAttack(sel.zone)) if (a.type === 'attack') map.set(targetKey(a.target), a);
    return map;
  }
  const acts =
    sel.kind === 'hand' ? actsForCard(sel.uid) : sel.kind === 'skill' ? actsForSkill(sel.zone, sel.skill) : sel.kind === 'heroPower' ? actsForPower() : [];
  for (const a of acts) {
    // 同一格可能對應好幾個動作（進場效果的不同目標），先記第一個，點下去時再決定要不要進入選目標。
    if (a.type === 'summon' || a.type === 'evolve' || a.type === 'attachItem') {
      if (!map.has(`z${YOU}${a.zone}`)) map.set(`z${YOU}${a.zone}`, a);
    } else if ((a.type === 'castSpell' || a.type === 'useSkill' || a.type === 'heroPower' || a.type === 'evolveHero') && a.target) {
      map.set(targetKey(a.target), a);
    }
  }
  return map;
}

// ─── 執行動作 ────────────────────────────────────────────────────────────────

function floatsFrom(events: GameEvent[]): Float[] {
  const out: Float[] = [];
  for (const e of events) {
    if (e.type === 'damaged' && e.amount > 0) out.push({ key: targetKey(e.target), text: `−${e.amount}`, tone: 'damage' });
    if (e.type === 'shieldBroken') out.push({ key: `z${e.player}${e.zone}`, text: '聖盾', tone: 'heal' });
    else if (e.type === 'hpLost') out.push({ key: targetKey(e.target), text: `−${e.amount}`, tone: 'loss' });
    else if (e.type === 'healed' && e.amount > 0) out.push({ key: targetKey(e.target), text: `+${e.amount}`, tone: 'heal' });
    else if (e.type === 'buffed') out.push({ key: `z${e.player}${e.zone}`, text: `+${e.attack}/+${e.hp}`, tone: 'buff' });
  }
  return out;
}

/** 局面變了：更新畫面、寫紀錄、播飄字。兩種模式共用。 */
function step(before: PlayerView, after: PlayerView, legalActions: Action[], events: GameEvent[]): void {
  app.view = after;
  app.legalActions = legalActions;
  app.tally = tallyEvents(app.tally, events, YOU);
  if (after.phase === 'over') settle(after);
  if (!after.choice) app.picks = [];
  app.log.push(...describeEvents(db, events, before, after, themName()));
  if (app.log.length > 300) app.log.splice(0, app.log.length - 300);
  app.selection = null;
  app.toast = null;
  floats = floatsFrom(events);
  music.effects(soundsFor(events));
  render();
}

/** 這一步要播的音效，最多三個，照重要的先。 */
function soundsFor(events: GameEvent[]): Sound[] {
  const heard = new Set<Sound>();
  for (const e of events) {
    if (e.type === 'gameOver') heard.add(e.result.winner === YOU ? 'win' : 'lose');
    else if (e.type === 'turnStarted' && e.player === YOU) heard.add('turn');
    else if (e.type === 'summoned' || e.type === 'evolved' || e.type === 'heroEvolved' || e.type === 'itemAttached' || e.type === 'fieldPlayed') heard.add('card');
    else if (e.type === 'abilityUsed') heard.add('spell');
    else if (e.type === 'attacked') heard.add('attack');
    else if (e.type === 'damaged' && e.amount > 0) heard.add('hit');
    else if (e.type === 'creatureDestroyed') heard.add('death');
    else if (e.type === 'healed' && e.amount > 0) heard.add('heal');
  }
  const order: Sound[] = ['win', 'lose', 'turn', 'card', 'spell', 'attack', 'hit', 'death', 'heal'];
  return order.filter((sound) => heard.has(sound)).slice(0, 3);
}

// ─── 跟電腦打：完整的狀態在這個瀏覽器裡 ───────────────────────────────────────

/** 你現在能做的動作；教學時只留這一步要的。 */
function localLegal(state: GameState): Action[] {
  if (state.phase !== 'main' || engine.actor(state) !== YOU) return [];
  const actions = engine.legalActions(state, YOU);
  if (app.mode !== 'tutorial' || !app.tutorial) return actions;
  const allow = STEPS[app.tutorial.step]?.allow;
  return allow ? actions.filter((action) => allow(action, state)) : [];
}

function localStep(after: GameState, events: GameEvent[]): void {
  const before = app.view ?? engine.viewFor(after, YOU);
  app.state = after;
  step(before, engine.viewFor(after, YOU), localLegal(after), events);
}

function perform(action: Action): void {
  if (app.mode === 'online') {
    app.pending = true;
    online.send({ t: 'act', action });
    render();
    return;
  }
  const before = app.state;
  if (before === null) return;
  if (app.mode === 'tutorial' && app.tutorial) {
    const allow = STEPS[app.tutorial.step]?.allow;
    if (!allow || !allow(action, before)) {
      app.toast = '照上面的說明做這一步';
      render();
      return;
    }
  }
  const result = engine.apply(before, action);
  if (!result.ok) {
    app.toast = result.error.message;
    render();
    return;
  }
  // 結束回合的那一步，要等對手照劇本打完才進下一步，說明才會跟牌桌對得上。
  if (app.mode === 'tutorial' && app.tutorial && action.type !== 'endTurn') app.tutorial.step += 1;
  localStep(result.state, result.events);
  if (app.mode === 'tutorial') void tutorialOpponent(action);
  else void advance();
}

// ─── 新手教學 ────────────────────────────────────────────────────────────────

function startTutorialGame(): void {
  YOU = 0;
  Object.assign(app, {
    mode: 'tutorial',
    screen: 'play',
    tutorial: { step: 0, round: 0 },
    log: [],
    redraw: [],
    selection: null,
    toast: null,
    view: null,
  });
  localStep(startTutorial(engine), []);
}

/** 你結束回合後，對手照劇本打一回合（稍等一下，看得到發生什麼）。 */
async function tutorialOpponent(action: Action): Promise<void> {
  if (action.type !== 'endTurn' || !app.tutorial || !app.state) return;
  app.busy = true;
  render();
  await sleep(BOT_STEP_MS);
  if (app.mode !== 'tutorial' || !app.tutorial || !app.state) return;
  const { state, events } = scriptedTurn(engine, app.state, app.tutorial.round);
  app.tutorial.round += 1;
  app.tutorial.step += 1;
  app.busy = false;
  localStep(state, events);
}

function leaveTutorial(done: boolean): void {
  if (done) {
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch {
      // 存不了就下次還會提示一次。
    }
  }
  Object.assign(app, { mode: 'bot', tutorial: null, screen: 'setup', state: null, view: null, selection: null, toast: null, busy: false });
  render();
  window.scrollTo(0, 0);
}

const tutorialDone = (): boolean => {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
};

/** 教學的說明框：第幾步、要做什麼；只看說明的步驟有「下一步」。 */
function tutorialPanel(): string {
  const tutorial = app.tutorial;
  if (!tutorial) return '';
  const current = STEPS[tutorial.step];
  if (!current) return '';
  const last = tutorial.step === STEPS.length - 1;
  const waiting = app.busy ? '<p class="tut-text">對手的回合……</p>' : '';
  const action = last
    ? '<button class="primary" data-do="tut-finish">完成教學</button>'
    : current.allow
      ? ''
      : '<button class="primary" data-do="tut-next">下一步</button>';
  return `<div class="tutorial" role="status">
    <p class="tut-step">新手教學 ${tutorial.step + 1}/${STEPS.length}・${esc(current.title)}</p>
    ${waiting || `<p class="tut-text">${rich(current.text)}</p>`}
    <div class="tut-actions">${action}<button class="ghost small" data-do="tut-leave">離開教學</button></div>
  </div>`;
}

/** 跟電腦打：輪到電腦就讓它一步一步慢慢播，看得清楚它做了什麼；輪到你時停下來。 */
async function advance(): Promise<void> {
  if (app.mode !== 'bot' || app.busy) return;
  app.busy = true;
  render();
  while (app.state !== null && app.state.phase === 'main' && app.screen === 'play' && app.mode === 'bot') {
    const before = app.state;
    if (engine.actor(before) === BOT) {
      await sleep(BOT_STEP_MS);
      if (app.state !== before) break;
      // 冒險模式：普通用普通的電腦；困難、惡夢用困難的電腦。
      const smart = app.adventure ? app.adventure.difficulty !== 'normal' : app.difficulty === 'hard';
      const think = smart ? chooseActionSmart : chooseAction;
      const pick = think(engine, before, BOT, STYLES.balanced);
      localStep(pick.state, pick.events);
    } else {
      break;
    }
  }
  app.busy = false;
  render();
}

/** 開一局跟電腦打；冒險模式的話，對手是那一關的 BOSS（惡夢用惡夢版）。 */
function startGame(adventure: App['adventure'] = null): void {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const rivals = HEROES.filter((h) => h.id !== app.heroId);
  const stage = adventure ? ADVENTURE.find((each) => each.id === adventure.stage) : undefined;
  const rival = stage ? (adventure!.difficulty === 'nightmare' ? stage.boss.nightmare : stage.boss.normal) : rivals[seed % rivals.length]!.id;
  YOU = 0;
  // 雙方都照正式規則組牌；你有自訂牌組就用你的，沒有就用收藏自動組一副。電腦每局從全部的卡自動組一副。
  const deck = myDeck();
  const rivalDeck = autoDeck(db, rival, seed + 1);
  const created = engine.createGame({
    seed,
    players: [
      { heroId: app.heroId, deck },
      { heroId: rival, deck: rivalDeck },
    ],
  });
  if (!created.ok) {
    app.toast = created.error.message;
    render();
    return;
  }
  const kept = engine.apply(created.state, { type: 'mulligan', player: BOT, cards: [] });
  if (!kept.ok) return;
  Object.assign(app, { mode: 'bot', screen: 'play', log: [], redraw: [], selection: null, toast: null, view: null, adventure, story: null, stageReward: null });
  resetGameRecord(deck);
  // 卡背：你用牌組選的，電腦隨機一種。
  const backs: [string, string] = [chosenDeck(app.heroId)?.back ?? DEFAULT_BACK, CARD_BACKS[(seed >>> 3) % CARD_BACKS.length]!.id];
  app.botGame = { rival, rivalDeck, startedAt: Date.now(), backs };
  localStep(kept.state, []);
}

/** 收藏決定每張卡最多能放幾張。 */
const owned = () => ownedOf(app.profile);

/** 這一局某位玩家的卡背：連線對戰看房間裡的座位，跟電腦打看開局時記下的。 */
function backFor(player: PlayerId): string {
  if (app.mode === 'online') return online.room?.seats[player]?.back ?? DEFAULT_BACK;
  if (app.mode === 'bot') return app.botGame?.backs?.[player] ?? DEFAULT_BACK;
  return player === YOU ? (chosenDeck(app.heroId)?.back ?? DEFAULT_BACK) : DEFAULT_BACK;
}

/** 你這局要用的牌組：有自訂牌組就用，沒有就用收藏自動組一副。 */
const myDeck = (): string[] => chosenDeck(app.heroId)?.cards ?? autoDeck(db, app.heroId, (Math.random() * 2 ** 32) >>> 0, owned());

/** 這個英雄開局要用的牌組；沒選就是 null（用收藏自動組一副）。 */
const chosenDeck = (heroId: string): SavedDeck | null =>
  app.book.decks.find((deck) => deck.id === app.book.selected[heroId] && deck.heroId === heroId) ?? null;

/** 對手英雄右邊：天生技（跟我方一樣的按鈕樣式，點了看說明）、手牌張數、被動。 */
function heroInfo(side: SideView, player: PlayerId): string {
  const h = hero(side.heroId);
  const evolution = side.heroEvolution ? card(side.heroEvolution) : null;
  const lines: string[] = [];
  if (h.passive) lines.push(describePassive(h.passive, describeName));
  if (evolution?.kind === 'heroEvolution' && evolution.passive) lines.push(describePassive(evolution.passive, describeName));
  // 手牌：一排小卡背（最多畫 10 張），旁邊寫張數。
  const backs = Array.from({ length: Math.min(side.handCount, 10) }, () => cardBack(backFor(player))).join('');
  return `<div class="hero-side">${powerPill(side, false)}<div class="hero-info"><span class="hi-hand">手牌 ${side.handCount}<span class="hand-backs">${backs}</span></span>${lines
    .map((line) => `<p>${rich(line)}</p>`)
    .join('')}</div></div>`;
}

/**
 * 天生技的按鈕：左邊費用、右邊名字。我方的按了就發動；對手的按了看說明。
 * 有次數限制的標出這局還剩幾次；輪流的標出下一次換成哪個。
 */
function powerPill(side: SideView, mine: boolean): string {
  const current = powerOf(side);
  if (!current) return '';
  const { power, next } = current;
  const left = power.uses === undefined ? '' : `（剩 ${Math.max(0, power.uses - side.heroPowerUses)} 次）`;
  const then = next ? `<small>・用完換成「${esc(next.name)}」</small>` : '';
  const body = `${costBadge(power)}${esc(power.name)}${left}${then}`;
  if (!mine) return `<button class="power" data-do="their-power" aria-label="對手的天生技 ${esc(power.name)}，點了看說明">${body}</button>`;
  const usable = actsForPower().length > 0;
  const combo = usable && power.combo?.length && side.playedThisTurn > 0 ? ' combo-ready' : '';
  return `<button class="power${app.selection?.kind === 'heroPower' ? ' selected' : ''}${combo}" data-do="power" ${usable ? '' : 'disabled'}>${body}</button>`;
}

/** 這張卡有沒有連擊（法術或生物的進場）。 */
function hasCombo(def: DeckCardDef): boolean {
  if (def.kind === 'spell') return (def.combo?.length ?? 0) > 0;
  return def.kind === 'creature' && (def.entry?.combo?.length ?? 0) > 0;
}

/** 目前的天生技，以及輪流的話下一次換成哪一個（跟引擎的 heroPower 同一套規則）。 */
function powerOf(side: SideView): { power: Ability; next: Ability | null } | null {
  const evolution = side.heroEvolution ? card(side.heroEvolution) : null;
  const source = evolution?.kind === 'heroEvolution' && evolution.power ? evolution : hero(side.heroId);
  if (!source.power) return null;
  if (!source.alternatePower) return { power: source.power, next: null };
  const odd = side.heroPowerUses % 2 === 1;
  return odd ? { power: source.alternatePower, next: source.power } : { power: source.power, next: source.alternatePower };
}

/** 技能按鈕上的費用：能量，加上能量上限 −N。 */
function costBadge(ability: Ability): string {
  const cap = ability.maxEnergyCost ? `<span class="skill-cost cap" title="能量上限 −${ability.maxEnergyCost}">上限−${ability.maxEnergyCost}</span>` : '';
  const energy = ability.cost > 0 || !ability.maxEnergyCost ? `<span class="skill-cost">${ability.cost}</span>` : '';
  return `<span class="costs">${energy}${cap}</span>`;
}

/** 對手的稱呼：電腦，或朋友取的名字。 */
function themName(): string {
  if (app.mode !== 'online') return '電腦';
  return online.room?.seats[THEM()]?.name || '對手';
}

// ─── 說明欄的文字 ────────────────────────────────────────────────────────────

function handReason(def: DeckCardDef, you: SideView): string {
  if (def.kind === 'heroEvolution' && def.evolvesFrom !== you.heroId) return '這不是你英雄的進化卡';
  if (def.cost > you.energy) return `能量不足：需要 ${def.cost}，目前 ${you.energy}`;
  switch (def.kind) {
    case 'creature':
      return def.stage === 0
        ? '生物區已滿'
        : `場上沒有可以進化的${nameOf(def.evolvesFrom!)}（每隻最多進化一次）`;
    case 'spell':
      return '目前沒有可以指定的目標';
    case 'item':
      return '場上沒有可以裝備的生物（每隻限一張道具）';
    case 'field':
      return '場地卡每回合只能放一張';
    case 'heroEvolution':
      return '英雄已經進化過（每局限一次）';
  }
}

/** 攻擊與技能共用的限制；沒有就是 null。 */
function actReason(cv: CreatureView): string | null {
  const def = card(cv.cardId);
  // 有速攻，或進化過（進化卡都算有速攻），召喚當回合就能行動。
  const haste = (def.kind === 'creature' && def.keywords?.includes('haste')) || cv.evolutionChain.length > 1;
  if (cv.paralyzed) return '麻痺中，不能攻擊、不能發動技能';
  if (cv.summonedThisTurn && !haste) return '召喚當回合不能攻擊、不能發動技能';
  return null;
}

function skillReason(cv: CreatureView, skill: Ability, you: SideView): string {
  const reason = actReason(cv);
  if (reason) return reason;
  if (cv.skillUsedThisTurn) return '這回合已經發動過技能';
  if (cv.silenced) return '沉默中，不能發動技能';
  if (skill.rest && cv.attackedThisTurn) return '這回合攻擊過了，不能休息';
  if (skill.cost > you.energy) return `能量不足：需要 ${skill.cost}`;
  if ((skill.maxEnergyCost ?? 0) > you.maxEnergy) return `能量上限不夠：需要 ${skill.maxEnergyCost}`;
  return '目前沒有可以指定的目標';
}

function attackReason(cv: CreatureView): string {
  const reason = actReason(cv);
  if (reason) return reason;
  if (cv.attackedThisTurn) return '這回合已經攻擊過（或休息了）';
  if (cv.weakened) return '虛弱中，不能攻擊';
  if (cv.attack <= 0) return '攻擊力是 0，不能攻擊';
  return '沒有可以攻擊的目標';
}

const lines = detailLines;

/**
 * 卡面旁邊的說明：標題只寫名字、稀有度、顏色、種類（費用、攻擊、HP 卡面或標籤上已經有，不重複）；
 * skip：已經畫成技能按鈕的那幾行，不再寫一次。場上生物與起手的牌用。
 */
function boardLines(def: DeckCardDef, skip: readonly string[]): string {
  const [head = '', ...body] = describeCard(def, describeName);
  return lines([head.split('｜')[0]!, ...body.filter((line) => !skip.includes(line))]);
}

/** 現在輪到你做決定。 */
const myMove = (view: PlayerView) => view.phase === 'main' && view.activePlayer === YOU && !app.busy && !app.pending;

/** 場上生物的技能傷害加成（元素之力）；沉默時沒有。 */
function skillBonus(cv: CreatureView): number {
  const def = card(cv.cardId);
  return def.kind === 'creature' && !cv.silenced ? damageBonus(def) : 0;
}

function creatureStatus(cv: CreatureView): string {
  const def = card(cv.cardId);
  // HP 上限的加成（增益、道具、場地、英雄被動）：跟攻擊力一樣寫在括號裡。
  const hpBonus = def.kind === 'creature' ? cv.maxHp - def.hp : 0;
  const tags: string[] = [
    `⚔ ${cv.attack}${cv.attackBonus ? `（含加成 +${cv.attackBonus}）` : ''}`,
    `♥ ${cv.hp} / ${cv.maxHp}${hpBonus > 0 ? `（含加成 +${hpBonus}）` : ''}`,
  ];
  // 種族特色寫在上面的說明裡；這裡只標目前的狀態（不死用過了、沉默中失效）。
  const trait = def.kind === 'creature' ? describeTrait(def) : null;
  if (def.kind === 'creature' && trait) {
    if (def.race === 'undead' && cv.undyingUsed) tags.push(`${trait} 已經用過`);
    if (cv.silenced) tags.push(`${trait} 沉默中失效`);
  }
  if (cv.damageReduction) tags.push(`受到傷害 −${cv.damageReduction}`);
  if (cv.item) tags.push(`道具：${nameOf(cv.item)}`);
  if (cv.taunting) tags.push('**挑釁**中');
  if (cv.poison) tags.push(`**中毒 ${cv.poison}**`);
  if (cv.burn) tags.push(`**灼燒 ${cv.burn}**`);
  if (cv.paralyzed) tags.push('**麻痺**');
  if (cv.silenced) tags.push('**沉默**');
  if (cv.weakened) tags.push('**虛弱**');
  if (cv.evolutionChain.length > 1) tags.push(`進化：${cv.evolutionChain.map(nameOf).join(' → ')}`);
  return `<ul class="tags">${tags.map((t) => `<li>${rich(t)}</li>`).join('')}</ul>`;
}

function detail(view: PlayerView): string {
  const sel = app.selection;
  const toast = app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : '';
  const cancel = '<button class="ghost" data-do="cancel">取消</button>';
  const myTurn = myMove(view);

  const away =
    app.mode === 'online' && online.room?.seats[THEM()]?.connected === false
      ? `<p class="toast" role="status">${esc(themName())}斷線了，等他重新連上。</p>`
      : app.mode === 'online' && !online.connected
        ? '<p class="toast" role="status">你的連線中斷了，正在重新連線……</p>'
        : '';
  if (sel === null) {
    if (view.phase === 'over') return away + toast + '<p class="d-head">對局結束</p>';
    if (away) return away + toast;
    if (view.opponentChoosing) {
      return toast + `<p class="d-head">${esc(themName())}正在選牌</p><p class="d-line">對手翻開了牌庫頂的牌，選好就會繼續。</p>`;
    }
    // 沒選東西時不寫「你的回合」：看結束回合按鈕就知道；規則說明在畫面最下面的「怎麼玩」。
    return toast;
  }

  if (sel.kind === 'hand') {
    const held = view.you.hand.find((c) => c.uid === sel.uid);
    if (!held) return toast;
    const def = card(held.cardId);
    const acts = actsForCard(sel.uid);
    let hint = '';
    if (!myTurn) hint = '<p class="hint">輪到你的時候才能出牌。</p>';
    else if (acts.length === 0) hint = `<p class="hint blocked">${esc(handReason(def, view.you))}</p>`;
    else if (acts.some((a) => a.type === 'summon')) hint = '<p class="hint">點一個空的生物格召喚。</p>';
    else if (acts.some((a) => a.type === 'evolve')) hint = '<p class="hint">點要進化的生物。</p>';
    else if (acts.some((a) => a.type === 'attachItem')) hint = '<p class="hint">點你要裝上道具的生物。</p>';
    else if (acts.some((a) => a.type === 'playField')) hint = '<button class="primary" data-do="direct">放到場地區</button>';
    else if (acts.some((a) => a.type === 'evolveHero' && a.target)) hint = '<p class="hint">點選進場效果的目標，英雄就會進化。</p>';
    else if (acts.some((a) => a.type === 'evolveHero')) hint = '<button class="primary" data-do="direct">進化英雄</button>';
    else if (acts.some((a) => a.type === 'castSpell' && !a.target)) hint = '<button class="primary" data-do="direct">施放</button>';
    else hint = '<p class="hint">點選法術的目標。</p>';
    return toast + lines(describeCard(def, describeName)) + hint + cancel;
  }

  if (sel.kind === 'creature') {
    const side = sel.player === YOU ? view.you : view.opponent;
    const cv = side.zones[sel.zone];
    if (!cv) return toast;
    const def = card(cv.cardId);
    if (sel.player !== YOU || def.kind !== 'creature') return toast + boardLines(def, []) + creatureStatus(cv) + cancel;
    // 我方的生物：技能按鈕放最上面，卡片說明就不再寫一次同樣的技能。
    const skills = skillsOf(cv);
    const bonus = skillBonus(cv);
    // 卡片說明照卡上的加成寫（沉默時也一樣），跳過的時候要用同樣的寫法比對。
    const skillLines = skills.map((skill) => describeAbility(skill, describeName, damageBonus(def)));
    const attacks = actsForAttack(sel.zone);
    const attackBlocked = myTurn && attacks.length === 0 ? attackReason(cv) : '';
    let body = '<div class="skills">';
    skills.forEach((skill, index) => {
      const acts = actsForSkill(sel.zone, index);
      const why = myTurn && acts.length === 0 ? skillReason(cv, skill, view.you) : '';
      // 跟下面攻擊的原因一樣（例如「召喚當回合不能攻擊、不能發動技能」）就只寫一次。
      const reason = why === attackBlocked ? '' : why;
      body += `<button class="skill" data-skill="${sel.zone}:${index}" ${acts.length === 0 ? 'disabled' : ''}>
        ${costBadge(skill)}<span class="skill-text">${rich(`${skill.name}：${describeEffects(skill, describeName, bonus)}`)}</span>
        ${reason ? `<span class="skill-why">${esc(reason)}</span>` : ''}</button>`;
    });
    body += '</div>';
    body += boardLines(def, skillLines) + creatureStatus(cv);
    const orSkill = skills.length > 0 ? '技能另外算，每回合也可以發動一次（花能量，不會被反擊）。' : '';
    body +=
      attacks.length > 0
        ? `<p class="hint">點發光的對手生物或英雄攻擊：不花能量，打生物時對方會反擊。${orSkill}</p>`
        : attackBlocked
          ? `<p class="hint blocked">${esc(attackBlocked)}</p>`
          : '';
    const dismiss = app.legalActions.find((a) => a.type === 'dismiss' && a.zone === sel.zone);
    if (dismiss && sel.confirmDismiss) {
      const extra = cv.item === null && cv.evolutionChain.length === 1 ? '' : '（進化前的牌和道具也一起）';
      body += `<p class="hint blocked">${esc(def.name)}會送進棄牌區${extra}，不能收回。</p>
        <div class="respond"><button class="primary" data-do="dismiss-confirm">確定退場</button><button class="ghost" data-do="dismiss-cancel">留著</button></div>`;
    } else if (dismiss) {
      body += '<button class="ghost" data-do="dismiss">退場（空出這一格）</button>';
    }
    return toast + body + cancel;
  }

  if (sel.kind === 'entry') {
    const held = view.you.hand.find((c) => c.uid === sel.uid);
    const def = held ? card(held.cardId) : null;
    const entry = def?.kind === 'creature' ? def.entry : undefined;
    if (!entry) return toast;
    return (
      toast +
      `<p class="d-head">選擇進場效果的目標</p><p class="d-line">${esc(def!.name)} 放在 ${ZONE[sel.zone]}</p>
       <p class="d-line">${rich(describeEntry(entry, describeName, def?.kind === 'creature' ? damageBonus(def) : 0))}</p><p class="hint">發光的就是可以選的目標。</p>` +
      cancel
    );
  }

  if (sel.kind === 'skill' || sel.kind === 'heroPower') {
    const ability = sel.kind === 'skill' ? skillsOf(view.you.zones[sel.zone]!)[sel.skill]! : powerOf(view.you)!.power;
    const bonus = sel.kind === 'skill' ? skillBonus(view.you.zones[sel.zone]!) : 0;
    return toast + `<p class="d-head">選擇目標</p><p class="d-line">${rich(describeAbility(ability, describeName, bonus))}</p><p class="hint">發光的就是可以選的目標。</p>` + cancel;
  }

  if (sel.kind === 'hero') {
    const side = sel.player === YOU ? view.you : view.opponent;
    const evolved = side.heroEvolution ? lines(describeCard(card(side.heroEvolution), describeName)) : '';
    return toast + lines(describeHero(hero(side.heroId), describeName)) + evolved + `<ul class="tags"><li>♥ ${side.heroHp} / ${side.heroMaxHp}</li></ul>` + cancel;
  }

  const side = sel.player === YOU ? view.you : view.opponent;
  return toast + (side.field ? lines(describeCard(card(side.field), describeName)) : '<p class="d-head">場地區是空的</p>') + cancel;
}

// ─── 牌桌 ────────────────────────────────────────────────────────────────────

function zone(cv: CreatureView | null, player: PlayerId, index: number, picks: Map<string, Action>, view: PlayerView): string {
  const key = `z${player}${index}`;
  const sel = app.selection;
  const selected = sel?.kind === 'creature' && sel.player === player && sel.zone === index;
  const classes = ['zone'];
  if (picks.has(key)) classes.push('pick');
  if (selected || ((sel?.kind === 'skill' || sel?.kind === 'entry') && player === YOU && sel.zone === index)) classes.push('selected');
  if (!cv) {
    return `<button class="${classes.join(' ')} empty" data-key="${key}" aria-label="${player === YOU ? '你' : '對手'}的 ${ZONE[index]} 空格"><span class="zone-num">${ZONE[index]}</span></button>`;
  }
  const def = card(cv.cardId);
  const myTurn = myMove(view);
  // 輪到你時：還能攻擊或發動技能的發亮；什麼都不能做了（剛召喚、攻擊過而技能用過或能量不夠）就變淡。
  if (player === YOU && myTurn) {
    const ready = actsForAttack(index).length > 0 || skillsOf(cv).some((_, i) => actsForSkill(index, i).length > 0);
    classes.push(ready ? 'ready' : 'spent');
  }
  if (cv.taunting) classes.push('taunt');
  if (cv.shield) classes.push('shielded');
  const badges: string[] = [];

  if (cv.damageReduction) badges.push(`<i class="badge def">減${cv.damageReduction}</i>`);
  if (cv.item) badges.push(`<i class="badge item" title="${esc(nameOf(cv.item))}">${esc(nameOf(cv.item))}</i>`);
  if (cv.shield) badges.push('<i class="badge shield">聖盾</i>');
  if (cv.taunting) badges.push('<i class="badge taunt">挑釁</i>');
  if (def.kind === 'creature' && def.triggers?.length && !cv.silenced) badges.push('<i class="badge death">持續</i>');
  if (def.kind === 'creature' && def.death && !cv.silenced) badges.push('<i class="badge death">遺言</i>');
  if (cv.poison) badges.push(`<i class="badge poison">毒${cv.poison}</i>`);
  if (cv.burn) badges.push(`<i class="badge burn">燒${cv.burn}</i>`);
  if (cv.paralyzed) badges.push('<i class="badge para">麻痺</i>');
  if (cv.silenced) badges.push('<i class="badge silence">沉默</i>');
  if (cv.weakened) badges.push('<i class="badge weak">虛弱</i>');
  // 滿血是綠色，受過傷是紅色；攻擊力有加成時標成金色。
  const hurt = cv.hp < cv.maxHp ? ' hurt' : ' full';
  const buffed = cv.attackBonus > 0 ? ' up' : '';
  // 左上角顯示這隻生物總共花了多少費用，進化過的顯示成 4+3，一眼看出對手在牠身上投資了多少。
  // 衍生物沒有費用，標成「衍」。
  const invested = def.kind === 'creature' && def.token ? '衍' : cv.evolutionChain.map((id) => card(id).cost).join('+');
  // 背景是這隻生物目前那張卡的插圖，上下加深，字才看得清楚。
  classes.push('has-art');
  return `<button class="${classes.join(' ')} r-${def.rarity}" data-key="${key}" style="--art:url('${artUrl(def.id)}')" aria-label="${esc(def.name)}，費用 ${invested}，攻擊 ${cv.attack}，血量 ${cv.hp}">
    <span class="z-cost">${invested}</span><span class="z-name">${esc(def.name)}</span>${pips(def.colors)}
    <span class="z-foot"><span class="rarity">${def.rarity}</span><span class="badges">${badges.join('')}</span><span class="z-stats"><span class="z-atk${buffed}" title="攻擊">⚔<b>${cv.attack}</b></span><span class="z-hp${hurt}" title="血量"><i aria-hidden="true">♥</i><b>${cv.hp}</b><small>/${cv.maxHp}</small></span></span></span>
  </button>`;
}

function energyRow(side: SideView): string {
  const slots = Array.from({ length: side.ceiling }, (_, i) =>
    `<i class="crystal ${i < side.energy ? 'on' : i < side.maxEnergy ? 'spent' : 'locked'}"></i>`,
  ).join('');
  return `<div class="energy" aria-label="能量 ${side.energy} / ${side.maxEnergy}">
    <span class="e-label">能量</span><span class="crystals">${slots}</span>
    <span class="e-count"><b>${side.energy}</b>/${side.maxEnergy}</span></div>`;
}

function heroPlate(side: SideView, player: PlayerId, picks: Map<string, Action>): string {
  const h = hero(side.heroId);
  const key = `h${player}`;
  // 打倒時可能扣到負的，畫面上寫 0。
  const hp = Math.max(0, side.heroHp);
  // 英雄 HP 沒有上限：回復超過起始 HP 時，血條滿格。
  const pct = Math.min(100, Math.round((hp / side.heroMaxHp) * 100));
  const classes = ['hero', side.heroHp < side.heroMaxHp ? 'hurt' : 'full'];
  if (picks.has(key)) classes.push('pick');
  if (app.selection?.kind === 'hero' && app.selection.player === player) classes.push('selected');
  const extra = '';
  const name = side.heroEvolution ? nameOf(side.heroEvolution) : h.name;
  if (side.heroEvolution) classes.push('evolved');
  // 背景是英雄（進化後是英雄進化卡）的插圖。
  const art = side.heroEvolution ?? side.heroId;
  return `<button class="${classes.join(' ')}" data-key="${key}" style="--art:url('${artUrl(art)}')" aria-label="${esc(name)}，血量 ${hp}">
    <span class="h-name">${esc(name)}</span>${pips(h.colors)}
    <span class="h-hp"><i aria-hidden="true">♥</i><b>${hp}</b><small>/${side.heroMaxHp}</small></span>
    <span class="h-bar"><i style="width:${pct}%"></i></span>${extra}</button>`;
}

function sideRows(side: SideView, player: PlayerId, picks: Map<string, Action>, view: PlayerView): string {
  const fieldKey = `f${player}`;
  const fieldClasses = ['field'];
  if (picks.has(fieldKey)) fieldClasses.push('pick');
  const field = `<button class="${fieldClasses.join(' ')}${side.field ? ' filled' : ''}" data-key="${fieldKey}" aria-label="場地區">
    <span class="f-label">場地</span><span class="f-name">${side.field ? esc(nameOf(side.field)) : '—'}</span></button>`;
  // 場地區在擁有者的左邊、牌庫與棄牌在右邊；對手那側轉了 180°，左右相反，跟 docs/board.svg 一致。
  const zones = side.zones.map((cv, i) => zone(cv, player, i, picks, view)).join('');
  const discard = `<div class="pile"><span>棄牌</span><b>${side.discard.length}</b></div>`;
  const deck = `<div class="pile deck-pile${side.deckCount === 0 ? ' empty' : ''}">${cardBack(backFor(player))}<span>牌庫</span><b>${side.deckCount}</b></div>`;
  const mine = player === YOU;
  const creatures = `<div class="row creatures">${mine ? field + zones + discard : discard + zones + field}</div>`;
  const energy = `<div class="row energy-row">${mine ? `<span></span>${energyRow(side)}${deck}` : `${deck}${energyRow(side)}<span></span>`}</div>`;

  let heroRow = `<div class="row hero-row">${heroPlate(side, player, picks)}`;
  heroRow += player === YOU ? powerPill(side, true) : heroInfo(side, player);
  heroRow += '</div>';
  return player === YOU ? creatures + energy + heroRow : heroRow + energy + creatures;
}

function hand(view: PlayerView): string {
  const cards = view.you.hand
    .map((held) => {
      const def = card(held.cardId);
      const playable = actsForCard(held.uid).length > 0;
      const selected = app.selection?.kind === 'hand' && app.selection.uid === held.uid;
      // 這回合已經打出過牌：有連擊的卡標亮，提醒現在打會多一段。
      const combo = playable && view.you.playedThisTurn > 0 && hasCombo(def);
      return cardFace(def, {
        attrs: `data-hand="${held.uid}"`,
        classes: [...(playable ? ['playable'] : []), ...(selected ? ['selected'] : []), ...(combo ? ['combo-ready'] : [])],
      });
    })
    .join('');
  return `<div class="hand" aria-label="你的手牌">${cards || '<p class="empty-hand">沒有手牌</p>'}</div>`;
}

function overlay(view: PlayerView): string {
  if (view.choice && view.phase === 'main') {
    // 看牌庫頂選牌：翻開的牌只有你看得到，選好張數才能確定。
    const { cards: shown, pick } = view.choice;
    const cards = shown
      .map((held) => {
        const def = card(held.cardId);
        const picked = app.picks.includes(held.uid);
        return cardFace(def, {
          attrs: `data-pick="${held.uid}" aria-pressed="${picked}"`,
          classes: picked ? ['picked'] : [],
          ...(picked ? { mark: '加入手牌' } : {}),
        });
      })
      .join('');
    const focus = app.picks.length > 0 ? lines(describeCard(card(shown.find((c) => c.uid === app.picks.at(-1))!.cardId), nameOf)) : '';
    return `<div class="overlay"><div class="dialog" role="dialog" aria-label="選牌">
      <h2>${esc(view.choice.ability)}</h2>
      <p class="d-line">牌庫頂的 ${shown.length} 張，選 ${pick} 張加入手牌，其餘放回牌庫底。對手看不到你翻開了什麼。</p>
      <div class="mull-hand">${cards}</div>
      ${focus ? `<div class="pick-focus">${focus}</div>` : ''}
      <button class="primary" data-do="choose" ${app.picks.length === pick ? '' : 'disabled'}>加入手牌（${app.picks.length}/${pick}）</button>
    </div></div>`;
  }
  if (view.phase === 'mulligan' && !view.you.mulliganDone) {
    const first = view.firstPlayer === YOU;
    const cards = view.you.hand
      .map((held) => {
        const def = card(held.cardId);
        const marked = app.redraw.includes(held.uid);
        return cardFace(def, {
          attrs: `data-mull="${held.uid}" aria-pressed="${marked}"`,
          classes: marked ? ['marked'] : [],
          ...(marked ? { mark: '重抽' } : {}),
        });
      })
      .join('');
    const plate = (id: string, label: string) =>
      `<div class="vs-hero"><span class="vs-label">${label}</span>${lines(describeHero(hero(id), describeName).map((line) => line.replace(/^天生技 /, '')))}</div>`;
    return `<div class="overlay"><div class="dialog" role="dialog" aria-label="起手">
      <h2>起手</h2>
      <p class="d-line">你是<b>${first ? '先攻' : '後攻'}</b>，${first ? '第一回合 1 點能量' : '第一回合 2 點能量'}。先看對手是誰，再決定要不要重抽。</p>
      <div class="versus">${plate(view.you.heroId, '你')}${plate(view.opponent.heroId, '對手')}</div>
      <p class="d-line">點選要洗回牌庫重抽的牌，可以選任意張，只能重抽一次。</p>
      <div class="mull-hand">${cards}</div>
      <div class="mull-info">${view.you.hand.map((held) => `<div class="mull-card">${boardLines(card(held.cardId), [])}</div>`).join('')}</div>
      <button class="primary" data-do="mulligan">${app.redraw.length ? `重抽 ${app.redraw.length} 張` : '保留這手牌'}</button>
    </div></div>`;
  }
  if (view.phase === 'mulligan' && app.mode === 'online') {
    return `<div class="overlay"><div class="dialog" role="dialog" aria-label="等對手"><h2>等${esc(themName())}決定起手</h2>
      <p class="d-line">雙方都決定好要不要重抽，對局就會開始。</p></div></div>`;
  }
  if (view.phase === 'over' && view.result) {
    const { winner, reason } = view.result;
    const why = { heroDefeated: '英雄被打倒', deckOut: '牌庫抽完', concede: '投降' }[reason];
    const title = winner === 'draw' ? '平手' : winner === YOU ? '勝利' : '落敗';
    const asked = online.room?.rematch;
    const actions =
      app.mode === 'online' && app.rankedRoom
        ? '<div class="end-actions"><button class="primary" data-do="requeue">再排一場</button><button class="ghost" data-do="leave-room">回到開局</button></div>'
        : app.mode === 'online'
        ? asked?.[YOU]
          ? `<p class="d-line">等${esc(themName())}也按「再來一局」……</p><button class="ghost" data-do="leave-room">離開房間</button>`
          : `${asked?.[THEM()] ? `<p class="d-line">${esc(themName())}想再來一局</p>` : ''}
             <div class="end-actions"><button class="primary" data-do="rematch">再來一局</button><button class="ghost" data-do="leave-room">離開房間</button></div>`
        : app.adventure
          ? `<div class="end-actions"><button class="primary" data-do="adventure">回到冒險</button><button class="ghost" data-do="again">${winner === YOU ? '再打一次' : '再挑戰一次'}</button></div>`
          : '<div class="end-actions"><button class="primary" data-do="again">再來一局</button><button class="ghost" data-do="setup">換英雄</button><button class="ghost" data-do="shop">卡包與收藏</button></div>';
    return `<div class="overlay"><div class="dialog end ${winner === YOU ? 'won' : 'lost'}" role="dialog" aria-label="${title}">
      <h2>${title}</h2><p class="d-line">${app.rankedRoom ? '排位賽・' : ''}${why}・共 ${view.turn} 回合</p>${adventureLines(winner === YOU)}${app.rankedRoom ? rankedLines() : rewardLines()}${actions}
    </div></div>`;
  }
  return '';
}

/** 冒險模式的結算：打贏時的劇情與通關獎勵。 */
function adventureLines(won: boolean): string {
  const stage = app.adventure ? ADVENTURE.find((each) => each.id === app.adventure!.stage) : undefined;
  if (!stage) return '';
  const head = `<p class="d-line"><b>${esc(stage.title)}</b>・${DIFFICULTY_NAMES[app.adventure!.difficulty]}</p>`;
  if (!won) return `${head}<p class="d-line">再調整一下牌組，回來挑戰吧。</p>`;
  const reward = app.stageReward;
  const gain = !reward
    ? ''
    : reward.error
      ? `<p class="d-line reward">通關沒有記到：${esc(reward.error)}</p>`
      : reward.gold > 0
        ? `<p class="d-line reward"><span class="gain">首次通關 +${reward.gold} 金幣</span></p>`
        : '<p class="d-line reward">這一關的通關獎勵已經領過了。</p>';
  return `${head}<p class="story">${esc(stage.outro)}</p>${gain}`;
}

/** 結算畫面上的金幣與任務進度。 */
function rewardLines(): string {
  const reward = app.reward;
  if (!reward) return '';
  if (reward.error) return `<p class="d-line reward">這局的金幣沒有記到：${esc(reward.error)}</p>`;
  if (reward.conceded) return '<p class="d-line reward">投降的對局不算金幣與任務進度。</p>';
  const lines: string[] = [];
  if (reward.winGold > 0) lines.push(`<span class="gain">+${reward.winGold} 金幣</span>（今天贏場 ${app.profile.winGoldToday}/${ECONOMY.dailyWinGoldCap}）`);
  else if (app.view?.result?.winner === YOU) lines.push(`今天贏場金幣已經拿滿 ${ECONOMY.dailyWinGoldCap} 了`);
  if (reward.questGold > 0) lines.push(`<span class="gain">每日任務完成 +${reward.questGold} 金幣</span>`);
  else if (reward.quest && !app.profile.quest.done) lines.push(`每日任務：${esc(reward.quest)}`);
  lines.push(`金幣 ${app.profile.gold}`);
  return `<div class="reward">${lines.map((line) => `<p class="d-line">${line}</p>`).join('')}</div>`;
}

/** 「怎麼玩」的規則說明：開局畫面與對戰畫面最下面共用。 */
const howtoList = () => `<ul>
        <li>能量：先攻第一回合 1 點、後攻 2 點，之後每回合上限 +2，最高 12。每個回合開始時補滿。</li>
        <li>點手牌出牌。生物要選一個空格召喚；道具要選自己的生物；進化卡要點場上對應的生物。</li>
        <li>每隻生物有攻擊力（⚔）和血量（♥）。血量滿的是綠色，受過傷的是紅色。</li>
        <li>點你的生物，再點發光的對手生物或英雄就是攻擊：不花能量，只打得到正前方與左右兩個斜對角的生物，那幾格有一格空著就能打到英雄。打生物時對方會用牠的攻擊力反擊，打英雄不會被反擊。技能要花能量，不會被反擊。攻擊和技能每隻每回合各一次，可以都用；召喚當回合都不行（有【速攻】的例外；進化卡都算有速攻，召喚當回合就能進化、進化完馬上能動）。</li>
        <li>標「休息」的技能不花能量，但這回合還沒攻擊才能用，用了這回合就不能攻擊（例如挑釁）。</li>
        <li>正對面、斜對角的技能，目標格空著就會打到後面的英雄。</li>
        <li>對手的生物在挑釁時，打得到牠的攻擊只能打牠；選得到牠的技能也必須打牠，只打英雄的技能不受影響。</li>
        <li>手牌上限 10 張，滿手時抽到的牌直接進棄牌區。場地卡放在自己的場地區，只強化自己的生物。</li>
        <li>有些英雄有英雄進化卡：血量上限增加、天生技變強，每局只能進化一次。</li>
        <li>每隻生物有種族，大多有種族特色，數字是強度：人類<b>同袍 N</b>（有其他人類時 ⚔ +N）、野獸<b>猛撲</b>（召喚當回合就能攻擊生物）、亡靈<b>不死 N</b>（第一次倒下留 N♥）、元素<b>元素之力 N</b>（技能傷害 +N）、植物<b>扎根 N</b>（回合開始回復 N♥）、龍<b>龍鱗</b>（不中異常狀態）、機械<b>堅固 N</b>（受到傷害 −N）、天使<b>光輝 N</b>（召喚時英雄回復 N♥）。沉默時種族特色也失效。</li>
        <li>卡上的粗體字是關鍵字，點卡片看說明時，下面會用小字解釋。</li>
        <li>有<b>遺言</b>的生物死掉時（被打倒或被消滅）會發動效果，例如召喚衍生物、抽牌、回血或範圍傷害。有持續效果（<b>回合開始</b>、<b>回合結束</b>、<b>每當回復</b>）的生物，在場上時每當條件成立就自動發動。沉默中都不發動。</li>
        <li>異常狀態只會中在生物身上：中毒（施放者的回合結束時失去血量，減傷擋不住）、灼燒（施放者的回合結束時受到傷害）、麻痺（不能攻擊也不能發動技能）、沉默（不能發動技能、吸血與再生失效，身上的增益與挑釁直接消失）、虛弱（不能攻擊，也不會反擊）。後面三種都到牠的下個回合結束，進化會解除全部。</li>
        <li>英雄的血量沒有上限：回復可以把英雄補到比開局還高（例如 40 補到 48）。生物的血量還是有上限。</li>
        <li>把對手英雄的血量打到 0 就贏了。要抽牌但牌庫已經空了就輸（卡牌效果的抽牌也算）。</li>
      </ul>`;

/** 貼上牌組代碼的視窗。 */
function importDialog(): string {
  if (!app.importing) return '';
  return `<div class="overlay"><div class="dialog" role="dialog" aria-label="貼上牌組代碼">
    <h2>貼上牌組代碼</h2>
    <p class="d-line">朋友在組牌畫面按「複製牌組代碼」，把那串 CG1- 開頭的文字貼在這裡，就會多一副一樣的牌組。
      收藏裡缺的卡照樣會放進去，但要補齊（開卡包或用粉塵合成）之後才能拿來開局。</p>
    <textarea id="deck-code-in" rows="3" placeholder="CG1-……">${esc(app.importText)}</textarea>
    <div class="respond"><button class="primary" data-do="import-confirm">加成新牌組</button><button class="ghost" data-do="import-cancel">取消</button></div>
  </div></div>`;
}

/** 背景音樂與音效的開關。 */
const musicButton = () =>
  `<button class="ghost small" data-do="music" aria-pressed="${music.enabled}">${music.enabled ? '♪ 音樂：開' : '♪ 音樂：關'}</button>` +
  `<button class="ghost small" data-do="sfx" aria-pressed="${music.sfxEnabled}">${music.sfxEnabled ? '音效：開' : '音效：關'}</button>`;

function playScreen(): string {
  const view = app.view!;
  const picks = choices();
  const myTurn = myMove(view);
  const banner =
    view.phase === 'mulligan'
      ? '起手'
      : view.phase === 'over'
        ? '對局結束'
        : `第 ${view.turn} 回合・${view.activePlayer === YOU ? '你的回合' : `${themName()}的回合`}`;
  const turnButton = `<button class="end-turn" data-do="end" ${myTurn ? '' : 'disabled'}>結束回合</button>`;
  const log = app.log.map((l) => `<li class="t-${l.tone}">${esc(l.text)}</li>`).join('');
  return `${tutorialPanel()}<div class="table">
    <section class="board${picks.size ? ' targeting' : ''}" aria-label="牌桌">
      ${sideRows(view.opponent, THEM(), picks, view)}
      <div class="midline"><span class="turn">${banner}</span>
        ${turnButton}</div>
      ${sideRows(view.you, YOU, picks, view)}
      ${hand(view)}
    </section>
    <aside class="panel">
      <div class="detail${app.selection || app.toast ? ' floating' : ''}">${detail(view)}</div>
      <div class="log-wrap"><p class="log-title">對戰紀錄</p><ol class="log">${log}</ol></div>
      <div class="panel-tools">
        <button class="ghost small" data-do="concede" ${view.phase === 'main' ? '' : 'disabled'}>投降</button>
        <button class="ghost small" data-do="density" aria-pressed="${compact()}">${compact() ? '放大卡牌' : '縮小卡牌'}</button>
        ${document.fullscreenEnabled ? `<button class="ghost small" data-do="fullscreen">${document.fullscreenElement ? '離開全螢幕' : '全螢幕'}</button>` : ''}
        ${musicButton()}
      </div>
    </aside>
  </div>
  <details class="howto play-howto"><summary>怎麼玩</summary>${howtoList()}</details>${overlay(view)}`;
}

/** 登入畫面：測試帳號，或 Google 帳號（要從遊戲伺服器打開、而且伺服器設定了 Google 登入）。 */
function loginScreen(): string {
  const google = !ONLINE_AVAILABLE
    ? '<p class="d-line warn">這個網頁不是從遊戲伺服器打開的，不能用 Google 登入。要用的話，照 README 開遊戲伺服器。</p>'
    : !GOOGLE_CLIENT_ID
      ? '<p class="d-line warn">遊戲伺服器還沒設定 Google 登入（要設定 GOOGLE_CLIENT_ID，見 README）。</p>'
      : app.loggingIn
        ? '<p class="d-line">登入中……</p>'
        : '<div id="google-button" class="google-slot"></div>';
  return `<main class="setup login">
    <header><h1>卡牌試玩桌</h1><p>登入後開始收集卡片、拿金幣、解每日任務。</p></header>
    <div class="login-options">
      <section class="login-card">
        <p class="d-head">測試帳號</p>
        <p class="d-line">一進來就有 10000 金幣、全部的卡都收滿、UR 英雄都有，方便試玩各種牌組。資料存在這個瀏覽器裡，隨時可以重設。</p>
        <button class="primary big" data-do="login-test" ${app.loggingIn ? 'disabled' : ''}>用測試帳號進入</button>
      </section>
      ${
        ONLINE_AVAILABLE
          ? `<section class="login-card">
        <p class="d-head">帳號（名字＋密碼）</p>
        <p class="d-line">金幣、收藏與牌位存在遊戲伺服器上，登出或換電腦都能用名字和密碼登回來。可以打排位賽。新帳號送五個基礎英雄的起始牌組與 100 金幣。
          以前的訪客帳號：用原本的名字、設一個新密碼按「登入」就能拿回來（同名的會合併）。</p>
        <label class="field-row"><span>名字</span><input id="guest-name" maxlength="16" placeholder="對手會看到這個名字" value="${esc(app.guestName)}" autocomplete="username"></label>
        <label class="field-row"><span>密碼</span><input id="guest-password" type="password" maxlength="200" placeholder="至少 4 個字" value="${esc(app.guestPassword)}" autocomplete="current-password"></label>
        <div class="login-actions">
          <button class="primary" data-do="login-password" ${app.loggingIn ? 'disabled' : ''}>登入</button>
          <button class="ghost" data-do="register-password" ${app.loggingIn ? 'disabled' : ''}>開新帳號</button>
        </div>
      </section>`
          : ''
      }
      <section class="login-card">
        <p class="d-head">Google 帳號</p>
        <p class="d-line">金幣與收藏存在遊戲伺服器上，換電腦也還在。新帳號送五個基礎英雄的起始牌組與 100 金幣。</p>
        ${google}
      </section>
    </div>
    ${app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : ''}
  </main>`;
}

function setupScreen(): string {
  // 基礎英雄每個人都有；多色的 UR 英雄沒抽到就鎖著，看得到但不能選。
  const heroes = HEROES.map((h) => {
    // 被動、天生技、可進化各一行；天生技不寫「天生技」三個字，直接寫名字。
    const [head, ...body] = describeHero(h, describeName).map((line) => line.replace(/^天生技 /, ''));
    const evolution = SAMPLE_CARDS.find((c) => c.kind === 'heroEvolution' && c.evolvesFrom === h.id);
    const evolves = evolution ? `<span class="hp-line hp-evo">可進化為 ${esc(evolution.name)}（${evolution.cost}）</span>` : '';
    const chosen = h.id === app.heroId;
    const locked = !ownsHero(app.profile, db, h.id);
    return `<button class="hero-pick${chosen ? ' chosen' : ''}${locked ? ' locked' : ''}" data-hero="${h.id}" aria-pressed="${chosen}" ${locked ? 'disabled' : ''}>
      <span class="hp-art" style="--art:url('${artUrl(h.id)}')" aria-hidden="true">
        <span class="hp-hp"><b class="hp-big">${h.hp}</b><span class="hp-unit">♥</span></span>${h.rarity ? '<b class="hp-ur">UR</b>' : ''}</span>
      <span class="hp-name">${pips(h.colors)}${esc(h.name)}</span>
      <span class="hp-text">${body.map((line) => `<span class="hp-line">${rich(line)}</span>`).join('')}${evolves}</span>${locked ? '<span class="hp-lock">還沒有：卡包抽到或用 1000 粉塵合成</span>' : ''}
      <span class="sr">${esc(head ?? '')}</span></button>`;
  }).join('');
  const chosen = chosenDeck(app.heroId);
  const problems = chosen ? deckIssues(db, app.heroId, chosen.cards, owned()).problems : [];
  const colors = describeColors(hero(app.heroId).colors);
  const deckText = !chosen
    ? `每局從收藏裡${colors}與無色的卡自動組一副（進化線照 2/2 帶）。`
    : problems.length
      ? `「${chosen.name}」還不能用：${problems[0]}`
      : `用「${chosen.name}」開局。`;
  // 這個英雄的牌組：點一下選來開局用，旁邊的「編輯」進組牌畫面。
  const myDecks = app.book.decks.filter((deck) => deck.heroId === app.heroId);
  const deckItems = [
    `<button class="deck-item${chosen ? '' : ' on'}" data-deck-pick="auto" aria-pressed="${!chosen}"><b>自動組牌</b><small>用收藏自動組一副</small></button>`,
    ...myDecks.map((deck) => {
      const status = deckStatus(db, deck, owned());
      const on = chosen?.id === deck.id;
      return `<span class="deck-item${on ? ' on' : ''}${status.ok ? '' : ' bad'}">
        <button class="deck-pick" data-deck-pick="${deck.id}" aria-pressed="${on}"><b>${esc(deck.name)}</b><small>${deck.cards.length}/${DEFAULT_RULES.deckSize}・${status.text}</small></button>
        <button class="ghost small" data-deck-edit="${deck.id}">編輯</button></span>`;
    }),
  ].join('');
  const who = app.session;
  return `<main class="setup">
    <header class="setup-head"><div><h1>卡牌試玩桌</h1><p>${
      ONLINE_AVAILABLE
        ? '選一名英雄，跟電腦打，或開一個房間跟朋友連線對戰。'
        : '選一名英雄，跟電腦打一局。對手的英雄隨機，開局時會先告訴你是誰。'
    }</p></div>
      ${who ? `<div class="who">${who.account.picture ? `<img src="${esc(who.account.picture)}" alt="" referrerpolicy="no-referrer">` : ''}
        <span>${esc(who.account.name)}${who.kind === 'google' ? '<small>Google</small>' : ''}</span>
        ${who.kind === 'test' ? '<button class="ghost small" data-do="reset-test">重設</button>' : ''}
        ${musicButton()}<button class="ghost small" data-do="logout">登出</button></div>` : ''}
    </header>
    ${walletBar(app.profile)}
    ${PREVIEW ? `<p class="notice" role="status">${ACCOUNT_PREVIEW ? '超級帳號' : '預覽模式'}：看得到還沒發布的卡包（${esc(CARD_SETS.filter((set) => !set.released).map((set) => set.name).join('、'))}），可以開包、組牌、跟電腦打。${ACCOUNT_PREVIEW ? '連線對戰只能用已發布的卡。' : '預覽建議用測試帳號。'}</p>` : ''}
    <div class="heroes">${heroes}</div>
    <section class="deck-bar">
      <div class="deck-head"><div><p class="d-head">牌組・${esc(hero(app.heroId).name)}</p><p class="d-line${problems.length ? ' warn' : ''}">${esc(deckText)}</p></div>
        <div class="deck-actions"><button class="ghost" data-do="deck-new">新增牌組</button><button class="ghost" data-do="deck-import">貼上代碼</button></div></div>
      <div class="deck-list">${deckItems}</div>
    </section>
    ${importDialog()}
    <div class="modes">
      ${tutorialMode()}
      ${adventureMode()}
      ${botMode(problems.length > 0)}
      ${rankedPanel(problems.length > 0)}
      ${friendlyMode(problems.length > 0)}
    </div>
    ${app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : ''}
    <section class="howto">
      <h2>怎麼玩</h2>
      ${howtoList()}
      <p class="note">試玩說明：範例卡有 ${SAMPLE_CARDS.length} 張，牌組照正式規則：${DEFAULT_RULES.deckSize} 張、同名最多 ${DEFAULT_RULES.maxCopies} 張、UR 最多 ${DEFAULT_RULES.maxUrCopies} 張、只能放英雄顏色內的卡與無色卡。
        你可以用收藏裡的卡自己組牌；電腦每局從全部的卡自動組一副。電腦用的是模擬平衡時的均衡打法。
        測試帳號的金幣與收藏存在這個瀏覽器裡；Google 帳號的存在遊戲伺服器上。牌組都存在這個瀏覽器裡。</p>
    </section>
  </main>`;
}

/** 排位賽：牌位、這季戰績、開始排位、排行榜。只有伺服器帳號（訪客、Google）能打。 */
function rankedPanel(blocked: boolean): string {
  if (!ONLINE_AVAILABLE) {
    return `<section class="mode ranked"><p class="mode-title">牌位</p>
      <p class="d-line">排位賽要從遊戲伺服器打開網頁才能打（見 README 的「部署在這台機器」）。</p></section>`;
  }
  if (!app.session || app.session.kind === 'test') {
    return `<section class="mode ranked"><p class="mode-title">牌位</p>
      <p class="d-line">排位賽要用伺服器上的帳號（名字＋密碼或 Google），結果才記得住、也才公平。登出後在登入畫面開一個帳號就能打。</p></section>`;
  }
  const rank = app.rank;
  const rows = (app.leaderboard ?? [])
    .slice(0, 10)
    .map(
      (row, i) => `<li><span class="lb-n">${i + 1}</span><span class="lb-name">${esc(row.name)}</span>
        <span class="lb-rank tier-${row.tier}">${esc(rankLabel({ ...row, season: '', streak: 0, best: row.tier }))}</span><span class="lb-wl">${row.wins} 勝 ${row.losses} 敗</span></li>`,
    )
    .join('');
  return `<section class="mode ranked">
    <div class="rank-main">
      <p class="mode-title">牌位${rank ? `<small>${esc(rank.season)} 賽季</small>` : ''}</p>
      ${rank ? `<p class="rank-now tier-${rank.tier}">${esc(rankLabel(rank))}</p><p class="d-line">本季 ${rank.wins} 勝 ${rank.losses} 敗${rank.streak >= 2 ? `・${rank.streak} 連勝` : ''}</p>` : ''}
      <p class="d-line">贏 +1 星、輸 −1 星，鑽石以下 2 連勝起每場多 +1；銅牌、銀牌不會掉段。每月換季發獎勵。牌組只能放收藏裡有的卡。</p>
      <button class="primary" data-do="queue" ${blocked ? 'disabled' : ''}>開始排位</button>
    </div>
    ${rows ? `<div class="leaderboard"><p class="d-head">本季排行</p><ol>${rows}</ol></div>` : ''}
  </section>`;
}

/** 排位賽排隊中。 */
function queueScreen(): string {
  const waited = app.queue ? Math.max(0, Math.floor((Date.now() - app.queue.since) / 1000)) : 0;
  return `<main class="setup lobby">
    <header><h1>配對中……</h1><p>找牌位相近的對手；等越久範圍越大，30 秒後誰都配。</p></header>
    <section class="deck-bar"><div><p class="d-head">已經等了 ${waited} 秒</p>
      <p class="d-line">隊伍裡有 ${app.queue?.waiting ?? 1} 個人・${esc(hero(app.heroId).name)}${app.rank ? `・${esc(rankLabel(app.rank))}` : ''}</p></div>
      <button class="ghost" data-do="unqueue">取消排隊</button></section>
    ${app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : ''}
  </main>`;
}

/** 排位賽結束的結果：牌位變化與金幣。 */
function rankedLines(): string {
  const report = app.rankedReport;
  if (!report) return '<p class="d-line reward">結算中……</p>';
  const delta = report.starsDelta > 0 ? `+${report.starsDelta} 星` : report.starsDelta < 0 ? `${report.starsDelta} 星` : '星星不變';
  const lines = [
    `${esc(rankLabel(report.before))} → <b>${esc(rankLabel(report.after))}</b>（${report.after.tier >= 5 ? `分數 ${Math.round(report.after.mmr - report.before.mmr) >= 0 ? '+' : ''}${Math.round(report.after.mmr - report.before.mmr)}` : delta}）`,
  ];
  if (report.promoted) lines.push(`<span class="gain">升上${TIERS[report.after.tier]}！</span>`);
  if (report.demoted) lines.push(`掉到${TIERS[report.after.tier]}了`);
  if (report.reward.winGold > 0) lines.push(`<span class="gain">+${report.reward.winGold} 金幣</span>`);
  if (report.reward.questGold > 0) lines.push(`<span class="gain">每日任務完成 +${report.reward.questGold} 金幣</span>`);
  return `<div class="reward">${lines.map((line) => `<p class="d-line">${line}</p>`).join('')}</div>`;
}

/** 開始排位賽：用現在的英雄與牌組排隊。 */
function startQueue(): void {
  const session = app.session;
  if (!session || session.kind === 'test') return;
  const deck = myDeck();
  resetGameRecord(deck);
  Object.assign(app, { screen: 'queue', queue: { since: Date.now(), waiting: 1 }, toast: null, rankedReport: null });
  online.send({ t: 'queue', token: session.token, heroId: app.heroId, deck, back: chosenDeck(app.heroId)?.back ?? DEFAULT_BACK });
  render();
}

/** 開局畫面的四種玩法：新手教學。第一次玩的人標亮。 */
function tutorialMode(): string {
  const done = tutorialDone();
  return `<section class="mode mode-tutorial${done ? '' : ' fresh'}">
    <p class="mode-title">新手教學${done ? '' : '<small>第一次玩？從這裡開始</small>'}</p>
    <p class="d-line">一場大約 3 分鐘的引導對局，一步一步帶你召喚、攻擊、放技能、用法術、進化，還有攻擊範圍。</p>
    <button class="${done ? 'ghost' : 'primary'}" data-do="tut-start">${done ? '再玩一次' : '開始新手教學'}</button>
  </section>`;
}

/** 開局畫面上的冒險模式入口。 */
function adventureMode(): string {
  const cleared = ADVENTURE.filter((stage) => clearedOn(app.profile, stage.id).length > 0).length;
  return `<section class="mode mode-adventure">
    <p class="mode-title">冒險模式<small>黑霧之謎・${cleared}/${ADVENTURE.length} 關</small></p>
    <p class="d-line">一段小劇情，一關一個 BOSS。每一關第一次打過 +${ADVENTURE_REWARD} 金幣；惡夢難度的 BOSS 有專屬的強大能力。</p>
    <button class="primary" data-do="adventure">進入冒險</button>
  </section>`;
}

/** 冒險模式：關卡清單。用開局畫面選的英雄與牌組出戰。 */
function adventureScreen(): string {
  const chosen = chosenDeck(app.heroId);
  const problems = chosen ? deckIssues(db, app.heroId, chosen.cards, owned()).problems : [];
  const deckName = chosen ? `「${chosen.name}」` : '自動組牌';
  const stages = ADVENTURE.map((stage, index) => {
    const unlocked = stageUnlocked(app.profile, index);
    const cleared = clearedOn(app.profile, stage.id);
    const normal = hero(stage.boss.normal);
    const marks = (['normal', 'hard', 'nightmare'] as const)
      .map((d) => `<span class="stage-mark${cleared.includes(d) ? ' done' : ''}">${DIFFICULTY_NAMES[d]}${cleared.includes(d) ? ' ✓' : ''}</span>`)
      .join('');
    const buttons = (['normal', 'hard', 'nightmare'] as const)
      .map((d) => `<button class="${d === 'nightmare' ? 'ghost nightmare' : 'ghost'}" data-stage="${stage.id}" data-stage-level="${d}" ${unlocked && problems.length === 0 ? '' : 'disabled'}>${DIFFICULTY_NAMES[d]}</button>`)
      .join('');
    return `<section class="stage${unlocked ? '' : ' locked'}">
      <p class="stage-title">第 ${index + 1} 關・${esc(stage.title)}</p>
      <p class="d-line">BOSS：${esc(normal.name)}　${marks}</p>
      <p class="d-line">${unlocked ? (cleared.length > 0 ? '✓ 通關獎勵已經領過了' : `首次通關 +${ADVENTURE_REWARD} 金幣`) : '打過前一關才會解鎖'}</p>
      <div class="stage-buttons">${buttons}</div>
    </section>`;
  }).join('');
  return `<main class="setup adventure">
    <header class="setup-head"><div><h1>冒險模式・黑霧之謎</h1>
      <p>黑色的霧從大陸各地湧出，你一路追查源頭。普通、困難的 BOSS 用一般的能力；惡夢難度的 BOSS 有專屬的被動與天生技，一般玩家拿不到。</p></div>
      <button class="ghost" data-do="setup">回到開局</button></header>
    ${walletBar(app.profile)}
    <p class="d-line${problems.length ? ' warn' : ''}">出戰：${esc(hero(app.heroId).name)}・${esc(deckName)}${problems.length ? `——這副牌組還不能用：${esc(problems[0]!)}` : ''}（到開局畫面換英雄或牌組）</p>
    <div class="stages">${stages}</div>
    ${storyDialog()}
  </main>`;
}

/** 開打前的劇情，加上這次 BOSS 的能力。 */
function storyDialog(): string {
  const story = app.story;
  const stage = story ? ADVENTURE.find((each) => each.id === story.stage) : undefined;
  if (!story || !stage) return '';
  const boss = hero(story.difficulty === 'nightmare' ? stage.boss.nightmare : stage.boss.normal);
  return `<div class="overlay"><div class="dialog" role="dialog" aria-label="${esc(stage.title)}">
    <h2>${esc(stage.title)}・${DIFFICULTY_NAMES[story.difficulty]}</h2>
    <p class="story">${esc(stage.intro)}</p>
    <div class="vs-hero"><span class="vs-label">對手</span>${lines(describeHero(boss, describeName).map((line) => line.replace(/^天生技 /, '')))}</div>
    <div class="respond"><button class="primary" data-do="stage-fight">開始戰鬥</button><button class="ghost" data-do="stage-cancel">再想想</button></div>
  </div></div>`;
}

/** 跟電腦打：選難度。 */
function botMode(blocked: boolean): string {
  const chips = (['normal', 'hard'] as const)
    .map((d) => `<button class="chip${app.difficulty === d ? ' on' : ''}" data-difficulty="${d}" aria-pressed="${app.difficulty === d}">${d === 'normal' ? '普通' : '困難'}</button>`)
    .join('');
  return `<section class="mode">
    <p class="mode-title">電腦</p>
    <div class="chips" aria-label="電腦難度">${chips}</div>
    <p class="d-line">${app.difficulty === 'normal' ? '普通：只看眼前這一步，適合剛上手。' : '困難：會規劃整個回合、提防你下回合的攻擊。'}對手的英雄隨機，開局時會先告訴你是誰。</p>
    <button class="primary" data-do="start" ${blocked ? 'disabled' : ''}>跟電腦打</button>
  </section>`;
}

/** 友誼賽：開房間或用房號加入，跟朋友連線對戰（不算牌位）。 */
function friendlyMode(blocked: boolean): string {
  if (!ONLINE_AVAILABLE) {
    return `<section class="mode"><p class="mode-title">友誼賽</p>
      <p class="d-line">跟朋友連線對戰要從遊戲伺服器打開網頁（見 README 的「部署在這台機器」）。</p></section>`;
  }
  const invited = new URLSearchParams(location.search).get('room');
  return `<section class="mode online">
    <p class="mode-title">友誼賽<small>不算牌位</small></p>
    ${invited ? `<p class="invite">朋友邀請你加入房間 <b>${esc(invited.toUpperCase())}</b>：選好英雄和牌組，按「加入」。</p>` : ''}
    <label class="field-row"><span>你的名字</span>
      <input id="player-name" maxlength="16" placeholder="對手會看到這個名字" value="${esc(roomName())}" autocomplete="nickname"></label>
    <div class="online-actions">
      <button class="primary" data-do="create-room" ${blocked ? 'disabled' : ''}>開房間</button>
      <span class="or">或</span>
      <label class="join"><input id="room-code" maxlength="4" placeholder="房號" value="${esc(app.roomCode)}" autocomplete="off">
        <button class="primary" data-do="join-room" ${blocked ? 'disabled' : ''}>加入</button></label>
    </div>
  </section>`;
}

/** 開好房間、等朋友加入的畫面。 */
function lobbyScreen(): string {
  const room = online.room;
  if (!room) return '<main class="setup"><p class="d-line">連線中……</p></main>';
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  const friend = room.seats[THEM()];
  return `<main class="setup lobby">
    <header><h1>房間 ${esc(room.code)}</h1><p>把連結或房號傳給朋友，他打開、選好英雄按「加入」，對局就會開始。</p></header>
    <section class="deck-bar">
      <div><p class="d-head">邀請連結</p><p class="d-line"><code id="invite-link">${esc(link)}</code></p></div>
      <button class="ghost" data-do="copy-link">複製連結</button>
    </section>
    ${
      ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
        ? '<p class="toast" role="note">你是用 localhost 開的，這個連結只有你自己的電腦打得開。把網址換成朋友連得到的位址（同一個網路用終端機印出的區網網址，不同地方用通道網址），或直接把房號給他。</p>'
        : ''
    }
    <p class="d-line">${friend ? `${esc(friend.name)} 已經加入` : '等朋友加入……'}${online.connected ? '' : '（重新連線中）'}</p>
    ${app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : ''}
    <button class="ghost" data-do="leave-room">離開房間</button>
  </main>`;
}

// ─── 繪製與事件 ──────────────────────────────────────────────────────────────

function render(): void {
  const handScroll = root.querySelector('.hand')?.scrollLeft ?? 0;
  const editing = app.book.decks.find((deck) => deck.id === app.builder.deckId);
  if (app.screen === 'deck' && !editing) app.screen = 'setup';
  // 開著頁面跨過午夜：換成今天的任務（Google 帳號由伺服器在下一次存取時換）。
  const fresh = refreshDay(app.profile, today());
  if (fresh !== app.profile) {
    app.profile = fresh;
    if (app.session?.kind === 'test') saveTestProfile(fresh);
  }
  // 還沒登入（或正在確認上次的登入）就顯示登入畫面；畫面本身不動，登入後回到原本的地方。
  root.innerHTML =
    app.screen === 'login' || !app.session
      ? loginScreen()
      : app.screen === 'setup'
      ? setupScreen()
      : app.screen === 'deck'
        ? deckScreen(db, app.builder, editing!, owned())
        : app.screen === 'shop'
          ? shopScreen(db, app.profile, app.shop, app.toast, Boolean(app.backend?.topup))
          : app.screen === 'queue'
            ? queueScreen()
          : app.screen === 'adventure'
            ? adventureScreen()
          : app.screen === 'lobby'
            ? lobbyScreen()
            : playScreen();
  music.setScene(app.screen === 'play' && app.session ? 'battle' : 'menu');
  const googleSlot = document.getElementById('google-button');
  // 教學：把這一步要點的地方標亮。
  if (app.mode === 'tutorial' && app.tutorial && app.state && app.screen === 'play') {
    for (const selector of STEPS[app.tutorial.step]?.highlight?.(app.state) ?? []) {
      root.querySelectorAll(selector).forEach((el) => el.classList.add('tut-glow'));
    }
  }
  if (googleSlot) mountGoogleButton(googleSlot, onGoogleCredential).catch((error: unknown) => {
    googleSlot.textContent = error instanceof Error ? error.message : '載入不了 Google 登入';
  });
  const handEl = root.querySelector('.hand');
  if (handEl) handEl.scrollLeft = handScroll;
  const log = root.querySelector('.log');
  if (log) log.scrollTop = log.scrollHeight;
  for (const f of floats) {
    const target = root.querySelector(`[data-key="${f.key}"]`);
    if (!target) continue;
    const span = document.createElement('span');
    span.className = `float ${f.tone}`;
    span.textContent = f.text;
    target.appendChild(span);
    span.addEventListener('animationend', () => span.remove());
  }
  floats = [];
}

function inspect(key: string): void {
  const player = Number(key[1]) as PlayerId;
  const view = app.view!;
  if (key[0] === 'z') {
    const index = Number(key[2]);
    const side = player === YOU ? view.you : view.opponent;
    app.selection = side.zones[index] ? { kind: 'creature', player, zone: index } : null;
  } else if (key[0] === 'h') {
    app.selection = { kind: 'hero', player };
  } else {
    app.selection = { kind: 'field', player };
  }
  render();
}

function chooseAbility(acts: Action[], selection: Selection): void {
  // 只有一個目標（或不用目標）就直接發動，紀錄會寫出打到哪裡；否則進入選目標。
  if (acts.length === 1) perform(acts[0]!);
  else if (acts.length > 1) {
    app.selection = selection;
    render();
  }
}

/** 等一下再送上伺服器的牌組（組牌時每點一下都會改，停下來才送）。 */
const deckTimers = new Map<string, number>();

const deckSaveFailed = () => {
  app.toast = '牌組存不上伺服器，先存在這台裝置上，下次改牌組時會再試一次';
  render();
};

/** 存一副牌組：瀏覽器裡留一份，伺服器帳號另外存上伺服器（停手 0.8 秒才送）。 */
function persistDeck(id: string): void {
  saveBook(app.book, app.session!.account.id);
  const backend = app.backend;
  const deck = app.book.decks.find((each) => each.id === id);
  if (!backend || !deck) return;
  window.clearTimeout(deckTimers.get(id));
  deckTimers.set(
    id,
    window.setTimeout(() => {
      deckTimers.delete(id);
      const latest = app.book.decks.find((each) => each.id === id);
      if (latest) backend.saveDeck(latest).catch(deckSaveFailed);
    }, 800),
  );
}

/** 加一副新牌組並設成那個英雄開局用的；超過上限回傳 null。 */
function addDeck(heroId: string, name: string, cards: string[]): SavedDeck | null {
  const deck: SavedDeck = { id: newDeckId(), name: name.slice(0, DECK_NAME_LIMIT), heroId, cards };
  const book = putDeck(app.book, deck);
  if (!book) {
    app.toast = `牌組最多存 ${DECK_LIMIT} 副，先刪掉用不到的`;
    return null;
  }
  app.book = selectDeckIn(book, heroId, deck.id);
  persistDeck(deck.id);
  app.backend?.selectDeck(heroId, deck.id).catch(deckSaveFailed);
  return deck;
}

/** 選一個英雄開局要用的牌組（null 是用收藏自動組）。 */
function pickDeck(heroId: string, id: string | null): void {
  app.book = selectDeckIn(app.book, heroId, id);
  saveBook(app.book, app.session!.account.id);
  app.backend?.selectDeck(heroId, id).catch(deckSaveFailed);
}

/** 刪掉一副牌組。 */
function dropDeck(id: string): void {
  app.book = removeDeck(app.book, id);
  saveBook(app.book, app.session!.account.id);
  app.backend?.deleteDeck(id).catch(deckSaveFailed);
}

/** 新牌組的名字：「○○的牌組 2」這樣往下編。 */
function nextDeckName(heroId: string, base = `${hero(heroId).name}的牌組`): string {
  const names = new Set(app.book.decks.map((deck) => deck.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** 打開組牌畫面，編輯某一副牌組。 */
function openBuilder(deck: SavedDeck): void {
  // 換英雄時顏色篩選回到全部（每個英雄能用的顏色不一樣）；種類、稀有度與費用照舊。
  const same = app.builder.heroId === deck.heroId;
  app.builder = { ...app.builder, heroId: deck.heroId, deckId: deck.id, showCode: false, confirmDelete: false, color: same ? app.builder.color : 'all', focus: null };
  app.screen = 'deck';
  app.toast = null;
  render();
  window.scrollTo(0, 0);
}

/** 貼上牌組代碼：看得懂就加成一副新牌組；缺卡照樣加，但補齊之前不能開局。 */
function importDeck(): void {
  const decoded = decodeDeckCode(db, app.importText);
  if (!decoded) {
    app.toast = '看不懂這個牌組代碼，確認一下有沒有複製完整';
    render();
    return;
  }
  const deck = addDeck(decoded.heroId, nextDeckName(decoded.heroId, `${hero(decoded.heroId).name}（貼上的）`), decoded.cards);
  if (!deck) return render();
  Object.assign(app, { importing: false, importText: '' });
  if (ownsHero(app.profile, db, decoded.heroId)) app.heroId = decoded.heroId;
  const status = deckStatus(db, deck, owned());
  app.toast = !ownsHero(app.profile, db, decoded.heroId)
    ? `加了「${deck.name}」。你還沒有 ${hero(decoded.heroId).name}，拿到之後才能用`
    : status.ok
      ? `加了「${deck.name}」，可以直接用`
      : `加了「${deck.name}」，但${status.text}，補齊之前不能開局`;
  render();
}

/** 登入時的牌組清單：測試帳號讀瀏覽器；伺服器帳號用伺服器上的，伺服器上還沒有的話把這台裝置上的搬上去。 */
function bookFor(session: Session, backend: Backend, me: ServerMe | undefined): DeckBook {
  const local = loadBook(db, session.account.id);
  if (session.kind === 'test' || !me) return local;
  const remote = cleanBook(db, me.deckBook ?? {});
  if (remote.decks.length > 0) return remote;
  for (const deck of local.decks) backend.saveDeck(deck).catch(() => undefined);
  for (const [heroId, id] of Object.entries(local.selected)) backend.selectDeck(heroId, id).catch(() => undefined);
  return local;
}

/** 組牌畫面的點擊。處理了就回傳 true。 */
function builderClick(el: HTMLElement, command: string | undefined): boolean {
  const { add, remove, focus, filter, color, cost, rarity, deckSet, back } = el.dataset;
  const heroId = app.builder.heroId;
  const saved = app.book.decks.find((each) => each.id === app.builder.deckId);
  if (!saved) return false;
  const deck = saved.cards;
  const edit = (next: string[]) => {
    app.book = { ...app.book, decks: app.book.decks.map((each) => (each.id === saved.id ? { ...each, cards: next } : each)) };
    persistDeck(saved.id);
  };
  if (add) {
    if (addProblem(db, deck, add, owned()) === null) edit([...deck, add]);
    app.builder.focus = add;
  } else if (remove) {
    edit(removeOne(deck, remove));
    app.builder.focus = remove;
  } else if (focus) {
    app.builder.focus = app.builder.focus === focus ? null : focus;
  } else if (filter) {
    app.builder.filter = filter as KindFilter;
  } else if (color) {
    app.builder.color = color as ColorPick;
  } else if (cost) {
    app.builder.cost = cost === 'all' ? 'all' : Number(cost);
  } else if (rarity) {
    app.builder.rarity = rarity as Builder['rarity'];
  } else if (deckSet) {
    // 系列可以多選：點一下加入或拿掉；「全部系列」清掉；全選等於全部。
    const sets = app.builder.sets;
    const next = deckSet === 'all' ? [] : sets.includes(deckSet) ? sets.filter((id) => id !== deckSet) : [...sets, deckSet];
    const all = CARD_SETS.filter((set) => deckPool(db, heroId).some((card) => setOf(card) === set.id)).length;
    app.builder.sets = next.length >= all ? [] : next;
  } else if (back) {
    app.book = { ...app.book, decks: app.book.decks.map((each) => (each.id === saved.id ? { ...each, back } : each)) };
    persistDeck(saved.id);
  } else if (command === 'focus-close') {
    app.builder.focus = null;
  } else if (command === 'deck-fill') {
    edit(fillRandom(db, heroId, deck, owned()));
  } else if (command === 'deck-auto') {
    edit(autoDeck(db, heroId, (Math.random() * 2 ** 32) >>> 0, owned()));
  } else if (command === 'deck-clear') {
    edit([]);
  } else if (command === 'deck-code') {
    // 複製牌組代碼；瀏覽器不讓複製（例如在別的網頁裡面）的話，下面顯示出來讓玩家自己複製。
    app.builder.showCode = true;
    const code = encodeDeckCode(saved.heroId, saved.cards);
    navigator.clipboard?.writeText(code).then(
      () => {
        app.toast = '牌組代碼已經複製了，傳給朋友就行';
        render();
      },
      () => undefined,
    );
  } else if (command === 'deck-copy') {
    const copy = addDeck(heroId, nextDeckName(heroId, `${saved.name}（複製）`), [...saved.cards]);
    if (copy) {
      openBuilder(copy);
      app.toast = `另存成「${copy.name}」`;
    }
  } else if (command === 'deck-delete') {
    app.builder.confirmDelete = true;
  } else if (command === 'deck-delete-cancel') {
    app.builder.confirmDelete = false;
  } else if (command === 'deck-delete-confirm') {
    dropDeck(saved.id);
    app.screen = 'setup';
    app.toast = `刪掉了「${saved.name}」`;
    window.scrollTo(0, 0);
  } else if (command === 'deck-done') {
    app.screen = 'setup';
    window.scrollTo(0, 0);
  } else {
    return false;
  }
  render();
  return true;
}

root.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-do],[data-key],[data-hand],[data-skill],[data-hero],[data-mull],[data-pick],[data-add],[data-remove],[data-focus],[data-filter],[data-rarity],[data-color],[data-cost],[data-kind],[data-pack],[data-stage],[data-series],[data-deck-set],[data-back],[data-deck-pick],[data-deck-edit],[data-missing],[data-craft],[data-topup],[data-difficulty]',
  );
  if (!el) {
    // 點在說明欄裡（正在看卡片資訊、點關鍵字看意思）不取消選取；點其他地方才回到對戰紀錄。
    if ((event.target as HTMLElement).closest('.detail, .dialog')) return;
    if (app.selection) {
      app.selection = null;
      render();
    }
    return;
  }
  const { do: command, key, hand: handUid, skill, hero: heroId, mull, pick, difficulty, deckPick, deckEdit, stage, stageLevel } = el.dataset;
  if (app.screen === 'deck' && builderClick(el, command)) return;
  if (app.screen === 'shop' && app.backend && shopClick(db, app, app.backend, el, command, render)) {
    render();
    return;
  }

  if (difficulty) {
    app.difficulty = difficulty === 'normal' ? 'normal' : 'hard';
    try {
      localStorage.setItem(DIFFICULTY_KEY, app.difficulty);
    } catch {
      // 存不了就只在這次開著的頁面有效。
    }
    render();
  } else if (heroId) {
    if (ownsHero(app.profile, db, heroId)) app.heroId = heroId;
    render();
  } else if (mull) {
    const uid = Number(mull);
    app.redraw = app.redraw.includes(uid) ? app.redraw.filter((u) => u !== uid) : [...app.redraw, uid];
    render();
  } else if (pick) {
    const uid = Number(pick);
    const limit = app.view?.choice?.pick ?? 0;
    if (app.picks.includes(uid)) app.picks = app.picks.filter((u) => u !== uid);
    else if (app.picks.length < limit) app.picks = [...app.picks, uid];
    render();
  } else if (handUid) {
    const uid = Number(handUid);
    app.selection = app.selection?.kind === 'hand' && app.selection.uid === uid ? null : { kind: 'hand', uid };
    render();
  } else if (skill) {
    const [z, s] = skill.split(':').map(Number) as [number, number];
    chooseAbility(actsForSkill(z, s), { kind: 'skill', zone: z, skill: s });
  } else if (key) {
    const act = choices().get(key);
    const sel = app.selection;
    if (act && (act.type === 'summon' || act.type === 'evolve') && sel?.kind === 'hand') {
      const options = actsForCard(sel.uid).filter((a) => (a.type === 'summon' || a.type === 'evolve') && a.zone === act.zone);
      if (options.length > 1) {
        app.selection = { kind: 'entry', uid: sel.uid, zone: act.zone };
        render();
      } else perform(act);
    } else if (act) perform(act);
    else if (app.view) inspect(key);
  } else if (command === 'deck-new') {
    const deck = addDeck(app.heroId, nextDeckName(app.heroId), []);
    if (deck) openBuilder(deck);
    else render();
  } else if (deckEdit) {
    const deck = app.book.decks.find((each) => each.id === deckEdit);
    if (deck) openBuilder(deck);
  } else if (deckPick) {
    pickDeck(app.heroId, deckPick === 'auto' ? null : deckPick);
    render();
  } else if (command === 'deck-import') {
    Object.assign(app, { importing: true, importText: '', toast: null });
    render();
  } else if (command === 'import-cancel') {
    app.importing = false;
    render();
  } else if (command === 'import-confirm') {
    importDeck();
  } else if (command === 'login-password') {
    onPasswordLogin(false);
  } else if (command === 'register-password') {
    onPasswordLogin(true);
  } else if (command === 'queue') {
    startQueue();
  } else if (command === 'unqueue') {
    online.send({ t: 'unqueue' });
    Object.assign(app, { screen: 'setup', queue: null });
    render();
  } else if (command === 'requeue') {
    leaveRoom();
    startQueue();
  } else if (command === 'login-test') {
    signIn({ kind: 'test', account: { id: 'test', name: '測試帳號', email: null, picture: null } }, testProfile(db));
  } else if (command === 'logout') {
    void signOut();
  } else if (command === 'reset-test' && app.session?.kind === 'test') {
    app.profile = resetTestProfile(db);
    app.toast = '測試帳號已重設：10000 金幣、全部的卡';
    render();
  } else if (command === 'shop') {
    Object.assign(app, { screen: 'shop', toast: null });
    app.shop = { ...app.shop, opened: null, dealing: false, notice: null };
    render();
    window.scrollTo(0, 0);
  } else if (command === 'shop-done') {
    Object.assign(app, { screen: 'setup', toast: null });
    render();
    window.scrollTo(0, 0);
  } else if (command === 'create-room') {
    createRoom();
  } else if (command === 'join-room') {
    joinRoom();
  } else if (command === 'leave-room') {
    leaveRoom();
  } else if (command === 'rematch') {
    online.send({ t: 'rematch' });
  } else if (command === 'copy-link') {
    const text = document.getElementById('invite-link')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(
      () => {
        app.toast = '已複製邀請連結';
        render();
      },
      () => {
        const range = document.createRange();
        const node = document.getElementById('invite-link');
        if (node) range.selectNodeContents(node);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      },
    );
  } else if (command === 'start') {
    startGame();
  } else if (command === 'again') {
    startGame(app.adventure);
  } else if (command === 'adventure') {
    Object.assign(app, { screen: 'adventure', state: null, view: null, selection: null, toast: null, adventure: null, story: null });
    render();
    window.scrollTo(0, 0);
  } else if (command === 'stage-cancel') {
    app.story = null;
    render();
  } else if (command === 'stage-fight' && app.story) {
    startGame(app.story);
  } else if (stage && stageLevel) {
    app.story = { stage, difficulty: stageLevel as AdventureDifficulty };
    render();
  } else if (command === 'setup') {
    Object.assign(app, { screen: 'setup', state: null, view: null, selection: null, toast: null });
    render();
  } else if (command === 'mulligan') {
    const cards = app.redraw;
    app.redraw = [];
    perform({ type: 'mulligan', player: YOU, cards });
  } else if (command === 'end') {
    perform({ type: 'endTurn', player: YOU });
  } else if (command === 'choose') {
    const cards = app.picks;
    app.picks = [];
    perform({ type: 'choose', player: YOU, cards });
  } else if (command === 'density') {
    app.compactPref = !compact();
    try {
      localStorage.setItem(DENSITY_KEY, app.compactPref ? 'compact' : 'large');
    } catch {
      // 存不了就只在這次開著的頁面有效。
    }
    applyDensity();
    render();
  } else if (command === 'music') {
    music.toggle();
    render();
  } else if (command === 'sfx') {
    music.toggleSfx();
    render();
  } else if (command === 'fullscreen') {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    request.catch(() => {
      app.toast = '這個畫面不能切換全螢幕，可以改用瀏覽器的全螢幕（F11）。';
      render();
    });
  } else if (command === 'tut-start') {
    startTutorialGame();
  } else if (command === 'tut-next' && app.tutorial) {
    app.tutorial.step += 1;
    app.legalActions = app.state ? localLegal(app.state) : [];
    render();
  } else if (command === 'tut-finish') {
    leaveTutorial(true);
  } else if (command === 'tut-leave') {
    leaveTutorial(false);
  } else if (command === 'concede') {
    if (app.mode === 'tutorial') leaveTutorial(false);
    else perform({ type: 'concede', player: YOU });
  } else if (command === 'power') {
    chooseAbility(actsForPower(), { kind: 'heroPower' });
  } else if (command === 'their-power') {
    app.selection = { kind: 'hero', player: THEM() };
    render();
  } else if (command === 'direct' && app.selection?.kind === 'hand') {
    const act = actsForCard(app.selection.uid).find(
      (a) => a.type === 'playField' || a.type === 'evolveHero' || (a.type === 'castSpell' && !a.target),
    );
    if (act) perform(act);
  } else if ((command === 'dismiss' || command === 'dismiss-cancel') && app.selection?.kind === 'creature') {
    app.selection = { ...app.selection, confirmDismiss: command === 'dismiss' };
    render();
  } else if (command === 'dismiss-confirm' && app.selection?.kind === 'creature') {
    perform({ type: 'dismiss', player: YOU, zone: app.selection.zone });
  } else if (command === 'cancel') {
    app.selection = null;
    render();
  }
});

root.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'player-name') {
    app.playerName = input.value;
    try {
      localStorage.setItem('card-game.name', input.value);
    } catch {
      // 存不了就下次再輸入一次。
    }
  } else if (input.id === 'guest-name') {
    app.guestName = input.value;
  } else if (input.id === 'guest-password') {
    app.guestPassword = input.value;
  } else if (input.id === 'room-code') {
    app.roomCode = input.value.toUpperCase();
  } else if (input.id === 'deck-code-in') {
    app.importText = input.value;
  } else if (input.id === 'deck-name') {
    // 改牌組名字：不重畫（游標才不會跳掉），停手才存。
    const id = app.builder.deckId;
    const name = input.value.trim().slice(0, DECK_NAME_LIMIT) || nextDeckName(app.builder.heroId);
    app.book = { ...app.book, decks: app.book.decks.map((deck) => (deck.id === id ? { ...deck, name } : deck)) };
    persistDeck(id);
  }
});

// 從綠界付款頁按「上一頁」回來：瀏覽器會把離開前的頁面原封不動還原（bfcache），
// 那時的「前往付款頁」「開卡包中」狀態要重設；伺服器帳號再拿一次最新的金幣（說不定已經付款入帳）。
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  app.shop.busy = false;
  app.shop.paying = false;
  const session = app.session;
  if (session && session.kind !== 'test') {
    fetchMe(session)
      .then((me) => {
        if (me) app.profile = me.profile;
        render();
      })
      .catch(() => render());
  } else render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && app.selection) {
    app.selection = null;
    render();
  }
});

// ─── 啟動（重新發布時保留進行中的對局）──────────────────────────────────────

interface Hot {
  snapshot?: (fn: () => Saved) => void;
  ready?: (fn: (data: Partial<Saved>) => void) => void;
  data?: Partial<Saved>;
}
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
// 只保留跟電腦打的對局；連線對戰的狀態在伺服器上，重新連線就回得去。
hot?.snapshot?.(() => ({
  format: SAVE_FORMAT,
  screen: app.mode === 'bot' ? app.screen : 'setup',
  heroId: app.heroId,
  state: app.mode === 'bot' ? app.state : null,
  log: app.mode === 'bot' ? app.log : [],
  redraw: app.redraw,
  gameDeck: app.gameDeck,
  botGame: app.mode === 'bot' ? app.botGame : null,
  adventure: app.mode === 'bot' ? app.adventure : null,
  tally: app.tally,
  reward: app.reward,
}));

function start(data: Partial<Saved>): void {
  // 舊版引擎存下來的對局，新版的引擎接不下去，回到開局畫面重來；牌組與選的英雄照樣保留。
  if (data.state && data.format !== SAVE_FORMAT) {
    data = { ...data, screen: 'setup', state: null, log: [], redraw: [] };
  }
  data = { ...data, format: SAVE_FORMAT };
  // 牌組跟著帳號存，不從快照還原；沒登入就停在登入畫面。
  Object.assign(app, data);
  if (!db.heroes.has(app.heroId)) app.heroId = SAMPLE_HEROES[1]!.id;
  if (app.state && app.screen === 'play') {
    YOU = 0;
    app.view = engine.viewFor(app.state, YOU);
    app.legalActions = localLegal(app.state);
  } else if (app.screen === 'play' || app.screen === 'lobby') {
    app.screen = 'setup';
  }
  // 上次在連線房間裡就自動回去；伺服器會把房間與局面送回來。
  if (ONLINE_AVAILABLE && online.hasSession) {
    app.screen = 'lobby';
    online.connect();
  }
  restoreSession();
  if (!app.session && !app.loggingIn) app.screen = 'login';
  render();
  void advance();
}

// 排隊時每秒更新等待時間。
setInterval(() => {
  if (app.screen === 'queue') render();
}, 1000);

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});

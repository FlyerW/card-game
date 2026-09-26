import {
  COLOR_NAMES,
  copyLimit,
  deckPool,
  type CardDb,
  type Color,
  type DeckCardDef,
  type GameEvent,
  type PlayerId,
  type Rarity,
  type Rules,
} from '@card-game/engine';
import { buildDeck } from '@card-game/sim/deck';

// 經濟系統：金幣、每日任務、卡包、兌換卷。全部是純函式，輸入舊的玩家資料、輸出新的，
// 不碰網路也不碰儲存，所以能直接寫測試；目前由網頁存在瀏覽器裡，之後搬到伺服器的帳號上。

export const ECONOMY = {
  /** 贏一場拿多少金幣。 */
  winGold: 10,
  /** 每天從贏場拿到的金幣上限；任務獎勵另外算。 */
  dailyWinGoldCap: 100,
  /** 每日任務完成的獎勵。 */
  questReward: 50,
  /** 一包多少金幣。 */
  packPrice: 100,
  /** 一包幾張。 */
  packSize: 5,
  /** 每一張的稀有度機率，其餘是 N。一包至少一張 R 以上。 */
  odds: { UR: 0.01, SR: 0.05, R: 0.2 },
  /** 幾張兌換卷換一張同稀有度的卡。 */
  vouchersPerCard: 3,
  /** 新玩家的金幣，可以先開一包試試。 */
  startingGold: 100,
} as const;

export interface QuestProgress {
  id: string;
  progress: number;
  done: boolean;
}

export interface Profile {
  version: 1;
  gold: number;
  /** 每張卡擁有幾張。 */
  collection: Record<string, number>;
  /** 各稀有度的兌換卷。 */
  vouchers: Record<Rarity, number>;
  /** 每日資料屬於哪一天（YYYY-MM-DD）。 */
  day: string;
  /** 今天從贏場拿到的金幣。 */
  winGoldToday: number;
  quest: QuestProgress;
}

/** 一場對局結束時，任務要看的數字（都是自己這一方的）。 */
export interface GameSummary {
  won: boolean;
  /** 自己投降的。投降的對局不算任務進度，不然開局馬上投降就能刷「遊玩 3 場」。 */
  conceded: boolean;
  /** 牌組裡的卡有哪些顏色。 */
  deckColors: Color[];
  /** 召喚了幾隻生物（含衍生物）。 */
  summoned: number;
  /** 抽了幾張牌（不含起手）。 */
  drew: number;
  /** 施放了幾張法術。 */
  spells: number;
}

export interface QuestDef {
  id: string;
  text: string;
  goal: number;
  /** 這一場讓進度增加多少。 */
  progress: (game: GameSummary) => number;
}

const COLORS: Color[] = ['white', 'blue', 'black', 'red', 'green'];

/** 每天從這裡挑一個。 */
export const QUESTS: QuestDef[] = [
  { id: 'play-3', text: '遊玩 3 場', goal: 3, progress: () => 1 },
  { id: 'win-2', text: '贏 2 場', goal: 2, progress: (game) => (game.won ? 1 : 0) },
  ...COLORS.map((color) => ({
    id: `win-${color}`,
    text: `用有${COLOR_NAMES[color]}色卡的牌組贏 1 場`,
    goal: 1,
    progress: (game: GameSummary) => (game.won && game.deckColors.includes(color) ? 1 : 0),
  })),
  { id: 'summon-10', text: '召喚 10 隻生物', goal: 10, progress: (game) => game.summoned },
  { id: 'draw-15', text: '抽 15 張牌', goal: 15, progress: (game) => game.drew },
  { id: 'spells-6', text: '施放 6 張法術', goal: 6, progress: (game) => game.spells },
];

/** 同一天每個人拿到同一個任務：用日期字串算雜湊。 */
export function questFor(day: string): QuestDef {
  let hash = 2166136261;
  for (const char of day) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return QUESTS[hash % QUESTS.length]!;
}

export const questDef = (id: string): QuestDef | undefined => QUESTS.find((quest) => quest.id === id);

/** 起始牌組用的種子；改了卡池之後，新玩家拿到的起始卡也會跟著變。 */
const STARTER_SEED = 1;

/** 每個英雄一副起始牌組，組法跟自動組牌一樣。 */
export const starterDecks = (db: CardDb): string[][] =>
  [...db.heroes.keys()].map((heroId) => buildDeck(STARTER_SEED, heroId, deckPool(db, heroId)));

/** 新玩家：收藏是每個英雄一副起始牌組用到的卡（同一張取最多的那副），保證每個英雄都組得出牌。 */
export function newProfile(day: string, starterDecks: readonly (readonly string[])[]): Profile {
  const collection: Record<string, number> = {};
  for (const deck of starterDecks) {
    const counts = new Map<string, number>();
    for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) collection[id] = Math.max(collection[id] ?? 0, n);
  }
  return {
    version: 1,
    gold: ECONOMY.startingGold,
    collection,
    vouchers: { N: 0, R: 0, SR: 0, UR: 0 },
    day,
    winGoldToday: 0,
    quest: { id: questFor(day).id, progress: 0, done: false },
  };
}

/** 換日：贏場金幣重新算，換成今天的任務。同一天呼叫不會改變任何東西。 */
export function refreshDay(profile: Profile, day: string): Profile {
  if (profile.day === day) return profile;
  return { ...profile, day, winGoldToday: 0, quest: { id: questFor(day).id, progress: 0, done: false } };
}

export interface GameReward {
  profile: Profile;
  /** 這場贏到的金幣（已經扣掉每日上限）。 */
  winGold: number;
  /** 這場完成了每日任務的話，獎勵多少。 */
  questGold: number;
}

/** 記下一場對局：贏了加金幣（每天有上限），推進今天的任務，完成就發獎勵。 */
export function recordGame(profile: Profile, game: GameSummary, day: string): GameReward {
  const next = structuredClone(refreshDay(profile, day));
  if (game.conceded) return { profile: next, winGold: 0, questGold: 0 };
  const winGold = game.won ? Math.max(0, Math.min(ECONOMY.winGold, ECONOMY.dailyWinGoldCap - next.winGoldToday)) : 0;
  next.gold += winGold;
  next.winGoldToday += winGold;

  let questGold = 0;
  const def = questDef(next.quest.id);
  if (def && !next.quest.done) {
    next.quest.progress = Math.min(def.goal, next.quest.progress + def.progress(game));
    if (next.quest.progress >= def.goal) {
      next.quest.done = true;
      questGold = ECONOMY.questReward;
      next.gold += questGold;
    }
  }
  return { profile: next, winGold, questGold };
}

/** 對局進行中邊打邊累計的數字；對局結束時加上勝負與牌組，變成 GameSummary。 */
export interface GameTally {
  /** 第一個回合開始了沒；之前的抽牌是起手與換牌，不算。 */
  started: boolean;
  summoned: number;
  drew: number;
  spells: number;
}

export const emptyTally = (): GameTally => ({ started: false, summoned: 0, drew: 0, spells: 0 });

/** 把一批事件加進累計。連線對戰時事件是一批一批從伺服器來的，所以要能接著算。 */
export function tallyEvents(tally: GameTally, events: readonly GameEvent[], player: PlayerId): GameTally {
  const next = { ...tally };
  for (const event of events) {
    if (event.type === 'turnStarted') next.started = true;
    if (!('player' in event) || event.player !== player) continue;
    if (event.type === 'summoned') next.summoned++;
    if (event.type === 'drew' && next.started) next.drew += event.cards.length;
    if (event.type === 'abilityUsed' && event.source === 'spell') next.spells++;
  }
  return next;
}

export function gameSummary(db: CardDb, tally: GameTally, deck: readonly string[], won: boolean, conceded = false): GameSummary {
  const colors = new Set(deck.flatMap((id) => db.cards.get(id)?.colors ?? []));
  const { summoned, drew, spells } = tally;
  return { won, conceded, deckColors: COLORS.filter((color) => colors.has(color)), summoned, drew, spells };
}

/** 從一整局的事件算出任務要看的數字。 */
export const summarizeGame = (db: CardDb, events: readonly GameEvent[], player: PlayerId, deck: readonly string[], winner: PlayerId | null): GameSummary =>
  gameSummary(db, tallyEvents(emptyTally(), events, player), deck, winner === player);

/** 每張卡最多能放幾張：規則上限與擁有張數取小的。 */
export const ownedLimit = (profile: Profile, rules: Rules) => (card: DeckCardDef): number =>
  Math.min(copyLimit(rules, card), profile.collection[card.id] ?? 0);

/** 只用收藏裡的卡自動組一副。 */
export const ownedDeck = (profile: Profile, db: CardDb, rules: Rules, heroId: string, seed: number): string[] =>
  buildDeck(seed, heroId, deckPool(db, heroId), 2, ownedLimit(profile, rules));

/** 可以從卡包開到的卡：衍生物以外的卡（包括英雄進化卡）。 */
export const packableCards = (db: CardDb): DeckCardDef[] =>
  [...db.cards.values()].filter((card) => !(card.kind === 'creature' && card.token));

export interface PackCard {
  cardId: string;
  rarity: Rarity;
  /** 已經有滿了，換成一張同稀有度的兌換卷。 */
  duplicate: boolean;
}

export type EconomyResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

function rollRarity(random: () => number): Rarity {
  const roll = random();
  const { UR, SR, R } = ECONOMY.odds;
  if (roll < UR) return 'UR';
  if (roll < UR + SR) return 'SR';
  if (roll < UR + SR + R) return 'R';
  return 'N';
}

/** 保底那一張：照 R、SR、UR 原本的比例，只在 R 以上之中抽。 */
function rollGuaranteed(random: () => number): Rarity {
  const { UR, SR, R } = ECONOMY.odds;
  const roll = random() * (UR + SR + R);
  if (roll < UR) return 'UR';
  if (roll < UR + SR) return 'SR';
  return 'R';
}

/** 買一包並打開：扣 100 金幣，抽 5 張；已經有滿的換成兌換卷。 */
export function openPack(profile: Profile, db: CardDb, rules: Rules, random: () => number): EconomyResult<{ profile: Profile; cards: PackCard[] }> {
  if (profile.gold < ECONOMY.packPrice) return { ok: false, reason: `金幣不夠：一包 ${ECONOMY.packPrice}，目前 ${profile.gold}` };
  const pool = packableCards(db);
  const rarities = Array.from({ length: ECONOMY.packSize }, () => rollRarity(random));
  if (!rarities.some((rarity) => rarity !== 'N')) rarities[rarities.length - 1] = rollGuaranteed(random);

  const next = structuredClone(profile);
  next.gold -= ECONOMY.packPrice;
  const cards = rarities.map((rarity): PackCard => {
    const choices = pool.filter((card) => card.rarity === rarity);
    const card = choices[Math.floor(random() * choices.length)]!;
    const owned = next.collection[card.id] ?? 0;
    if (owned >= copyLimit(rules, card)) {
      next.vouchers[rarity] += 1;
      return { cardId: card.id, rarity, duplicate: true };
    }
    next.collection[card.id] = owned + 1;
    return { cardId: card.id, rarity, duplicate: false };
  });
  return { ok: true, profile: next, cards };
}

/** 用 3 張同稀有度的兌換卷換一張卡；已經有滿的不能換。 */
export function exchange(profile: Profile, db: CardDb, rules: Rules, cardId: string): EconomyResult<{ profile: Profile }> {
  const card = packableCards(db).find((each) => each.id === cardId);
  if (!card) return { ok: false, reason: '這張卡不能兌換' };
  const owned = profile.collection[cardId] ?? 0;
  if (owned >= copyLimit(rules, card)) return { ok: false, reason: `${card.name} 已經有 ${owned} 張了` };
  if (profile.vouchers[card.rarity] < ECONOMY.vouchersPerCard) {
    return { ok: false, reason: `${card.rarity} 兌換卷不夠：要 ${ECONOMY.vouchersPerCard} 張，目前 ${profile.vouchers[card.rarity]} 張` };
  }
  const next = structuredClone(profile);
  next.vouchers[card.rarity] -= ECONOMY.vouchersPerCard;
  next.collection[cardId] = owned + 1;
  return { ok: true, profile: next };
}

/** 牌組裡每張卡的張數不能超過擁有的張數。 */
export function ownershipProblems(profile: Profile, db: CardDb, deck: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
  const problems: string[] = [];
  for (const [id, n] of counts) {
    const owned = profile.collection[id] ?? 0;
    if (n > owned) problems.push(`${db.cards.get(id)?.name ?? id} 只有 ${owned} 張，牌組放了 ${n} 張`);
  }
  return problems;
}

/** 讀回存檔：格式不對就回傳 null，讓呼叫的人建新的。 */
export function parseProfile(value: unknown): Profile | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Partial<Profile>;
  const numbers = (record: unknown) =>
    typeof record === 'object' && record !== null && Object.values(record).every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (p.version !== 1 || typeof p.gold !== 'number' || typeof p.day !== 'string' || typeof p.winGoldToday !== 'number') return null;
  if (!numbers(p.collection) || !numbers(p.vouchers) || typeof p.quest?.id !== 'string') return null;
  return p as Profile;
}

/** 可重現的亂數：同一個種子開出同一包，測試用；網頁用隨機種子。 */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

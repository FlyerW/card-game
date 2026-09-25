// ─── 卡牌資料 ────────────────────────────────────────────────────────────────
//
// 卡牌全部是資料，不寫死在程式裡。技能由「目標類型 + 效果積木」組成，
// 新增卡片或調整平衡只要改資料。對應設計文件「線上遊戲架構」一節。

/** 五個顏色，參考魔法風雲會。無色卡的 colors 是空陣列。 */
export type Color = 'white' | 'blue' | 'black' | 'red' | 'green';

export type PlayerId = 0 | 1;

/** 速攻：召喚當回合就能發動技能。 */
export type Keyword = 'haste';

/**
 * 稀有度，由低到高。N 是單純的數值卡，可以只有一個技能；R 開始有特殊機制。
 * 每次進化稀有度升一級，最多兩次：N → R → SR，較強的進化鏈是 R → SR → UR。
 */
export type Rarity = 'N' | 'R' | 'SR' | 'UR';
export const RARITIES: readonly Rarity[] = ['N', 'R', 'SR', 'UR'];

/** 對生物的持續加成，來自道具、場地卡或英雄被動。 */
export interface CreatureModifier {
  /** 技能傷害加成。 */
  attack?: number;
  /** HP 上限加成。 */
  hp?: number;
  /** 受到的傷害減少。 */
  damageReduction?: number;
}

/** 技能、天生技、法術選目標的方式。 */
export type TargetSpec =
  /** 不選目標：抽牌、範圍傷害、作用在自己身上的效果。 */
  | { kind: 'none' }
  /** 對手的單位。any = 任意目標、creature = 只打生物、hero = 只打英雄。 */
  | { kind: 'enemy'; allow: 'any' | 'creature' | 'hero' }
  /** 位置技能，只能用在生物技能上。目標格全空時打到對手英雄。 */
  | { kind: 'lane'; lane: 'opposite' | 'diagonal' }
  /** 我方的單位，用於回復與增益。 */
  | { kind: 'ally'; allow: 'any' | 'creature' }
  /** 對手身上掛著道具的生物。 */
  | { kind: 'enemyItem' }
  /** 對手身上掛著道具的生物，或對手場地區的場地卡。 */
  | { kind: 'enemyItemOrField' };

export type Effect =
  /** 對目標造成傷害。生物技能的傷害會加上攻擊指示物與道具加成。 */
  | { type: 'damage'; amount: number }
  /** 對對手每隻生物各造成傷害。 */
  | { type: 'damageEnemyCreatures'; amount: number }
  | { type: 'draw'; count: number }
  | { type: 'opponentDiscardRandom'; count: number }
  /** 回復目標的 HP，不超過上限。 */
  | { type: 'heal'; amount: number }
  /** 目標剩餘 HP 減半、無條件捨去。算失去 HP 不算傷害：減傷擋不住，也不受挑釁限制。 */
  | { type: 'halveHp' }
  /** 發動者挑釁，直到對手下回合結束。 */
  | { type: 'taunt' }
  /**
   * 放增益指示物。attack 讓之後的技能傷害增加，hp 讓 HP 上限增加。
   * 「增益 N」就是 attack 與 hp 各 N。
   */
  | { type: 'buff'; attack: number; hp: number; on: 'self' | 'target' }
  /** 加速型：能量上限 +N，不超過最高上限，當回合不補能量。 */
  | { type: 'gainMaxEnergy'; amount: number }
  /** 突破型：最高上限永久 +N。目前先維持上限 12，範例卡不使用。 */
  | { type: 'raiseCeiling'; amount: number }
  /** 破壞目標生物身上的道具，或目標場地卡。 */
  | { type: 'destroy' }
  /** 從牌庫把發動者的進化卡加入手牌，然後洗牌。只能用在生物技能上。 */
  | { type: 'searchEvolution' }
  /** 用牌庫裡發動者的進化卡直接進化，不另付進化費用；一回合仍只能進化一次。只能用在生物技能上。 */
  | { type: 'evolveFromDeck' }
  // 異常狀態：只作用在生物身上，打到英雄沒有效果；進化會解除全部。
  // all 為 true 時不選目標，對手每隻生物都中。
  /** 中毒 N：牠的擁有者回合開始時失去 N HP（不算傷害）。再中一次數字相加。 */
  | { type: 'poison'; amount: number; all?: boolean }
  /** 灼燒 N：牠的擁有者回合結束時受到 N 傷害（算傷害，減傷擋得住）。再中一次取大的。 */
  | { type: 'burn'; amount: number; all?: boolean }
  /** 麻痺：不能發動技能，直到擁有者的下一個回合結束。 */
  | { type: 'paralyze'; all?: boolean }
  /** 沉睡：不能發動技能；受到傷害就醒來，最多持續擁有者的 2 個回合。 */
  | { type: 'sleep'; all?: boolean };

/** 異常狀態的種類。 */
export type StatusKind = 'poison' | 'burn' | 'paralysis' | 'sleep';

/** 生物技能、英雄天生技，以及法術的效果部分，都是 Ability。 */
export interface Ability {
  name: string;
  cost: number;
  target: TargetSpec;
  effects: Effect[];
  /** 【瞬發】生物技能：可以在回應時發動，包括對手的回合。仍然算在這隻生物「每回合一個技能」裡。 */
  instant?: boolean;
}

interface CardBase {
  id: string;
  name: string;
  colors: Color[];
  rarity: Rarity;
}

export interface CreatureDef extends CardBase {
  kind: 'creature';
  /** 0 = 基礎，1 = 一階，2 = 二階。 */
  stage: 0 | 1 | 2;
  /** 基礎生物是召喚費用，進化生物是進化費用。 */
  cost: number;
  /** 進化生物才有：從哪張卡進化而來。 */
  evolvesFrom?: string;
  hp: number;
  skills: Ability[];
  keywords?: Keyword[];
  /**
   * 進場效果：這張卡進場時（召喚，或進化成這張）發動。
   * 不另外花能量，價值算在費用裡，所以有進場效果的生物本體數值要低一點。
   */
  entry?: EntryEffect;
}

/** 進場效果跟技能一樣是「目標類型 + 效果」，只是沒有費用。 */
export type EntryEffect = Omit<Ability, 'cost'>;

export interface SpellDef extends CardBase {
  kind: 'spell';
  cost: number;
  target: TargetSpec;
  effects: Effect[];
  /** 瞬發法術：可以在回應時施放，包括對手的回合。一般法術只能在自己的回合、沒有等待回應時施放。 */
  instant?: boolean;
}

export interface ItemDef extends CardBase {
  kind: 'item';
  cost: number;
  /** 這隻生物的技能傷害加成。 */
  attack?: number;
  /** 這隻生物受到的傷害減少。 */
  damageReduction?: number;
  /** 這隻生物的 HP 上限加成。 */
  hp?: number;
}

/** 場地卡放在自己的場地區，效果只作用在自己身上。 */
export interface FieldDef extends CardBase {
  kind: 'field';
  cost: number;
  /** 強化自己的生物。 */
  creatures?: CreatureModifier;
  /** 提高自己的最高上限。突破型，目前範例卡不使用。 */
  ceilingBonus?: number;
}

export interface HeroPassive {
  name: string;
  /** 強化自己的生物。 */
  creatures?: CreatureModifier;
  /** 提高自己的最高上限。突破型，目前範例卡不使用。 */
  ceilingBonus?: number;
}

/**
 * 英雄進化卡：放在牌組裡，只有對應的英雄能用，每局只能進化一次。
 * 進化後 HP 上限增加（已受的傷害保留），天生技換成新的，被動則是額外多一個。
 */
export interface HeroEvolutionDef extends CardBase {
  kind: 'heroEvolution';
  cost: number;
  /** 由哪個英雄進化（英雄的 id）。 */
  evolvesFrom: string;
  /** HP 上限增加多少。 */
  hpBonus: number;
  /** 換成這個天生技；沒有就沿用原本的。 */
  power?: Ability;
  /** 額外多一個被動，跟原本的被動同時生效。 */
  passive?: HeroPassive;
  /** 進場效果：打出這張卡時發動，像爐石英雄卡的戰吼。不另外花能量。 */
  entry?: EntryEffect;
}

export type DeckCardDef = CreatureDef | SpellDef | ItemDef | FieldDef | HeroEvolutionDef;

export interface HeroDef {
  kind: 'hero';
  id: string;
  name: string;
  colors: Color[];
  hp: number;
  power?: Ability;
  passive?: HeroPassive;
}

export interface CardDb {
  cards: ReadonlyMap<string, DeckCardDef>;
  heroes: ReadonlyMap<string, HeroDef>;
}

// ─── 規則參數 ────────────────────────────────────────────────────────────────

export interface Rules {
  deckSize: number;
  maxCopies: number;
  startingHand: number;
  /** 手牌上限。滿手時抽到的牌直接進棄牌區。 */
  handLimit: number;
  zones: number;
  /** 雙方第一個回合的能量上限：[先攻, 後攻]。 */
  startingMaxEnergy: [number, number];
  /** 之後每個回合，能量上限增加多少。 */
  energyGrowth: number;
  baseCeiling: number;
  /** 後攻玩家第一個回合額外給的一次性能量。舊制用；新制由 startingMaxEnergy 補償，設為 0。 */
  secondPlayerBonusEnergy: number;
}

// ─── 遊戲狀態 ────────────────────────────────────────────────────────────────
//
// 狀態是純資料，可以直接 structuredClone、序列化、存檔。
// 「這回合做過了沒」一律記成回合編號而不是布林值，換回合時就不用逐一重設。

/** 一張實體卡。uid 在整局中唯一，cardId 指向卡牌資料。 */
export interface CardRef {
  uid: number;
  cardId: string;
}

export interface Creature {
  /** 沿用基礎卡的 uid，進化後不變。 */
  uid: number;
  /** 擁有者。場地卡與英雄被動只強化自己的生物，所以要知道這隻是誰的。 */
  owner: PlayerId;
  /** 進化堆疊：[0] 是基礎形態，最後一張是目前形態。 */
  cards: CardRef[];
  /**
   * 受到的傷害，不是剩餘 HP。
   * 這樣進化、增益提高 HP 上限時，剩餘 HP 會跟著上升，已受的傷害保留。
   */
  damage: number;
  attackCounters: number;
  hpCounters: number;
  item: CardRef | null;
  summonedTurn: number;
  evolvedTurn: number | null;
  skillUsedTurn: number | null;
  /** 挑釁持續到這個回合結束（含）。 */
  tauntUntilTurn: number | null;
  /** 中毒的數字，0 表示沒有中毒。 */
  poison: number;
  /** 灼燒的數字，0 表示沒有灼燒。 */
  burn: number;
  /** 麻痺到這個回合結束（含）。 */
  paralyzedUntilTurn: number | null;
  /** 沉睡到這個回合結束（含）；受到傷害就提早清掉。 */
  asleepUntilTurn: number | null;
}

export interface PlayerState {
  heroId: string;
  heroDamage: number;
  heroPowerUsedTurn: number | null;
  /** 已經用掉的英雄進化卡；每局最多一張。 */
  heroEvolution: CardRef | null;
  zones: (Creature | null)[];
  hand: CardRef[];
  /** [0] 是牌庫頂。 */
  deck: CardRef[];
  discard: CardRef[];
  energy: number;
  maxEnergy: number;
  /** 突破型卡牌永久提高的最高上限。 */
  ceilingBonus: number;
  /** 自己的場地區，最多 1 張。 */
  field: CardRef | null;
  fieldPlayedTurn: number | null;
  mulliganDone: boolean;
}

/**
 * 連鎖上的一個效果：已經宣告、付過費用，還沒結算。
 * 回應會疊在上面，最後加入的先結算。
 */
export interface ChainLink {
  player: PlayerId;
  /** 生物技能、進場效果、英雄天生技、法術。 */
  source: 'creature' | 'entry' | 'hero' | 'spell';
  /** 生物來源的格子與 uid。結算前牠離場了，牠的技能與進場效果就不發動。 */
  zone: number | null;
  sourceUid: number | null;
  /** 顯示用：生物卡、英雄或法術卡的 id。 */
  cardId: string;
  ability: Ability;
  /** 宣告時選好的目標。 */
  target: Target | null;
  /** 目標生物宣告時的 uid；結算時那一格換了別隻，就當作目標消失。 */
  targetUid: number | null;
  /** 法術卡本身，結算完才進棄牌區。 */
  card: CardRef | null;
}

export type GameOverReason = 'heroDefeated' | 'deckOut' | 'concede';

export interface GameResult {
  winner: PlayerId | 'draw';
  reason: GameOverReason;
}

export interface GameState {
  rules: Rules;
  /** 亂數產生器的內部狀態。同樣的種子加同樣的動作，一定得到同樣的結果。 */
  rng: number;
  /** 0 表示還在重抽階段；先攻玩家的第一回合是 1。 */
  turn: number;
  firstPlayer: PlayerId;
  activePlayer: PlayerId;
  phase: 'mulligan' | 'main' | 'over';
  players: [PlayerState, PlayerState];
  result: GameResult | null;
  nextUid: number;
  /** 等待結算的連鎖，[0] 在最底下。 */
  chain: ChainLink[];
  /**
   * 正在等誰決定要不要回應；null 表示沒有在等，輪到的玩家照常行動。
   * 對手有存能量才會等，沒有存能量就直接結算。
   */
  window: PlayerId | null;
  /** 輪到的玩家已經宣告回合結束，正在等對手最後一次回應。 */
  endingTurn: boolean;
}

// ─── 玩家動作 ────────────────────────────────────────────────────────────────

/** 目標一律用絕對的玩家編號，伺服器與紀錄檔才不會有「你、我」的歧義。 */
export type Target =
  | { kind: 'hero'; player: PlayerId }
  | { kind: 'creature'; player: PlayerId; zone: number }
  | { kind: 'field'; player: PlayerId };

/** 卡牌以手牌中的 uid 指定。target 只有一個合法目標時可以省略。 */
export type Action =
  | { type: 'mulligan'; player: PlayerId; cards: number[] }
  | { type: 'summon'; player: PlayerId; card: number; zone: number; target?: Target }
  | { type: 'evolve'; player: PlayerId; card: number; zone: number; target?: Target }
  | { type: 'useSkill'; player: PlayerId; zone: number; skill: number; target?: Target }
  | { type: 'heroPower'; player: PlayerId; target?: Target }
  | { type: 'evolveHero'; player: PlayerId; card: number; target?: Target }
  | { type: 'castSpell'; player: PlayerId; card: number; target?: Target }
  | { type: 'attachItem'; player: PlayerId; card: number; zone: number }
  | { type: 'playField'; player: PlayerId; card: number }
  /** 讓自己的生物退場：連同身上的道具送進棄牌區，空出格子。不花能量。 */
  | { type: 'dismiss'; player: PlayerId; zone: number }
  | { type: 'endTurn'; player: PlayerId }
  /** 不回應：連鎖從最後加入的開始往回結算；在宣告回合結束時不回應，回合就結束。 */
  | { type: 'pass'; player: PlayerId }
  | { type: 'concede'; player: PlayerId };

// ─── 事件 ────────────────────────────────────────────────────────────────────
//
// 每個動作回傳的事件清單，給畫面播動畫、給文字介面印訊息用。
// 注意：事件含有抽到的卡等隱藏資訊，伺服器轉給對手前必須先過濾。

export type GameEvent =
  | { type: 'turnStarted'; player: PlayerId; turn: number }
  | { type: 'drew'; player: PlayerId; cards: CardRef[] }
  /** 手牌滿了，抽到的牌直接進棄牌區。 */
  | { type: 'burned'; player: PlayerId; cardId: string }
  | { type: 'searched'; player: PlayerId; cardId: string }
  | { type: 'mulliganed'; player: PlayerId; count: number }
  | { type: 'summoned'; player: PlayerId; zone: number; cardId: string }
  | { type: 'evolved'; player: PlayerId; zone: number; from: string; to: string }
  | { type: 'heroEvolved'; player: PlayerId; cardId: string }
  | { type: 'abilityUsed'; player: PlayerId; source: 'creature' | 'hero' | 'spell' | 'entry'; cardId: string; ability: string }
  | { type: 'itemAttached'; player: PlayerId; zone: number; cardId: string }
  | { type: 'fieldPlayed'; player: PlayerId; cardId: string }
  | { type: 'damaged'; target: Target; amount: number }
  | { type: 'hpLost'; target: Target; amount: number }
  | { type: 'healed'; target: Target; amount: number }
  | { type: 'buffed'; player: PlayerId; zone: number; attack: number; hp: number }
  | { type: 'taunting'; player: PlayerId; zone: number }
  | { type: 'discarded'; player: PlayerId; cardId: string }
  | { type: 'creatureDestroyed'; player: PlayerId; zone: number; cardId: string }
  /** 玩家主動讓自己的生物退場。 */
  | { type: 'dismissed'; player: PlayerId; zone: number; cardId: string }
  | { type: 'itemDestroyed'; player: PlayerId; zone: number; cardId: string }
  | { type: 'fieldDestroyed'; player: PlayerId; cardId: string }
  | { type: 'maxEnergyGained'; player: PlayerId; amount: number }
  | { type: 'ceilingRaised'; player: PlayerId; amount: number }
  | { type: 'statusApplied'; player: PlayerId; zone: number; status: StatusKind; amount?: number }
  /** 中毒或灼燒發作，接著會有 hpLost 或 damaged 事件。 */
  | { type: 'statusTriggered'; player: PlayerId; zone: number; status: 'poison' | 'burn'; amount: number }
  /** 進化解除了全部異常狀態。 */
  | { type: 'statusesCleared'; player: PlayerId; zone: number }
  | { type: 'wokeUp'; player: PlayerId; zone: number }
  /** 開始等這位玩家決定要不要回應。 */
  | { type: 'awaitingResponse'; player: PlayerId }
  /** 這位玩家用瞬發法術或【瞬發】技能回應，接著是 abilityUsed。 */
  | { type: 'responded'; player: PlayerId }
  | { type: 'passed'; player: PlayerId }
  /** 連鎖有兩個以上的效果時，每個效果結算前都有這個事件，看得出結算順序。 */
  | { type: 'resolving'; player: PlayerId; cardId: string; ability: string }
  /** 發動的生物在結算前離場了，效果不發動。 */
  | { type: 'fizzled'; player: PlayerId; cardId: string; ability: string }
  | { type: 'gameOver'; result: GameResult };

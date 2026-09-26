// ─── 卡牌資料 ────────────────────────────────────────────────────────────────
//
// 卡牌全部是資料，不寫死在程式裡。技能由「目標類型 + 效果積木」組成，
// 新增卡片或調整平衡只要改資料。對應設計文件「線上遊戲架構」一節。

/** 五個顏色，參考魔法風雲會。無色卡的 colors 是空陣列。 */
export type Color = 'white' | 'blue' | 'black' | 'red' | 'green';

export type PlayerId = 0 | 1;

/**
 * 速攻：召喚當回合就能攻擊或發動技能。
 * 吸血：這隻生物造成傷害時（攻擊、反擊、技能、進場效果），自己的英雄回復等量的 HP。
 */
export type Keyword = 'haste' | 'lifesteal';

/**
 * 稀有度，由低到高。N 是單純的數值卡，可以只有一個技能；R 開始有特殊機制。
 * 每次進化稀有度升一級，最多兩次：N → R → SR，較強的進化鏈是 R → SR → UR。
 */
export type Rarity = 'N' | 'R' | 'SR' | 'UR';
export const RARITIES: readonly Rarity[] = ['N', 'R', 'SR', 'UR'];

/** 對生物的持續加成，來自道具、場地卡或英雄被動。 */
export interface CreatureModifier {
  /** 攻擊力加成：只加在攻擊與反擊上，技能傷害不變。 */
  attack?: number;
  /** HP 上限加成。 */
  hp?: number;
  /** 受到的傷害減少。 */
  damageReduction?: number;
  /** 再生：擁有者的回合開始時回復這麼多 HP。 */
  regenerate?: number;
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
  /** 對目標造成傷害。技能傷害就是卡上的數字，不加攻擊力。 */
  | { type: 'damage'; amount: number }
  /** 對對手每隻生物各造成傷害。 */
  | { type: 'damageEnemyCreatures'; amount: number }
  | { type: 'draw'; count: number }
  | { type: 'opponentDiscardRandom'; count: number }
  /** 回復目標的 HP，不超過上限。 */
  | { type: 'heal'; amount: number }
  /** 自己的英雄與每隻生物各回復 N，不選目標。 */
  | { type: 'healAll'; amount: number }
  /** 消滅目標生物：直接送進棄牌區，不算傷害，減傷擋不住。 */
  | { type: 'destroyCreature' }
  /** 在自己最左邊的空格召喚 count 隻衍生物（token 是衍生物卡的 id）；格子滿了就不召喚。 */
  | { type: 'summonToken'; token: string; count: number }
  /** 看牌庫頂 look 張，選 pick 張加入手牌，其餘放回牌庫底。選的時候對局停下來等這位玩家決定。 */
  | { type: 'lookPick'; look: number; pick: number }
  /**
   * 目標剩餘 HP 減半、無條件捨去。算失去 HP 不算傷害：減傷擋不住，也不受挑釁限制。
   * all 為 true 時不選目標，對手每隻生物都減半。
   */
  | { type: 'halveHp'; all?: boolean }
  /** 發動者挑釁，直到對手下回合結束。 */
  | { type: 'taunt' }
  /**
   * 放增益指示物。attack 讓攻擊力增加，hp 讓 HP 上限增加。
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
  /** 麻痺：不能攻擊、不能發動技能，直到擁有者的下一個回合結束。 */
  | { type: 'paralyze'; all?: boolean }
  /** 沉默：不能發動技能（攻擊照常），直到擁有者的下一個回合結束。 */
  | { type: 'silence'; all?: boolean }
  /** 繳械：不能攻擊（技能照常，被攻擊時照樣反擊），直到擁有者的下一個回合結束。 */
  | { type: 'disarm'; all?: boolean }
  /** 虛弱：攻擊與反擊的傷害減半（無條件捨去），直到擁有者的下一個回合結束。 */
  | { type: 'weaken'; all?: boolean }
  /** 詛咒：技能與進場效果的傷害減半（無條件捨去），直到擁有者的下一個回合結束。 */
  | { type: 'curse'; all?: boolean };

/** 異常狀態的種類。 */
export type StatusKind = 'poison' | 'burn' | 'paralysis' | 'silence' | 'disarm' | 'weakness' | 'curse';

/** 生物技能、英雄天生技，以及法術的效果部分，都是 Ability。 */
export interface Ability {
  name: string;
  cost: number;
  target: TargetSpec;
  effects: Effect[];
  /** 每局最多發動幾次；沒有就不限。目前用在天生技上。 */
  uses?: number;
}

interface CardBase {
  id: string;
  name: string;
  colors: Color[];
  rarity: Rarity;
}

export interface CreatureDef extends CardBase {
  kind: 'creature';
  /** 0 = 基礎，1 = 進化。最多進化一次。 */
  stage: 0 | 1;
  /** 基礎生物是召喚費用，進化生物是進化費用。 */
  cost: number;
  /** 進化生物才有：從哪張卡進化而來。 */
  evolvesFrom?: string;
  /** 攻擊力：攻擊時打多少，被攻擊時反擊多少。 */
  attack: number;
  hp: number;
  skills: Ability[];
  keywords?: Keyword[];
  /** 再生 N：擁有者的回合開始時，這隻生物回復 N HP。 */
  regenerate?: number;
  /** 衍生物：只能由效果召喚，不能放進牌組；離場時直接消失，不進棄牌區。 */
  token?: boolean;
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
}

export interface ItemDef extends CardBase {
  kind: 'item';
  cost: number;
  /** 這隻生物的攻擊力加成。 */
  attack?: number;
  /** 這隻生物受到的傷害減少。 */
  damageReduction?: number;
  /** 這隻生物的 HP 上限加成。 */
  hp?: number;
  /** 裝上之後多的技能，排在生物自己的技能後面。 */
  skills?: Ability[];
}

/** 場地卡放在自己的場地區，效果只作用在自己身上。 */
export interface FieldDef extends CardBase {
  kind: 'field';
  cost: number;
  /** 強化自己的生物。 */
  creatures?: CreatureModifier;
  /** 提高自己的最高上限。突破型，目前範例卡不使用。 */
  ceilingBonus?: number;
  /** 自己的回合開始時多抽幾張。 */
  extraDraw?: number;
  /** 自己的回合開始時，自己的英雄回復多少。 */
  heroRegenerate?: number;
  /** 自己的回合開始時，對手每隻生物失去多少 HP（不算傷害）。 */
  enemyDecay?: number;
  /** 吸血：上面讓對手生物失去的 HP，自己的英雄回復等量。 */
  lifesteal?: boolean;
}

export interface HeroPassive {
  name: string;
  /** 強化自己的生物。 */
  creatures?: CreatureModifier;
  /** 只在自己的回合生效的強化，例如只加在自己回合的攻擊上。 */
  ownTurn?: CreatureModifier;
  /**
   * 只在對手的回合生效的強化，例如只在被攻擊時多 HP。
   * 多出來的 HP 先吸收傷害：到自己的回合加成消失時，受到的傷害跟著減少同樣多，不會因此被擊倒。
   */
  opponentTurn?: CreatureModifier;
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
  /** 同名卡最多幾張。 */
  maxCopies: number;
  /** UR 同名卡最多幾張，比 maxCopies 更嚴。 */
  maxUrCopies: number;
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
  /** 這回合攻擊過或發動過技能：兩者每回合合計一次。 */
  actedTurn: number | null;
  /** 挑釁持續到這個回合結束（含）。 */
  tauntUntilTurn: number | null;
  /** 中毒的數字，0 表示沒有中毒。 */
  poison: number;
  /** 灼燒的數字，0 表示沒有灼燒。 */
  burn: number;
  /** 麻痺到這個回合結束（含）。 */
  paralyzedUntilTurn: number | null;
  /** 沉默到這個回合結束（含）。 */
  silencedUntilTurn: number | null;
  /** 繳械到這個回合結束（含）。 */
  disarmedUntilTurn: number | null;
  /** 虛弱到這個回合結束（含）。 */
  weakenedUntilTurn: number | null;
  /** 詛咒到這個回合結束（含）。 */
  cursedUntilTurn: number | null;
}

export interface PlayerState {
  heroId: string;
  heroDamage: number;
  heroPowerUsedTurn: number | null;
  /** 目前這個天生技這局用了幾次；英雄進化換成新的天生技時重新算。 */
  heroPowerUses: number;
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
  /** 正在等這位玩家從翻開的牌裡選牌；null 表示沒有。 */
  choice: PendingChoice | null;
}

/** 看牌庫頂選牌：翻開的牌只有選的人看得到。 */
export interface PendingChoice {
  player: PlayerId;
  /** 發動的技能或法術名稱，顯示用。 */
  ability: string;
  cards: CardRef[];
  /** 要選幾張。 */
  pick: number;
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
  /** 生物攻擊對手的生物或英雄：不花能量；打生物時對方會反擊。 */
  | { type: 'attack'; player: PlayerId; zone: number; target: Target }
  | { type: 'heroPower'; player: PlayerId; target?: Target }
  | { type: 'evolveHero'; player: PlayerId; card: number; target?: Target }
  | { type: 'castSpell'; player: PlayerId; card: number; target?: Target }
  | { type: 'attachItem'; player: PlayerId; card: number; zone: number }
  | { type: 'playField'; player: PlayerId; card: number }
  /** 讓自己的生物退場：連同身上的道具送進棄牌區，空出格子。不花能量。 */
  | { type: 'dismiss'; player: PlayerId; zone: number }
  | { type: 'endTurn'; player: PlayerId }
  /** 從翻開的牌裡選牌（uid），張數要剛好。 */
  | { type: 'choose'; player: PlayerId; cards: number[] }
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
  /** 翻開牌庫頂等著選；選完是 picked。 */
  | { type: 'revealing'; player: PlayerId; count: number; pick: number }
  /** 選完了：選的牌加入手牌（見 drew 事件），其餘 rest 張放回牌庫底。 */
  | { type: 'picked'; player: PlayerId; count: number; rest: number }
  | { type: 'mulliganed'; player: PlayerId; count: number }
  | { type: 'summoned'; player: PlayerId; zone: number; cardId: string }
  | { type: 'evolved'; player: PlayerId; zone: number; from: string; to: string }
  | { type: 'heroEvolved'; player: PlayerId; cardId: string }
  | { type: 'abilityUsed'; player: PlayerId; source: 'creature' | 'hero' | 'spell' | 'entry'; cardId: string; ability: string }
  /** 生物攻擊，接著是雙方受到傷害的事件。 */
  | { type: 'attacked'; player: PlayerId; zone: number; cardId: string; target: Target }
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
  | { type: 'gameOver'; result: GameResult };

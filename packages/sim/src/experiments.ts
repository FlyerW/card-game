import {
  ALL_CARDS,
  ALL_HEROES,
  buildCardDb,
  createEngine,
  deckPool,
  SAMPLE_CARDS,
  SAMPLE_HEROES,
  type Color,
  type GameConfig,
  type HeroDef,
  type Rules,
} from '@card-game/engine';
import { STYLES, type BotStyle } from './bot';
import { buildDeck } from './deck';

// ─── 模擬環境 ────────────────────────────────────────────────────────────────
//
// 鏡像對戰：兩邊同一副牌、同一個英雄、同一種打法，唯一的差別是誰先手。
// 所以先攻勝率偏離 50% 多少，就是先後手差距有多大。
//
// 前兩組實驗的英雄是模擬專用的：沒有任何效果、五色都能用、HP 可調。
// 五色是為了讓每一局都從整個卡池組牌，沒有效果是為了只測規則本身。
// 第三組用範例卡裡的英雄，牌組只從他自己能用的卡組。

const ALL_COLORS: Color[] = ['white', 'blue', 'black', 'red', 'green'];
/** 英雄基準 HP。 */
export const BASE_HP = 40;
/** 英雄的 HP 定在 35–45 之間。 */
export const HERO_HPS = [35, 40, 45] as const;
const simHero = (hp: number): HeroDef => ({ kind: 'hero', id: `sim-${hp}`, name: `模擬英雄 ${hp}`, colors: ALL_COLORS, hp });

/** CARD_PREVIEW=1：連還沒發布的卡包系列一起模擬（發布前測強度用）。 */
const PREVIEW = process.env.CARD_PREVIEW === '1';
const CARDS = PREVIEW ? ALL_CARDS : SAMPLE_CARDS;
export const db = buildCardDb(CARDS, [...(PREVIEW ? ALL_HEROES : SAMPLE_HEROES), ...HERO_HPS.map(simHero)]);
export const engine = createEngine(db);

export interface Experiment {
  id: string;
  label: string;
  rules: Partial<Rules>;
  heroHp: number;
  style: BotStyle;
  /** 用範例卡裡的英雄與他自己的卡池；沒有就用模擬英雄與整個卡池。 */
  heroId?: string;
  /** 英雄對戰：對手換成這個英雄與他自己的卡池；沒有就是鏡像對戰。 */
  opponentId?: string;
  /** 這組實驗打幾局，是預設局數的幾倍。 */
  share?: number;
}

/**
 * 規則已經定案（DEFAULT_RULES：先攻能量上限 1、後攻 2，每回合 +2，後攻沒有額外的能量），
 * 英雄 HP 定在 35–45。舊的能量制度（LEGACY_ENERGY_RULES）與無補償的比較見 docs/design.md。
 *
 * 1. 三種打法（英雄 40 HP）：先後手平衡，以及結論會不會因打法而變。
 * 2. 英雄 35／40／45 HP（均衡打法）：英雄血量怎麼影響對局長度。
 * 3. 範例卡的每個英雄（均衡打法）：用他自己能用的卡組牌，看實際的對局長度與先後手。
 * 4. 範例卡的英雄兩兩對戰（均衡打法、各自的卡池）：看哪個英雄、哪個顏色太強或太弱。局數是其他組的一半。
 */
export const EXPERIMENTS: Experiment[] = [
  ...Object.entries(STYLES).map(([styleId, style]) => ({
    id: `new/${styleId}/${BASE_HP}`,
    label: '現行規則',
    rules: {},
    heroHp: BASE_HP,
    style,
  })),
  ...HERO_HPS.filter((hp) => hp !== BASE_HP).map((hp) => ({
    id: `new/balanced/${hp}`,
    label: '現行規則',
    rules: {},
    heroHp: hp,
    style: STYLES.balanced,
  })),
  ...SAMPLE_HEROES.map((hero) => ({
    id: `hero/${hero.id}`,
    label: hero.name,
    rules: {},
    heroHp: hero.hp,
    style: STYLES.balanced,
    heroId: hero.id,
  })),
  ...SAMPLE_HEROES.flatMap((hero, i) =>
    SAMPLE_HEROES.slice(i + 1).map((rival) => ({
      id: `vs/${hero.id}/${rival.id}`,
      label: `${hero.name} 對 ${rival.name}`,
      rules: {},
      heroHp: hero.hp,
      style: STYLES.balanced,
      heroId: hero.id,
      opponentId: rival.id,
      share: 0.5,
    })),
  ),
];

/** 模擬用的牌組：進化線照 2/2 帶，其餘隨機；模擬英雄沒有英雄進化卡。同一個 seed 一定組出同一副。 */
export const mirrorDeck = (seed: number): string[] => buildDeck(seed, null);

/**
 * 第 i 局在每個實驗裡都用同一個種子、同一副牌（共同隨機數），
 * 所以不同規則之間的差異，不會是剛好抽到不同牌造成的。
 */
export function gameConfig(experiment: Experiment, game: number): GameConfig {
  const seed = game * 7919 + 17;
  const heroId = experiment.heroId ?? `sim-${experiment.heroHp}`;
  const deck = experiment.heroId ? buildDeck(seed, heroId, deckPool(db, heroId)) : mirrorDeck(seed);
  if (experiment.opponentId !== undefined) {
    const rival = experiment.opponentId;
    return {
      seed: game + 1,
      players: [
        { heroId, deck },
        { heroId: rival, deck: buildDeck(seed + 1, rival, deckPool(db, rival)) },
      ],
      rules: experiment.rules,
    };
  }
  return {
    seed: game + 1,
    players: [
      { heroId, deck },
      { heroId, deck },
    ],
    rules: experiment.rules,
  };
}

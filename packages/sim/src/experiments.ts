import {
  buildCardDb,
  createEngine,
  LEGACY_ENERGY_RULES,
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
// 英雄是模擬專用的：沒有任何效果、五色都能用、HP 可調。
// 範例卡只有 21 張，單色組不成 40 張，所以用五色；沒有效果是為了只測能量制度本身。

const ALL_COLORS: Color[] = ['white', 'blue', 'black', 'red', 'green'];
export const HERO_HPS = [40, 50, 60, 70] as const;
const simHero = (hp: number): HeroDef => ({ kind: 'hero', id: `sim-${hp}`, name: `模擬英雄 ${hp}`, colors: ALL_COLORS, hp });

export const db = buildCardDb(SAMPLE_CARDS, [...SAMPLE_HEROES, ...HERO_HPS.map(simHero)]);
export const engine = createEngine(db);

export interface Experiment {
  id: string;
  label: string;
  rules: Partial<Rules>;
  heroHp: number;
  style: BotStyle;
}

const ENERGY_SYSTEMS = [
  { id: 'legacy', label: '舊制', rules: LEGACY_ENERGY_RULES },
  { id: 'new', label: '新制', rules: {} },
  { id: 'new-flat', label: '新制・無補償', rules: { startingMaxEnergy: [1, 1] as [number, number] } },
];

/**
 * 1. 三種能量制度 × 三種打法（英雄都是 50 HP）：先後手平衡，以及結論會不會因打法而變。
 * 2. 新制 × 英雄 40／60／70 HP（均衡打法）：英雄血量夠不夠。
 */
export const EXPERIMENTS: Experiment[] = [
  ...ENERGY_SYSTEMS.flatMap((system) =>
    Object.entries(STYLES).map(([styleId, style]) => ({
      id: `${system.id}/${styleId}/50`,
      label: system.label,
      rules: system.rules,
      heroHp: 50,
      style,
    })),
  ),
  ...HERO_HPS.filter((hp) => hp !== 50).map((hp) => ({
    id: `new/balanced/${hp}`,
    label: '新制',
    rules: {},
    heroHp: hp,
    style: STYLES.balanced,
  })),
];

/** 模擬用的牌組：進化線照 3/2/1 帶，其餘隨機；模擬英雄沒有英雄進化卡。同一個 seed 一定組出同一副。 */
export const mirrorDeck = (seed: number): string[] => buildDeck(seed, null);

/**
 * 第 i 局在每個實驗裡都用同一個種子、同一副牌（共同隨機數），
 * 所以不同規則之間的差異，不會是剛好抽到不同牌造成的。
 */
export function gameConfig(experiment: Experiment, game: number): GameConfig {
  const deck = mirrorDeck(game * 7919 + 17);
  const heroId = `sim-${experiment.heroHp}`;
  return {
    seed: game + 1,
    players: [
      { heroId, deck },
      { heroId, deck },
    ],
    rules: experiment.rules,
  };
}

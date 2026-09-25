import { buildCardDb } from '../src/db';
import type { Ability, DeckCardDef, HeroDef, TargetSpec } from '../src/types';

// 測試專用的卡。數值刻意簡單，而且跟範例卡分開：之後調整範例卡的平衡，測試不會跟著壞。
// 除了顏色相關的測試，全部是無色，任何英雄都能用。

const ANY: TargetSpec = { kind: 'enemy', allow: 'any' };
const NONE: TargetSpec = { kind: 'none' };
const hit = (name: string, target: TargetSpec, amount: number, cost = 1): Ability => ({
  name,
  cost,
  target,
  effects: [{ type: 'damage', amount }],
});

const creature = (
  id: string,
  skills: Ability[],
  extra: Partial<Extract<DeckCardDef, { kind: 'creature' }>> = {},
): DeckCardDef => ({ kind: 'creature', id, name: id, rarity: 'R', colors: [], stage: 0, cost: 1, hp: 10, skills, ...extra });

export const TEST_CARDS: DeckCardDef[] = [
  creature('wolf', [hit('bite', ANY, 3)], { rarity: 'N', hp: 6 }),
  creature('hitter', [hit('any5', ANY, 5), hit('creature6', { kind: 'enemy', allow: 'creature' }, 6)]),
  creature('lancer', [hit('opposite7', { kind: 'lane', lane: 'opposite' }, 7), hit('diagonal7', { kind: 'lane', lane: 'diagonal' }, 7)]),
  creature('burner', [
    hit('hero6', { kind: 'enemy', allow: 'hero' }, 6),
    { name: 'aoe2', cost: 1, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
  ]),
  creature('taunter', [{ name: 'taunt', cost: 1, target: NONE, effects: [{ type: 'taunt' }] }, hit('poke', ANY, 1)], { hp: 12 }),
  creature('witch', [
    { name: 'halve', cost: 1, target: { kind: 'enemy', allow: 'creature' }, effects: [{ type: 'halveHp' }] },
    { name: 'discard', cost: 1, target: NONE, effects: [{ type: 'opponentDiscardRandom', count: 1 }] },
  ]),
  creature('bruiser', [
    { name: 'boost3', cost: 1, target: NONE, effects: [{ type: 'buff', attack: 3, hp: 3, on: 'self' }] },
    { name: 'sharpen2', cost: 1, target: NONE, effects: [{ type: 'buff', attack: 2, hp: 0, on: 'self' }] },
    hit('jab', ANY, 1),
    { name: 'aoe1', cost: 1, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 1 }] },
  ]),
  creature('rusher', [hit('dash', ANY, 2), hit('dash2', ANY, 2)], { keywords: ['haste'] }),
  creature('grower', [
    { name: 'ramp', cost: 1, target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
    { name: 'break-ceiling', cost: 1, target: NONE, effects: [{ type: 'raiseCeiling', amount: 2 }] },
  ]),
  creature('scholar', [{ name: 'study', cost: 1, target: NONE, effects: [{ type: 'draw', count: 1 }] }, hit('tap', ANY, 1)]),
  creature('pricey', [hit('a', ANY, 1), hit('b', ANY, 1)], { cost: 5 }),

  // 進化線 N → R → SR
  creature('pup', [hit('nip', ANY, 1)], { rarity: 'N', hp: 6 }),
  creature('hound', [hit('bite2', ANY, 2), { name: 'sniff', cost: 1, target: NONE, effects: [{ type: 'draw', count: 1 }] }], {
    stage: 1,
    evolvesFrom: 'pup',
    cost: 2,
    hp: 10,
  }),
  creature('warg', [hit('maul', ANY, 3), hit('howl', ANY, 3)], { rarity: 'SR', stage: 2, evolvesFrom: 'hound', cost: 3, hp: 14 }),

  // 找進化卡、直接進化
  creature('seed', [
    { name: 'search', cost: 1, target: NONE, effects: [{ type: 'searchEvolution' }] },
    { name: 'bloom', cost: 1, target: NONE, effects: [{ type: 'evolveFromDeck' }] },
  ], { hp: 6 }),
  creature('sprout', [hit('x', ANY, 1), hit('y', ANY, 1)], { rarity: 'SR', stage: 1, evolvesFrom: 'seed', cost: 5, hp: 12 }),

  { kind: 'spell', id: 'zap', name: 'zap', rarity: 'N', colors: [], cost: 1, target: ANY, effects: [{ type: 'damage', amount: 3 }] },
  {
    kind: 'spell', id: 'mend', name: 'mend', rarity: 'N', colors: [], cost: 1,
    target: { kind: 'ally', allow: 'any' }, effects: [{ type: 'heal', amount: 4 }],
  },
  {
    kind: 'spell', id: 'shatter', name: 'shatter', rarity: 'R', colors: [], cost: 1,
    target: { kind: 'enemyItemOrField' }, effects: [{ type: 'destroy' }],
  },
  { kind: 'item', id: 'armor', name: 'armor', rarity: 'N', colors: [], cost: 1, damageReduction: 2 },
  { kind: 'item', id: 'blade', name: 'blade', rarity: 'N', colors: [], cost: 1, attack: 2 },
  { kind: 'item', id: 'amulet', name: 'amulet', rarity: 'N', colors: [], cost: 1, hp: 3 },
  { kind: 'field', id: 'altar', name: 'altar', rarity: 'R', colors: [], cost: 1, ceilingBonus: 2 },
  { kind: 'field', id: 'shrine', name: 'shrine', rarity: 'R', colors: [], cost: 1, ceilingBonus: 1 },
  { kind: 'field', id: 'camp', name: 'camp', rarity: 'R', colors: [], cost: 1, creatures: { attack: 1, hp: 2 } },

  // 進場效果
  creature('sparker', [hit('a', ANY, 1), hit('b', ANY, 1)], {
    hp: 4, entry: { name: 'spark', target: ANY, effects: [{ type: 'damage', amount: 2 }] },
  }),
  creature('biter', [hit('a', ANY, 1), hit('b', ANY, 1)], {
    entry: { name: 'bite', target: { kind: 'enemy', allow: 'creature' }, effects: [{ type: 'damage', amount: 3 }] },
  }),
  creature('charger', [hit('a', ANY, 1), hit('b', ANY, 1)], {
    entry: { name: 'charge', target: { kind: 'lane', lane: 'opposite' }, effects: [{ type: 'damage', amount: 3 }] },
  }),
  creature('scout', [hit('a', ANY, 1), hit('b', ANY, 1)], {
    entry: { name: 'look', target: NONE, effects: [{ type: 'draw', count: 1 }] },
  }),
  creature('rallier', [hit('a', ANY, 1), hit('b', ANY, 1)], {
    entry: { name: 'rally', target: { kind: 'ally', allow: 'creature' }, effects: [{ type: 'buff', attack: 1, hp: 1, on: 'target' }] },
  }),
  creature('egg', [hit('a', ANY, 1), hit('b', ANY, 1)]),
  creature('chick', [hit('a', ANY, 1), hit('b', ANY, 1)], {
    rarity: 'SR', stage: 1, evolvesFrom: 'egg', cost: 1, hp: 12,
    entry: { name: 'hatch', target: NONE, effects: [{ type: 'draw', count: 1 }] },
  }),

  // 異常狀態
  creature('venom', [
    { name: 'poison2', cost: 1, target: { kind: 'enemy', allow: 'creature' }, effects: [{ type: 'poison', amount: 2 }] },
    { name: 'burn3', cost: 1, target: { kind: 'enemy', allow: 'creature' }, effects: [{ type: 'burn', amount: 3 }] },
  ]),
  creature('mesmer', [
    { name: 'stun', cost: 1, target: { kind: 'enemy', allow: 'creature' }, effects: [{ type: 'paralyze' }] },
    { name: 'lull', cost: 1, target: { kind: 'enemy', allow: 'creature' }, effects: [{ type: 'sleep' }] },
  ]),
  {
    kind: 'spell', id: 'dart', name: 'dart', rarity: 'N', colors: [], cost: 1,
    target: ANY, effects: [{ type: 'damage', amount: 1 }, { type: 'poison', amount: 2 }],
  },

  // 英雄進化：只有 pinger 能用
  {
    kind: 'heroEvolution', id: 'pinger-plus', name: 'pinger-plus', rarity: 'SR', colors: ['red'],
    cost: 3, evolvesFrom: 'pinger', hpBonus: 10,
    power: hit('blast', ANY, 4, 2),
    passive: { name: 'fury', creatures: { attack: 1 } },
  },

  // 顏色測試
  creature('red-imp', [hit('x', ANY, 1), hit('y', ANY, 1)], { colors: ['red'] }),
  creature('gold-griffin', [hit('x', ANY, 1), hit('y', ANY, 1)], { colors: ['red', 'green'] }),
];

export const TEST_HEROES: HeroDef[] = [
  { kind: 'hero', id: 'blank', name: 'blank', colors: ['white', 'blue', 'black', 'red', 'green'], hp: 50 },
  { kind: 'hero', id: 'pinger', name: 'pinger', colors: ['red'], hp: 46, power: hit('ping', ANY, 2, 2) },
  { kind: 'hero', id: 'forester', name: 'forester', colors: ['green'], hp: 47, passive: { name: 'plenty', ceilingBonus: 1 } },
  { kind: 'hero', id: 'red-green', name: 'red-green', colors: ['red', 'green'], hp: 45 },
  {
    kind: 'hero', id: 'warden', name: 'warden', colors: ['white'], hp: 48,
    passive: { name: 'guard', creatures: { damageReduction: 1 } },
  },
];

export const testDb = () => buildCardDb(TEST_CARDS, TEST_HEROES);

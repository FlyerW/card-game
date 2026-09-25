import { buildCardDb } from '../db';
import type { Ability, DeckCardDef, HeroDef, TargetSpec } from '../types';

// 設計文件「範例卡牌」一節的卡，名字與數值都是暫定。
// 數值參照「數值基準」：HP ≈ 4 + 2 × 召喚費用；單體傷害 ≈ 任意 2.5、單類 3、位置 3.5 倍費用。

const ANY: TargetSpec = { kind: 'enemy', allow: 'any' };
const CREATURE: TargetSpec = { kind: 'enemy', allow: 'creature' };
const HERO: TargetSpec = { kind: 'enemy', allow: 'hero' };
const OPPOSITE: TargetSpec = { kind: 'lane', lane: 'opposite' };
const DIAGONAL: TargetSpec = { kind: 'lane', lane: 'diagonal' };
const NONE: TargetSpec = { kind: 'none' };

const hit = (name: string, cost: number, target: TargetSpec, amount: number): Ability => ({
  name,
  cost,
  target,
  effects: [{ type: 'damage', amount }],
});

export const SAMPLE_HEROES: HeroDef[] = [
  { kind: 'hero', id: 'nameless-swordsman', name: '無名劍士', colors: ['white'], hp: 50 },
  {
    kind: 'hero',
    id: 'flame-lord',
    name: '烈焰領主',
    colors: ['red'],
    hp: 46,
    power: hit('燃燼', 2, ANY, 2),
  },
  {
    kind: 'hero',
    id: 'forest-king',
    name: '林海之王',
    colors: ['green'],
    hp: 47,
    passive: { name: '豐饒', ceilingBonus: 1 },
  },
  {
    kind: 'hero',
    id: 'tide-shadow-twins',
    name: '潮影雙生',
    colors: ['blue', 'black'],
    hp: 40,
    power: { name: '低語', cost: 2, target: NONE, effects: [{ type: 'opponentDiscardRandom', count: 1 }] },
  },
  {
    kind: 'hero',
    id: 'prism-sage',
    name: '虹彩賢者',
    colors: ['white', 'blue', 'black', 'red', 'green'],
    hp: 30,
  },
];

export const SAMPLE_CARDS: DeckCardDef[] = [
  // ── N：單純的數值卡，只有一個技能 ──
  {
    kind: 'creature', id: 'gray-wolf', name: '灰狼', rarity: 'N', colors: [],
    stage: 0, cost: 1, hp: 6,
    skills: [hit('撕咬', 1, CREATURE, 3)],
  },
  {
    kind: 'creature', id: 'ember-fox', name: '焰尾狐', rarity: 'N', colors: ['red'],
    stage: 0, cost: 2, hp: 8,
    skills: [hit('火花', 2, DIAGONAL, 7)],
  },

  // ── 紅色進化線：N → R → SR ──
  {
    kind: 'creature', id: 'ember-fox-king', name: '焰狐王', rarity: 'R', colors: ['red'],
    stage: 1, evolvesFrom: 'ember-fox', cost: 3, hp: 15,
    skills: [
      { name: '狐火', cost: 2, target: DIAGONAL, effects: [{ type: 'damage', amount: 7 }, { type: 'draw', count: 1 }] },
      hit('燃魂', 3, HERO, 9),
    ],
  },
  {
    kind: 'creature', id: 'nine-tailed-fox', name: '九尾天狐', rarity: 'SR', colors: ['red'],
    stage: 2, evolvesFrom: 'ember-fox-king', cost: 4, hp: 24,
    skills: [
      {
        name: '燎天', cost: 4, target: NONE,
        effects: [{ type: 'damageEnemyCreatures', amount: 4 }, { type: 'buff', attack: 1, hp: 1, on: 'self' }],
      },
      hit('天焰', 5, DIAGONAL, 17),
    ],
  },

  // ── R：開始有特殊機制 ──
  {
    kind: 'creature', id: 'shield-knight', name: '盾衛騎士', rarity: 'R', colors: ['white'],
    stage: 0, cost: 3, hp: 12,
    skills: [
      { name: '挑釁', cost: 1, target: NONE, effects: [{ type: 'taunt' }] },
      hit('正面衝鋒', 2, OPPOSITE, 7),
    ],
  },
  {
    kind: 'creature', id: 'tide-mage', name: '潮汐術士', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 2, hp: 7,
    skills: [
      { name: '洞察', cost: 1, target: NONE, effects: [{ type: 'draw', count: 1 }] },
      hit('水刃', 2, ANY, 4),
    ],
  },
  {
    kind: 'creature', id: 'wandering-mercenary', name: '流浪傭兵', rarity: 'R', colors: [],
    stage: 0, cost: 3, hp: 10,
    skills: [
      hit('突刺', 2, ANY, 5),
      { name: '磨刀', cost: 1, target: NONE, effects: [{ type: 'buff', attack: 2, hp: 0, on: 'self' }] },
    ],
  },
  {
    kind: 'creature', id: 'grove-bear', name: '林地蠻熊', rarity: 'R', colors: ['green'],
    stage: 0, cost: 4, hp: 12,
    skills: [
      { name: '蓄力', cost: 3, target: NONE, effects: [{ type: 'buff', attack: 3, hp: 3, on: 'self' }] },
      hit('熊掌', 3, CREATURE, 9),
    ],
  },

  // ── 綠色進化線：R → SR → UR（較強的進化鏈）──
  {
    kind: 'creature', id: 'grove-bear-king', name: '森林熊王', rarity: 'SR', colors: ['green'],
    stage: 1, evolvesFrom: 'grove-bear', cost: 3, hp: 20,
    skills: [
      { name: '蓄力', cost: 3, target: NONE, effects: [{ type: 'buff', attack: 3, hp: 3, on: 'self' }] },
      hit('重擊', 4, CREATURE, 12),
    ],
  },
  {
    kind: 'creature', id: 'ancient-bear-god', name: '古樹熊神', rarity: 'UR', colors: ['green'],
    stage: 2, evolvesFrom: 'grove-bear-king', cost: 4, hp: 28,
    skills: [
      {
        name: '森之怒', cost: 5, target: CREATURE,
        effects: [{ type: 'damage', amount: 15 }, { type: 'buff', attack: 2, hp: 2, on: 'self' }],
      },
      { name: '大地震', cost: 6, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 6 }] },
    ],
  },

  // ── SR ──
  {
    kind: 'creature', id: 'soul-eater', name: '影噬魔', rarity: 'SR', colors: ['black'],
    stage: 0, cost: 5, hp: 13,
    skills: [
      { name: '蝕魂', cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }] },
      { name: '竊念', cost: 2, target: NONE, effects: [{ type: 'opponentDiscardRandom', count: 1 }] },
    ],
  },
  {
    kind: 'creature', id: 'vine-colossus', name: '藤蔓巨像', rarity: 'SR', colors: ['green'],
    stage: 0, cost: 6, hp: 18,
    skills: [
      { name: '扎根', cost: 2, target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
      hit('碾壓', 4, CREATURE, 12),
    ],
  },

  // ── UR ──
  {
    kind: 'creature', id: 'ancient-dragon', name: '遠古巨龍', rarity: 'UR', colors: ['red', 'green'],
    stage: 0, cost: 8, hp: 22,
    skills: [
      { name: '龍息', cost: 3, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] },
      hit('焚天', 6, OPPOSITE, 20),
    ],
  },

  // ── 法術 ──
  { kind: 'spell', id: 'fireball', name: '火球術', rarity: 'N', colors: ['red'], cost: 3, target: ANY, effects: [{ type: 'damage', amount: 6 }] },
  {
    kind: 'spell', id: 'healing-light', name: '治癒之光', rarity: 'N', colors: ['white'], cost: 1,
    target: { kind: 'ally', allow: 'any' }, effects: [{ type: 'heal', amount: 4 }],
  },
  { kind: 'spell', id: 'inspiration', name: '靈感', rarity: 'R', colors: ['blue'], cost: 2, target: NONE, effects: [{ type: 'draw', count: 2 }] },
  {
    kind: 'spell', id: 'shatter', name: '裂解', rarity: 'R', colors: ['black'], cost: 2,
    target: { kind: 'enemyItemOrField' }, effects: [{ type: 'destroy' }],
  },
  {
    kind: 'spell', id: 'energy-crystal', name: '能量結晶', rarity: 'R', colors: ['green'], cost: 2,
    target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }],
  },

  // ── 道具與場地 ──
  { kind: 'item', id: 'iron-armor', name: '鐵甲', rarity: 'N', colors: ['white'], cost: 2, damageReduction: 2 },
  { kind: 'item', id: 'claws', name: '利爪', rarity: 'N', colors: ['red'], cost: 1, attack: 2 },
  { kind: 'field', id: 'star-altar', name: '星脈祭壇', rarity: 'SR', colors: [], cost: 3, ceilingBonus: 2 },
];

export const sampleDb = () => buildCardDb(SAMPLE_CARDS, SAMPLE_HEROES);

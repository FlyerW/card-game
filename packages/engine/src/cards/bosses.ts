import type { HeroDef, TargetSpec } from '../types';

// 冒險模式的 BOSS：玩家不能選、卡包開不到、牌組與連線房間都不能用。
// 普通與困難用普通版；惡夢用惡夢版——被動與天生技是 BOSS 專用的（英雄減傷、回合開始時自動發動），HP 也比較多。

const NONE: TargetSpec = { kind: 'none' };
const ANY: TargetSpec = { kind: 'enemy', allow: 'any' };
const CREATURE: TargetSpec = { kind: 'enemy', allow: 'creature' };

const boss = (hero: Omit<HeroDef, 'kind' | 'rarity' | 'boss'>): HeroDef => ({ kind: 'hero', rarity: 'UR', boss: true, ...hero });

export const BOSS_HEROES: HeroDef[] = [
  // 第 1 關：迷霧森林
  boss({
    id: 'boss-grove-king', name: '腐化樹精王', colors: ['green'], hp: 30,
    power: { name: '催生', cost: 3, target: NONE, effects: [{ type: 'summonToken', token: 'sprout-token', count: 1 }] },
  }),
  boss({
    id: 'boss-grove-king-nightmare', name: '腐化樹精王・惡夢', colors: ['green'], hp: 40,
    passive: { name: '腐根', creatures: { hp: 2, regenerate: 1 }, turnStart: [{ type: 'summonToken', token: 'sprout-token', count: 1 }] },
    power: { name: '荊棘之怒', cost: 2, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
  }),
  // 第 2 關：潮汐洞窟
  boss({
    id: 'boss-tide-witch', name: '潮汐女巫', colors: ['blue'], hp: 32,
    power: { name: '潮語', cost: 3, target: NONE, effects: [{ type: 'draw', count: 1 }] },
  }),
  boss({
    id: 'boss-tide-witch-nightmare', name: '潮汐女巫・惡夢', colors: ['blue'], hp: 50,
    passive: { name: '深海庇護', heroArmor: 1, creatures: { hp: 1 }, turnStart: [{ type: 'draw', count: 1 }] },
    power: { name: '漩渦', cost: 2, target: CREATURE, effects: [{ type: 'paralyze' }, { type: 'draw', count: 1 }] },
  }),
  // 第 3 關：亡者墓園
  boss({
    id: 'boss-lich-lord', name: '亡靈君主', colors: ['black'], hp: 34,
    power: { name: '喚骨', cost: 3, target: NONE, effects: [{ type: 'summonToken', token: 'skeleton-token', count: 1 }] },
  }),
  boss({
    id: 'boss-lich-lord-nightmare', name: '亡靈君主・惡夢', colors: ['black'], hp: 42,
    passive: { name: '不朽軍團', turnStart: [{ type: 'summonToken', token: 'skeleton-token', count: 1 }] },
    power: { name: '死亡凋零', cost: 3, target: NONE, effects: [{ type: 'poison', amount: 1, all: true }] },
  }),
  // 第 4 關：熔岩火山
  boss({
    id: 'boss-forge-general', name: '熔爐魔將', colors: ['red'], hp: 36,
    power: { name: '熔岩', cost: 2, target: ANY, effects: [{ type: 'damage', amount: 2 }] },
  }),
  boss({
    id: 'boss-forge-general-nightmare', name: '熔爐魔將・惡夢', colors: ['red'], hp: 42,
    passive: { name: '熔爐之心', ownTurn: { attack: 2 }, heroArmor: 1 },
    power: { name: '隕火', cost: 2, target: ANY, effects: [{ type: 'damage', amount: 4 }] },
  }),
  // 第 5 關：墮落聖堂
  boss({
    id: 'boss-fallen-paladin', name: '墮落聖騎士長', colors: ['white', 'black'], hp: 40,
    power: { name: '聖罰', cost: 3, target: ANY, effects: [{ type: 'damage', amount: 3 }] },
  }),
  boss({
    id: 'boss-fallen-paladin-nightmare', name: '墮落聖騎士長・惡夢', colors: ['white', 'black'], hp: 45,
    passive: { name: '墮落光環', heroArmor: 1, creatures: { hp: 2 }, turnStart: [{ type: 'healHero', amount: 2 }] },
    power: { name: '終焉審判', cost: 4, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
  }),
];

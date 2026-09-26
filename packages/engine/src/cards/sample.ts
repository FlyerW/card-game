import { buildCardDb } from '../db';
import type { Ability, DeckCardDef, HeroDef, TargetSpec } from '../types';

// 大縮模實驗（爐石式）的範例卡。名字與數值都是暫定，數值基準見設計文件「大縮模實驗」一節。
//
// 生物有攻擊力與 HP，每回合可以攻擊（不花能量，被打的生物會反擊）或發動一個技能（花能量，不會被反擊）。
// 生物的基準照總費用 C（進化生物是基礎加進化的費用）：攻擊 C、HP C + 1，跟爐石的白板一樣。
//
// 稀有度：N 沒有技能，數值照基準；R 照基準、一個技能；SR 多 2 點 HP、一個技能；UR 多 3 點數值、兩個技能。
// 無色卡比有顏色的卡少 1 點數值。進場效果、速攻、吸血、再生扣 1 點左右；9 費以上的進場效果不扣。
// 單體傷害（技能與法術共用）：任意目標 = 費用 + 1，剛好解掉同費用的生物；只打英雄、只打生物、位置 = 費用 + 2。
// 附帶其他效果的扣 1–2。範圍傷害約費用的一半；天生技約是同費用技能的一半。
// 回復約是 v0.8 的 1/2，增益、道具、中毒灼燒約是縮模時的 2 倍。

const ANY: TargetSpec = { kind: 'enemy', allow: 'any' };
const CREATURE: TargetSpec = { kind: 'enemy', allow: 'creature' };
const HERO: TargetSpec = { kind: 'enemy', allow: 'hero' };
const OPPOSITE: TargetSpec = { kind: 'lane', lane: 'opposite' };
const DIAGONAL: TargetSpec = { kind: 'lane', lane: 'diagonal' };
const ALLY: TargetSpec = { kind: 'ally', allow: 'any' };
const ALLY_CREATURE: TargetSpec = { kind: 'ally', allow: 'creature' };
const NONE: TargetSpec = { kind: 'none' };

const hit = (name: string, cost: number, target: TargetSpec, amount: number): Ability => ({
  name,
  cost,
  target,
  effects: [{ type: 'damage', amount }],
});

export const SAMPLE_HEROES: HeroDef[] = [
  // 英雄 HP 的起點是 55 − 3 ×（顏色數 − 1）− 效果強度，再照模擬調整。
  {
    kind: 'hero', id: 'nameless-swordsman', name: '無名劍士', colors: ['white'], hp: 53,
    passive: { name: '劍士之道', creatures: { attack: 1 } },
  },
  {
    kind: 'hero',
    id: 'flame-lord',
    name: '烈焰領主',
    colors: ['red'],
    hp: 51,
    power: hit('燃燼', 2, ANY, 1),
  },
  {
    kind: 'hero',
    id: 'forest-king',
    name: '林海之王',
    colors: ['green'],
    hp: 52,
    passive: { name: '豐饒', creatures: { hp: 1 } },
  },
  {
    kind: 'hero',
    id: 'tide-shadow-twins',
    name: '潮影雙生',
    colors: ['blue', 'black'],
    hp: 39,
    power: { name: '低語', cost: 4, uses: 2, target: NONE, effects: [{ type: 'opponentDiscardRandom', count: 1 }] },
  },
  {
    kind: 'hero',
    id: 'prism-sage',
    name: '虹彩賢者',
    colors: ['white', 'blue', 'black', 'red', 'green'],
    hp: 44,
    power: { name: '稜光', cost: 3, uses: 3, target: NONE, effects: [{ type: 'draw', count: 1 }] },
  },
];

export const SAMPLE_CARDS: DeckCardDef[] = [
  // ── 無色：比同費用有顏色的卡少 1 點數值 ──
  { kind: 'creature', id: 'gray-wolf', name: '灰狼', rarity: 'N', colors: [], stage: 0, cost: 1, attack: 1, hp: 1, skills: [] },
  {
    // 用攻擊力換 HP：打不了人，但能挑釁擋刀。
    kind: 'creature', id: 'rock-turtle', name: '岩殼龜', rarity: 'R', colors: [],
    stage: 0, cost: 2, attack: 0, hp: 5,
    skills: [{ name: '縮殼', cost: 1, target: NONE, effects: [{ type: 'taunt' }] }],
  },
  {
    kind: 'creature', id: 'wandering-mercenary', name: '流浪傭兵', rarity: 'R', colors: [],
    stage: 0, cost: 3, attack: 3, hp: 3,
    skills: [{ name: '磨刀', cost: 1, target: NONE, effects: [{ type: 'buff', attack: 2, hp: 0, on: 'self' }] }],
  },
  { kind: 'creature', id: 'gargoyle', name: '石像鬼', rarity: 'N', colors: [], stage: 0, cost: 4, attack: 4, hp: 4, skills: [] },
  {
    kind: 'creature', id: 'siege-colossus', name: '攻城巨像', rarity: 'R', colors: [],
    stage: 0, cost: 9, attack: 9, hp: 9,
    skills: [{ name: '踐踏', cost: 5, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] }],
  },
  {
    kind: 'creature', id: 'astral-dragon', name: '星界巨龍', rarity: 'SR', colors: [],
    stage: 0, cost: 12, attack: 12, hp: 14,
    entry: { name: '星辰啟示', target: NONE, effects: [{ type: 'draw', count: 2 }] },
    skills: [hit('星隕', 5, ANY, 6)],
  },
  { kind: 'item', id: 'travel-cloak', name: '旅人斗篷', rarity: 'N', colors: [], cost: 1, hp: 4 },
  {
    // 道具也可以給技能：裝上的生物多一個技能，一樣每回合跟攻擊合計一次。
    kind: 'item', id: 'longbow', name: '長弓', rarity: 'R', colors: [], cost: 2,
    skills: [hit('射擊', 1, ANY, 2)],
  },
  { kind: 'spell', id: 'snare', name: '捕獸夾', rarity: 'N', colors: [], cost: 2, target: CREATURE, effects: [{ type: 'damage', amount: 3 }] },

  // ── 白：守護、秩序。挑釁、回復、減傷；異常狀態是沉默與繳械 ──
  { kind: 'creature', id: 'squire', name: '見習騎士', rarity: 'N', colors: ['white'], stage: 0, cost: 2, attack: 2, hp: 3, skills: [] },
  {
    kind: 'creature', id: 'paladin', name: '聖騎士', rarity: 'R', colors: ['white'],
    stage: 1, evolvesFrom: 'squire', cost: 3, attack: 5, hp: 6,
    skills: [{ name: '守護', cost: 1, target: NONE, effects: [{ type: 'taunt' }] }],
  },
  {
    // 原本是二階進化；改成最多進化一次之後，技能留著、變成單獨的基礎生物。
    kind: 'creature', id: 'seraph', name: '熾天使', rarity: 'SR', colors: ['white'],
    stage: 0, cost: 6, attack: 6, hp: 9,
    skills: [{ name: '神聖庇護', cost: 2, target: ALLY, effects: [{ type: 'heal', amount: 5 }] }],
  },
  {
    kind: 'creature', id: 'shield-knight', name: '盾衛騎士', rarity: 'R', colors: ['white'],
    stage: 0, cost: 3, attack: 3, hp: 4,
    skills: [{ name: '挑釁', cost: 1, target: NONE, effects: [{ type: 'taunt' }] }],
  },
  {
    kind: 'creature', id: 'spring-nun', name: '聖泉修女', rarity: 'R', colors: ['white'],
    stage: 0, cost: 2, attack: 2, hp: 3,
    skills: [{ name: '治療', cost: 1, target: ALLY, effects: [{ type: 'heal', amount: 3 }] }],
  },
  {
    kind: 'creature', id: 'lullaby-priest', name: '緘默祭司', rarity: 'R', colors: ['white'],
    stage: 0, cost: 3, attack: 3, hp: 4,
    skills: [{ name: '禁言', cost: 2, target: CREATURE, effects: [{ type: 'silence' }] }],
  },
  {
    kind: 'creature', id: 'dream-herald', name: '聖光使者', rarity: 'R', colors: ['white'],
    stage: 0, cost: 3, attack: 3, hp: 3,
    entry: { name: '聖光束縛', target: CREATURE, effects: [{ type: 'disarm' }] },
    skills: [hit('聖光', 2, ANY, 3)],
  },
  {
    kind: 'creature', id: 'assault-rider', name: '突擊騎兵', rarity: 'R', colors: ['white'],
    stage: 0, cost: 4, attack: 4, hp: 4,
    entry: { name: '衝鋒', target: OPPOSITE, effects: [{ type: 'damage', amount: 2 }] },
    skills: [hit('長槍', 3, OPPOSITE, 5)],
  },
  {
    kind: 'creature', id: 'archangel', name: '天使長', rarity: 'UR', colors: ['white'],
    stage: 0, cost: 10, attack: 12, hp: 13,
    entry: { name: '聖光降臨', target: ALLY, effects: [{ type: 'heal', amount: 5 }] },
    skills: [
      { name: '天使之翼', cost: 2, target: ALLY, effects: [{ type: 'heal', amount: 5 }] },
      hit('裁決之劍', 4, ANY, 5),
    ],
  },
  {
    kind: 'creature', id: 'titan-of-light', name: '光之巨神', rarity: 'SR', colors: ['white'],
    stage: 0, cost: 11, attack: 11, hp: 14,
    entry: { name: '神聖光輝', target: NONE, effects: [{ type: 'silence', all: true }] },
    skills: [{ name: '聖盾', cost: 2, target: NONE, effects: [{ type: 'taunt' }, { type: 'buff', attack: 0, hp: 2, on: 'self' }] }],
  },
  {
    kind: 'spell', id: 'healing-light', name: '治癒之光', rarity: 'N', colors: ['white'], cost: 1,
    target: ALLY, effects: [{ type: 'heal', amount: 3 }, { type: 'draw', count: 1 }],
  },
  {
    kind: 'spell', id: 'holy-ward', name: '聖盾術', rarity: 'R', colors: ['white'], cost: 1,
    target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 0, hp: 4, on: 'target' }],
  },
  {
    kind: 'spell', id: 'disarm', name: '繳械', rarity: 'N', colors: ['white'], cost: 1,
    target: CREATURE, effects: [{ type: 'disarm' }],
  },
  {
    kind: 'spell', id: 'lullaby-light', name: '寂靜之光', rarity: 'R', colors: ['white'], cost: 3,
    target: NONE, effects: [{ type: 'silence', all: true }],
  },
  {
    kind: 'spell', id: 'banish', name: '放逐', rarity: 'R', colors: ['white'], cost: 7,
    target: CREATURE, effects: [{ type: 'destroyCreature' }],
  },
  { kind: 'item', id: 'iron-armor', name: '鐵甲', rarity: 'N', colors: ['white'], cost: 2, damageReduction: 1, hp: 2 },
  {
    kind: 'item', id: 'holy-emblem', name: '聖徽', rarity: 'R', colors: ['white'], cost: 2, hp: 1,
    skills: [{ name: '祈禱', cost: 1, target: ALLY, effects: [{ type: 'heal', amount: 3 }] }],
  },
  { kind: 'field', id: 'sanctuary', name: '聖域', rarity: 'R', colors: ['white'], cost: 3, heroRegenerate: 3 },

  // ── 藍：知識、控制。抽牌、干擾對手；異常狀態是麻痺 ──
  { kind: 'creature', id: 'jellyfish', name: '小水母', rarity: 'N', colors: ['blue'], stage: 0, cost: 1, attack: 1, hp: 2, skills: [] },
  {
    kind: 'creature', id: 'storm-jelly', name: '雷光水母', rarity: 'R', colors: ['blue'],
    stage: 1, evolvesFrom: 'jellyfish', cost: 2, attack: 3, hp: 4,
    skills: [{ name: '麻痺觸手', cost: 2, target: CREATURE, effects: [{ type: 'paralyze' }] }],
  },
  {
    // 原本是二階進化；改成最多進化一次之後，技能留著、變成單獨的基礎生物。
    kind: 'creature', id: 'jelly-empress', name: '深海水母皇', rarity: 'SR', colors: ['blue'],
    stage: 0, cost: 5, attack: 5, hp: 8,
    skills: [{ name: '麻痺電網', cost: 3, target: CREATURE, effects: [{ type: 'damage', amount: 4 }, { type: 'paralyze' }] }],
  },
  {
    kind: 'creature', id: 'tide-mage', name: '潮汐術士', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 2, attack: 2, hp: 3,
    skills: [{ name: '洞察', cost: 1, target: NONE, effects: [{ type: 'draw', count: 1 }] }],
  },
  {
    kind: 'creature', id: 'apprentice-scholar', name: '見習學者', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 3, attack: 3, hp: 3,
    entry: { name: '求知', target: NONE, effects: [{ type: 'draw', count: 1 }] },
    skills: [hit('冰錐', 2, ANY, 3)],
  },
  {
    kind: 'creature', id: 'mind-thief', name: '心靈竊賊', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 3, attack: 3, hp: 4,
    skills: [{ name: '竊讀', cost: 3, target: NONE, effects: [{ type: 'draw', count: 1 }, { type: 'opponentDiscardRandom', count: 1 }] }],
  },
  {
    kind: 'creature', id: 'shock-eel', name: '電鰻', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 3, attack: 3, hp: 3,
    entry: { name: '電擊', target: CREATURE, effects: [{ type: 'paralyze' }] },
    skills: [hit('放電', 2, ANY, 3)],
  },
  {
    kind: 'creature', id: 'sea-serpent', name: '海龍', rarity: 'SR', colors: ['blue'],
    stage: 0, cost: 6, attack: 6, hp: 9,
    skills: [{ name: '深海呼喚', cost: 3, target: NONE, effects: [{ type: 'draw', count: 2 }] }],
  },
  {
    kind: 'creature', id: 'kraken', name: '深海巨妖', rarity: 'SR', colors: ['blue'],
    stage: 0, cost: 9, attack: 9, hp: 12,
    entry: { name: '萬觸纏身', target: NONE, effects: [{ type: 'paralyze', all: true }] },
    skills: [{ name: '纏繞', cost: 4, target: CREATURE, effects: [{ type: 'damage', amount: 5 }, { type: 'paralyze' }] }],
  },
  { kind: 'spell', id: 'ice-shard', name: '冰錐', rarity: 'N', colors: ['blue'], cost: 2, target: ANY, effects: [{ type: 'damage', amount: 3 }] },
  { kind: 'spell', id: 'glacial-bind', name: '冰封', rarity: 'R', colors: ['blue'], cost: 2, target: CREATURE, effects: [{ type: 'paralyze' }] },
  {
    kind: 'spell', id: 'counter-current', name: '反制電流', rarity: 'R', colors: ['blue'], cost: 3,
    target: CREATURE, effects: [{ type: 'damage', amount: 3 }, { type: 'paralyze' }],
  },
  { kind: 'spell', id: 'inspiration', name: '靈感', rarity: 'R', colors: ['blue'], cost: 3, target: NONE, effects: [{ type: 'draw', count: 2 }] },
  // 看 4 選 2：跟抽 2 一樣多張，但挑得到想要的，比靈感貴 1 費。
  {
    kind: 'spell', id: 'tide-divination', name: '潮汐占卜', rarity: 'R', colors: ['blue'], cost: 4,
    target: NONE, effects: [{ type: 'lookPick', look: 4, pick: 2 }],
  },
  // 抽 1 張約 1.5 能量，抽 3 ≈ 4.5，取 5 費。
  { kind: 'spell', id: 'torrent-of-knowledge', name: '知識洪流', rarity: 'R', colors: ['blue'], cost: 5, target: NONE, effects: [{ type: 'draw', count: 3 }] },
  {
    kind: 'spell', id: 'glacial-rift', name: '冰川裂縫', rarity: 'R', colors: ['blue'], cost: 5,
    target: CREATURE, effects: [{ type: 'damage', amount: 7 }],
  },
  {
    kind: 'spell', id: 'thunderstorm', name: '雷暴', rarity: 'SR', colors: ['blue'], cost: 5,
    target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }, { type: 'paralyze', all: true }],
  },
  {
    kind: 'spell', id: 'tsunami', name: '大海嘯', rarity: 'SR', colors: ['blue'], cost: 10,
    target: NONE,
    effects: [{ type: 'damageEnemyCreatures', amount: 4 }, { type: 'paralyze', all: true }, { type: 'draw', count: 2 }],
  },
  {
    kind: 'item', id: 'frost-staff', name: '冰霜法杖', rarity: 'R', colors: ['blue'], cost: 2,
    skills: [{ name: '冰凍', cost: 2, target: CREATURE, effects: [{ type: 'paralyze' }] }],
  },
  { kind: 'field', id: 'wellspring', name: '知識之泉', rarity: 'R', colors: ['blue'], cost: 4, extraDraw: 1 },

  // ── 黑：侵蝕、犧牲。破壞卡牌、讓對手棄牌、HP 減半、消滅；異常狀態是中毒與詛咒 ──
  { kind: 'creature', id: 'skeleton', name: '骷髏兵', rarity: 'N', colors: ['black'], stage: 0, cost: 2, attack: 2, hp: 3, skills: [] },
  {
    kind: 'creature', id: 'skeleton-knight', name: '骷髏騎士', rarity: 'R', colors: ['black'],
    stage: 1, evolvesFrom: 'skeleton', cost: 3, attack: 5, hp: 6,
    skills: [{ name: '碎骨', cost: 1, target: { kind: 'enemyItemOrField' }, effects: [{ type: 'destroy' }] }],
  },
  {
    // 原本是二階進化；改成最多進化一次之後，技能留著、變成單獨的基礎生物。
    kind: 'creature', id: 'death-knight', name: '死亡騎士', rarity: 'SR', colors: ['black'],
    stage: 0, cost: 6, attack: 6, hp: 9,
    skills: [{ name: '凋零', cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }] }],
  },
  {
    kind: 'creature', id: 'rust-mite', name: '腐蝕蟲', rarity: 'R', colors: ['black'],
    stage: 0, cost: 2, attack: 2, hp: 3,
    skills: [{ name: '腐蝕', cost: 1, target: { kind: 'enemyItemOrField' }, effects: [{ type: 'destroy' }] }],
  },
  {
    kind: 'creature', id: 'venom-spider', name: '毒蛛', rarity: 'R', colors: ['black'],
    stage: 0, cost: 2, attack: 2, hp: 3,
    skills: [{ name: '劇毒', cost: 2, target: CREATURE, effects: [{ type: 'poison', amount: 2 }] }],
  },
  {
    kind: 'creature', id: 'plague-rat', name: '瘟疫鼠', rarity: 'R', colors: ['black'],
    stage: 0, cost: 2, attack: 2, hp: 2,
    entry: { name: '病菌', target: CREATURE, effects: [{ type: 'poison', amount: 2 }] },
    skills: [{ name: '散播', cost: 3, target: NONE, effects: [{ type: 'poison', amount: 2, all: true }] }],
  },
  {
    kind: 'creature', id: 'hex-witch', name: '咒術巫婆', rarity: 'R', colors: ['black'],
    stage: 0, cost: 3, attack: 3, hp: 4,
    skills: [{ name: '咒縛', cost: 1, target: CREATURE, effects: [{ type: 'curse' }] }],
  },
  {
    kind: 'creature', id: 'soul-eater', name: '影噬魔', rarity: 'SR', colors: ['black'],
    stage: 0, cost: 5, attack: 5, hp: 8,
    skills: [{ name: '蝕魂', cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }] }],
  },
  {
    kind: 'creature', id: 'lord-of-decay', name: '腐朽之王', rarity: 'SR', colors: ['black'],
    stage: 0, cost: 9, attack: 9, hp: 12,
    entry: { name: '腐朽之息', target: NONE, effects: [{ type: 'poison', amount: 2, all: true }] },
    skills: [hit('靈魂收割', 5, HERO, 7)],
  },
  {
    kind: 'spell', id: 'venom-dart', name: '腐毒箭', rarity: 'N', colors: ['black'], cost: 2,
    target: CREATURE, effects: [{ type: 'damage', amount: 2 }, { type: 'poison', amount: 2 }],
  },
  {
    kind: 'spell', id: 'withering-curse', name: '衰敗詛咒', rarity: 'R', colors: ['black'], cost: 2,
    target: CREATURE, effects: [{ type: 'curse' }, { type: 'poison', amount: 2 }],
  },
  { kind: 'spell', id: 'shatter', name: '裂解', rarity: 'R', colors: ['black'], cost: 2, target: { kind: 'enemyItemOrField' }, effects: [{ type: 'destroy' }] },
  { kind: 'spell', id: 'toxic-fog', name: '毒霧', rarity: 'R', colors: ['black'], cost: 3, target: NONE, effects: [{ type: 'poison', amount: 2, all: true }] },
  { kind: 'spell', id: 'death-touch', name: '死亡之觸', rarity: 'R', colors: ['black'], cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }] },
  { kind: 'spell', id: 'annihilate', name: '湮滅', rarity: 'R', colors: ['black'], cost: 4, target: CREATURE, effects: [{ type: 'damage', amount: 6 }] },
  {
    kind: 'spell', id: 'plague', name: '瘟疫', rarity: 'R', colors: ['black'], cost: 4,
    target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }, { type: 'poison', amount: 2, all: true }],
  },
  {
    kind: 'spell', id: 'assassinate', name: '暗殺', rarity: 'R', colors: ['black'], cost: 6,
    target: CREATURE, effects: [{ type: 'destroyCreature' }],
  },
  {
    kind: 'spell', id: 'withering', name: '萬物凋零', rarity: 'SR', colors: ['black'], cost: 10,
    target: NONE,
    effects: [{ type: 'halveHp', all: true }, { type: 'damageEnemyCreatures', amount: 2 }, { type: 'opponentDiscardRandom', count: 1 }],
  },
  { kind: 'item', id: 'bone-armor', name: '骨甲', rarity: 'N', colors: ['black'], cost: 1, attack: 2, hp: 2 },
  { kind: 'field', id: 'rot-marsh', name: '腐沼', rarity: 'R', colors: ['black'], cost: 5, enemyDecay: 1, lifesteal: true },

  // ── 紅：速度、爆發。直接傷害、只打英雄、範圍傷害、速攻；異常狀態是灼燒 ──
  { kind: 'creature', id: 'ember-fox', name: '焰尾狐', rarity: 'N', colors: ['red'], stage: 0, cost: 2, attack: 3, hp: 2, skills: [] },
  {
    kind: 'creature', id: 'ember-fox-king', name: '焰狐王', rarity: 'R', colors: ['red'],
    stage: 1, evolvesFrom: 'ember-fox', cost: 3, attack: 5, hp: 5,
    entry: { name: '狐火彈', target: ANY, effects: [{ type: 'damage', amount: 2 }] },
    skills: [{ name: '狐火', cost: 2, target: DIAGONAL, effects: [{ type: 'damage', amount: 3 }, { type: 'draw', count: 1 }] }],
  },
  {
    // 原本是二階進化；改成最多進化一次之後，技能留著、變成單獨的基礎生物。
    kind: 'creature', id: 'nine-tailed-fox', name: '九尾天狐', rarity: 'SR', colors: ['red'],
    stage: 0, cost: 7, attack: 7, hp: 9,
    entry: { name: '九焰', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
    skills: [{ name: '燎天', cost: 4, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }, { type: 'buff', attack: 2, hp: 2, on: 'self' }] }],
  },
  {
    kind: 'creature', id: 'flame-imp', name: '炎之小鬼', rarity: 'R', colors: ['red'],
    stage: 0, cost: 2, attack: 2, hp: 2,
    entry: { name: '火星', target: ANY, effects: [{ type: 'damage', amount: 2 }] },
    skills: [hit('火舌', 2, DIAGONAL, 4)],
  },
  {
    kind: 'creature', id: 'blast-mage', name: '炎爆術士', rarity: 'R', colors: ['red'],
    stage: 0, cost: 2, attack: 2, hp: 2,
    entry: { name: '引燃', target: CREATURE, effects: [{ type: 'burn', amount: 2 }] },
    skills: [hit('爆燃', 2, CREATURE, 4)],
  },
  {
    kind: 'creature', id: 'arsonist', name: '縱火狂', rarity: 'R', colors: ['red'],
    stage: 0, cost: 3, attack: 3, hp: 3, keywords: ['haste'],
    skills: [{ name: '點燃', cost: 2, target: CREATURE, effects: [{ type: 'burn', amount: 2 }] }],
  },
  {
    kind: 'creature', id: 'inferno-demon', name: '炎魔', rarity: 'UR', colors: ['red'],
    stage: 0, cost: 11, attack: 13, hp: 14,
    entry: { name: '煉獄降臨', target: HERO, effects: [{ type: 'damage', amount: 4 }, { type: 'damageEnemyCreatures', amount: 3 }] },
    skills: [hit('爆炎', 4, DIAGONAL, 6), hit('末日烈焰', 6, HERO, 8)],
  },
  { kind: 'spell', id: 'scorching-ray', name: '灼熱射線', rarity: 'N', colors: ['red'], cost: 2, target: HERO, effects: [{ type: 'damage', amount: 4 }] },
  { kind: 'spell', id: 'fireball', name: '火球術', rarity: 'N', colors: ['red'], cost: 3, target: ANY, effects: [{ type: 'damage', amount: 4 }] },
  { kind: 'spell', id: 'devouring-flame', name: '烈焰吞噬', rarity: 'R', colors: ['red'], cost: 3, target: CREATURE, effects: [{ type: 'damage', amount: 5 }] },
  { kind: 'spell', id: 'wildfire', name: '焚野', rarity: 'R', colors: ['red'], cost: 3, target: NONE, effects: [{ type: 'burn', amount: 2, all: true }] },
  { kind: 'spell', id: 'firestorm', name: '烈焰風暴', rarity: 'SR', colors: ['red'], cost: 6, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] },
  {
    kind: 'spell', id: 'meteor', name: '隕石術', rarity: 'SR', colors: ['red'], cost: 9,
    target: ANY, effects: [{ type: 'damage', amount: 9 }, { type: 'damageEnemyCreatures', amount: 2 }],
  },
  { kind: 'item', id: 'claws', name: '利爪', rarity: 'N', colors: ['red'], cost: 1, attack: 2, hp: 2 },
  // 攻擊 +1 只加在攻擊與反擊上，技能傷害不變。
  { kind: 'field', id: 'war-drums', name: '燎原戰鼓', rarity: 'R', colors: ['red'], cost: 3, creatures: { attack: 1 } },

  // ── 綠：成長、巨大。大型生物、提高能量上限、高 HP、吸血與再生；異常狀態是虛弱 ──
  { kind: 'creature', id: 'forest-stag', name: '林鹿', rarity: 'N', colors: ['green'], stage: 0, cost: 2, attack: 2, hp: 3, skills: [] },
  { kind: 'creature', id: 'moss-lizard', name: '苔甲巨蜥', rarity: 'N', colors: ['green'], stage: 0, cost: 5, attack: 4, hp: 7, skills: [] },
  {
    kind: 'creature', id: 'grove-bear', name: '林地蠻熊', rarity: 'R', colors: ['green'],
    stage: 0, cost: 4, attack: 4, hp: 5,
    skills: [{ name: '呼喚熊王', cost: 1, target: NONE, effects: [{ type: 'searchEvolution' }] }],
  },
  {
    kind: 'creature', id: 'grove-bear-king', name: '森林熊王', rarity: 'SR', colors: ['green'],
    stage: 1, evolvesFrom: 'grove-bear', cost: 3, attack: 7, hp: 10,
    skills: [{ name: '巨力', cost: 4, target: NONE, effects: [{ type: 'buff', attack: 3, hp: 5, on: 'self' }] }],
  },
  {
    // 原本是二階進化；改成最多進化一次之後，技能留著、變成單獨的基礎生物。
    kind: 'creature', id: 'ancient-bear-god', name: '古樹熊神', rarity: 'UR', colors: ['green'],
    stage: 0, cost: 8, attack: 9, hp: 10, keywords: ['lifesteal'],
    skills: [
      { name: '森之怒', cost: 5, target: CREATURE, effects: [{ type: 'damage', amount: 8 }, { type: 'buff', attack: 2, hp: 2, on: 'self' }] },
      { name: '大地震', cost: 6, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] },
    ],
  },
  {
    kind: 'creature', id: 'grove-druid', name: '林語德魯伊', rarity: 'R', colors: ['green'],
    stage: 0, cost: 3, attack: 3, hp: 4,
    skills: [{ name: '催生', cost: 2, target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 2, hp: 2, on: 'target' }] }],
  },
  {
    kind: 'creature', id: 'sapling-guard', name: '樹苗守衛', rarity: 'R', colors: ['green'],
    stage: 0, cost: 2, attack: 2, hp: 2,
    entry: { name: '萌芽', target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 2, hp: 2, on: 'target' }] },
    skills: [{ name: '扎根', cost: 1, target: NONE, effects: [{ type: 'buff', attack: 0, hp: 2, on: 'self' }] }],
  },
  {
    kind: 'creature', id: 'strangler-vine', name: '絞殺藤', rarity: 'R', colors: ['green'],
    stage: 0, cost: 3, attack: 3, hp: 4,
    skills: [{ name: '纏繞', cost: 1, target: CREATURE, effects: [{ type: 'weaken' }] }],
  },
  {
    kind: 'creature', id: 'blood-vine', name: '吸血藤', rarity: 'R', colors: ['green'],
    stage: 0, cost: 3, attack: 3, hp: 3, keywords: ['lifesteal'],
    skills: [hit('汲取', 2, ANY, 3)],
  },
  {
    kind: 'creature', id: 'moss-sprite', name: '苔蘚精靈', rarity: 'R', colors: ['green'],
    stage: 0, cost: 2, attack: 2, hp: 2, regenerate: 1,
    skills: [{ name: '滋養', cost: 1, target: ALLY, effects: [{ type: 'heal', amount: 3 }] }],
  },
  {
    kind: 'creature', id: 'vine-colossus', name: '藤蔓巨像', rarity: 'SR', colors: ['green'],
    stage: 0, cost: 6, attack: 6, hp: 9,
    skills: [{ name: '扎根', cost: 2, target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] }],
  },
  {
    kind: 'creature', id: 'elder-treant', name: '萬年樹人', rarity: 'SR', colors: ['green'],
    stage: 0, cost: 7, attack: 7, hp: 10, regenerate: 2,
    skills: [{ name: '年輪', cost: 2, target: NONE, effects: [{ type: 'buff', attack: 0, hp: 4, on: 'self' }] }],
  },
  {
    // 原本進場是能量上限 +1，但打得出 10 費時下回合就到上限 12 了，沒有用；改成全體回復。
    kind: 'creature', id: 'mountain-giant', name: '山嶺巨人', rarity: 'SR', colors: ['green'],
    stage: 0, cost: 10, attack: 10, hp: 13,
    entry: { name: '大地之息', target: NONE, effects: [{ type: 'healAll', amount: 5 }] },
    skills: [{ name: '山崩', cost: 6, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] }],
  },
  {
    kind: 'creature', id: 'earth-titan', name: '大地泰坦', rarity: 'UR', colors: ['green'],
    stage: 0, cost: 12, attack: 14, hp: 15,
    entry: { name: '震地', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
    skills: [hit('泰坦之拳', 5, CREATURE, 7), { name: '地裂', cost: 6, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] }],
  },
  {
    kind: 'spell', id: 'giant-growth', name: '巨化術', rarity: 'R', colors: ['green'], cost: 2,
    target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 2, hp: 4, on: 'target' }],
  },
  { kind: 'spell', id: 'entangle', name: '藤蔓纏繞', rarity: 'N', colors: ['green'], cost: 1, target: CREATURE, effects: [{ type: 'weaken' }] },
  { kind: 'spell', id: 'forest-breath', name: '森林之息', rarity: 'N', colors: ['green'], cost: 2, target: NONE, effects: [{ type: 'healAll', amount: 3 }] },
  { kind: 'spell', id: 'hunt', name: '獵殺', rarity: 'N', colors: ['green'], cost: 4, target: CREATURE, effects: [{ type: 'damage', amount: 6 }] },
  { kind: 'spell', id: 'energy-crystal', name: '能量結晶', rarity: 'R', colors: ['green'], cost: 2, target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
  // 跳費：能量上限 +1 約 2 能量，所以 4 費跳兩費。
  { kind: 'spell', id: 'earth-pulse', name: '大地脈動', rarity: 'R', colors: ['green'], cost: 4, target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 2 }] },
  // 能量上限 +1 ≈ 2 能量、抽 1 ≈ 1.5，原本 4 費太弱，改 3 費。
  {
    kind: 'spell', id: 'harvest-rite', name: '豐收儀式', rarity: 'R', colors: ['green'], cost: 3,
    target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }, { type: 'draw', count: 1 }],
  },
  { kind: 'item', id: 'bark-armor', name: '樹皮護甲', rarity: 'N', colors: ['green'], cost: 2, hp: 6 },
  { kind: 'field', id: 'guardian-shrine', name: '守護聖壇', rarity: 'R', colors: ['green'], cost: 4, creatures: { hp: 2 } },

  // ── 紅綠 ──
  {
    kind: 'creature', id: 'ancient-dragon', name: '遠古巨龍', rarity: 'UR', colors: ['red', 'green'],
    stage: 0, cost: 8, attack: 10, hp: 11,
    skills: [
      { name: '龍息', cost: 3, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
      hit('焚天', 6, OPPOSITE, 8),
    ],
  },

  // ── 英雄進化：每局限一次，費用約 5–7 ──
  // 像爐石的英雄卡：打出時有進場效果（戰吼），天生技變強或多一個被動。
  {
    kind: 'heroEvolution', id: 'flame-sovereign', name: '烈焰君王', rarity: 'SR', colors: ['red'],
    cost: 6, evolvesFrom: 'flame-lord', hpBonus: 9,
    entry: { name: '焚城', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
    power: hit('煉獄', 2, ANY, 3),
  },
  {
    kind: 'heroEvolution', id: 'world-tree-king', name: '萬木之王', rarity: 'SR', colors: ['green'],
    cost: 5, evolvesFrom: 'forest-king', hpBonus: 11,
    entry: { name: '萬木回春', target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
    passive: { name: '萬木', creatures: { hp: 2 } },
  },
  {
    kind: 'heroEvolution', id: 'sword-saint', name: '無名劍聖', rarity: 'SR', colors: ['white'],
    cost: 6, evolvesFrom: 'nameless-swordsman', hpBonus: 9,
    entry: { name: '劍陣', target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 2, hp: 2, on: 'target' }] },
    power: { name: '劍意', cost: 2, target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 1, hp: 0, on: 'target' }] },
  },
  {
    kind: 'heroEvolution', id: 'tide-shadow-sovereign', name: '潮影君主', rarity: 'SR', colors: ['blue', 'black'],
    cost: 6, evolvesFrom: 'tide-shadow-twins', hpBonus: 11,
    entry: { name: '潮汐吞噬', target: NONE, effects: [{ type: 'opponentDiscardRandom', count: 2 }] },
    power: {
      name: '深淵低語', cost: 3, uses: 2, target: NONE,
      effects: [{ type: 'opponentDiscardRandom', count: 1 }, { type: 'draw', count: 1 }],
    },
  },
];

export const sampleDb = () => buildCardDb(SAMPLE_CARDS, SAMPLE_HEROES);

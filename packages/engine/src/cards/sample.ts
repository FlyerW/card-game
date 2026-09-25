import { buildCardDb } from '../db';
import type { Ability, DeckCardDef, HeroDef, TargetSpec } from '../types';

// 設計文件「範例卡牌」一節的卡，名字與數值都是暫定。
// 數值參照「數值基準」：HP ≈ 2 + 2 × 召喚費用；單體傷害 ≈ 任意 2.5、只打英雄 2.5 + 1、
// 只打生物 3、位置 3.5 倍費用。稀有度預算：N 基準、R 基準加一個機制、SR +10%、UR +20%。
// 只打生物的法術 = 同費用生物的 HP，而且至少比任意目標多 1，一張就能解掉同費用的生物；
// 範圍法術能清掉便宜 3 費以上的生物。
//
// 每個顏色 12 張、無色 8 張（英雄進化卡另計），單色英雄有 20 種卡可以用，組得出 40 張的正式牌組。
// 每個顏色各有一條進化線，也各有自己的異常狀態：白沉睡、藍麻痺、黑中毒、紅灼燒。

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
  // 英雄 HP = 35 − 3 ×（顏色數 − 1）− 效果強度。基準從 50 降到 35，一局才會在 5–10 分鐘。
  { kind: 'hero', id: 'nameless-swordsman', name: '無名劍士', colors: ['white'], hp: 35 },
  {
    kind: 'hero',
    id: 'flame-lord',
    name: '烈焰領主',
    colors: ['red'],
    hp: 32,
    power: hit('燃燼', 2, ANY, 2),
  },
  {
    kind: 'hero',
    id: 'forest-king',
    name: '林海之王',
    colors: ['green'],
    hp: 33,
    passive: { name: '豐饒', creatures: { hp: 1 } },
  },
  {
    kind: 'hero',
    id: 'tide-shadow-twins',
    name: '潮影雙生',
    colors: ['blue', 'black'],
    hp: 28,
    power: { name: '低語', cost: 2, target: NONE, effects: [{ type: 'opponentDiscardRandom', count: 1 }] },
  },
  {
    kind: 'hero',
    id: 'prism-sage',
    name: '虹彩賢者',
    colors: ['white', 'blue', 'black', 'red', 'green'],
    hp: 23,
  },
];

export const SAMPLE_CARDS: DeckCardDef[] = [
  // ── N：單純的數值卡，只有一個技能 ──
  {
    kind: 'creature', id: 'gray-wolf', name: '灰狼', rarity: 'N', colors: [],
    stage: 0, cost: 1, hp: 4,
    skills: [hit('撕咬', 1, CREATURE, 3)],
  },
  {
    kind: 'creature', id: 'ember-fox', name: '焰尾狐', rarity: 'N', colors: ['red'],
    stage: 0, cost: 2, hp: 6,
    skills: [hit('火花', 2, DIAGONAL, 7)],
  },
  {
    // 血量和傷害互換：HP 比基準高一截，傷害就只有 2。
    kind: 'creature', id: 'rock-turtle', name: '岩殼龜', rarity: 'N', colors: [],
    stage: 0, cost: 2, hp: 10,
    skills: [hit('撞擊', 1, ANY, 1)],
  },

  // ── 紅色進化線：N → R → SR ──
  {
    // 進化時的進場效果算在本體裡：2 傷害約 1 能量，HP 少 2。
    kind: 'creature', id: 'ember-fox-king', name: '焰狐王', rarity: 'R', colors: ['red'],
    stage: 1, evolvesFrom: 'ember-fox', cost: 3, hp: 11,
    entry: { name: '狐火彈', target: ANY, effects: [{ type: 'damage', amount: 2 }] },
    skills: [
      { name: '狐火', cost: 2, target: DIAGONAL, effects: [{ type: 'damage', amount: 7 }, { type: 'draw', count: 1 }] },
      hit('燃魂', 3, HERO, 8),
    ],
  },
  {
    kind: 'creature', id: 'nine-tailed-fox', name: '九尾天狐', rarity: 'SR', colors: ['red'],
    stage: 2, evolvesFrom: 'ember-fox-king', cost: 4, hp: 21,
    entry: { name: '九焰', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
    skills: [
      {
        name: '燎天', cost: 4, target: NONE,
        effects: [{ type: 'damageEnemyCreatures', amount: 4 }, { type: 'buff', attack: 1, hp: 1, on: 'self' }],
      },
      hit('天焰', 5, DIAGONAL, 19),
    ],
  },

  // ── R：開始有特殊機制 ──
  {
    kind: 'creature', id: 'shield-knight', name: '盾衛騎士', rarity: 'R', colors: ['white'],
    stage: 0, cost: 3, hp: 10,
    skills: [
      { name: '挑釁', cost: 1, target: NONE, effects: [{ type: 'taunt' }] },
      hit('正面衝鋒', 2, OPPOSITE, 6),
    ],
  },
  {
    kind: 'creature', id: 'tide-mage', name: '潮汐術士', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 2, hp: 5,
    skills: [
      { name: '洞察', cost: 1, target: NONE, effects: [{ type: 'draw', count: 1 }] },
      hit('水刃', 2, ANY, 4),
    ],
  },
  {
    kind: 'creature', id: 'wandering-mercenary', name: '流浪傭兵', rarity: 'R', colors: [],
    stage: 0, cost: 3, hp: 8,
    skills: [
      hit('突刺', 2, ANY, 5),
      { name: '磨刀', cost: 1, target: NONE, effects: [{ type: 'buff', attack: 2, hp: 0, on: 'self' }] },
    ],
  },
  {
    kind: 'creature', id: 'grove-bear', name: '林地蠻熊', rarity: 'R', colors: ['green'],
    stage: 0, cost: 4, hp: 10,
    skills: [
      { name: '蓄力', cost: 3, target: NONE, effects: [{ type: 'buff', attack: 3, hp: 3, on: 'self' }] },
      hit('熊掌', 3, CREATURE, 9),
      { name: '呼喚熊王', cost: 1, target: NONE, effects: [{ type: 'searchEvolution' }] },
    ],
  },

  // ── 綠色進化線：R → SR → UR（較強的進化鏈）──
  {
    kind: 'creature', id: 'grove-bear-king', name: '森林熊王', rarity: 'SR', colors: ['green'],
    stage: 1, evolvesFrom: 'grove-bear', cost: 3, hp: 19,
    skills: [
      { name: '巨力', cost: 4, target: NONE, effects: [{ type: 'buff', attack: 3, hp: 5, on: 'self' }] },
      hit('重擊', 4, CREATURE, 13),
      { name: '古樹之召', cost: 4, target: NONE, effects: [{ type: 'evolveFromDeck' }] },
    ],
  },
  {
    kind: 'creature', id: 'ancient-bear-god', name: '古樹熊神', rarity: 'UR', colors: ['green'],
    stage: 2, evolvesFrom: 'grove-bear-king', cost: 4, hp: 28,
    skills: [
      {
        name: '森之怒', cost: 5, target: CREATURE,
        effects: [{ type: 'damage', amount: 16 }, { type: 'buff', attack: 2, hp: 2, on: 'self' }],
      },
      { name: '大地震', cost: 6, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 7 }] },
    ],
  },

  {
    kind: 'creature', id: 'rust-mite', name: '腐蝕蟲', rarity: 'R', colors: ['black'],
    stage: 0, cost: 2, hp: 5,
    skills: [
      { name: '腐蝕', cost: 1, target: { kind: 'enemyItemOrField' }, effects: [{ type: 'destroy' }] },
      hit('毒牙', 2, CREATURE, 5),
    ],
  },

  // ── 進場效果：價值從本體扣，每 1 能量的效果約少 2 HP ──
  {
    kind: 'creature', id: 'flame-imp', name: '炎之小鬼', rarity: 'R', colors: ['red'],
    stage: 0, cost: 2, hp: 4,
    entry: { name: '火星', target: ANY, effects: [{ type: 'damage', amount: 2 }] },
    skills: [hit('抓撓', 1, CREATURE, 3), hit('火舌', 2, DIAGONAL, 7)],
  },
  {
    kind: 'creature', id: 'apprentice-scholar', name: '見習學者', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 3, hp: 6,
    entry: { name: '求知', target: NONE, effects: [{ type: 'draw', count: 1 }] },
    skills: [
      hit('冰錐', 2, ANY, 5),
      { name: '水幕', cost: 1, target: NONE, effects: [{ type: 'buff', attack: 0, hp: 2, on: 'self' }] },
    ],
  },
  {
    kind: 'creature', id: 'assault-rider', name: '突擊騎兵', rarity: 'R', colors: ['white'],
    stage: 0, cost: 4, hp: 8,
    entry: { name: '衝鋒', target: OPPOSITE, effects: [{ type: 'damage', amount: 3 }] },
    skills: [
      { name: '挑釁', cost: 1, target: NONE, effects: [{ type: 'taunt' }] },
      hit('長槍', 3, OPPOSITE, 10),
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
    stage: 0, cost: 6, hp: 16,
    skills: [
      { name: '扎根', cost: 2, target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
      hit('碾壓', 4, CREATURE, 13),
    ],
  },

  // ── UR ──
  {
    kind: 'creature', id: 'ancient-dragon', name: '遠古巨龍', rarity: 'UR', colors: ['red', 'green'],
    stage: 0, cost: 8, hp: 22,
    skills: [
      { name: '龍息', cost: 3, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 4 }] },
      hit('焚天', 6, OPPOSITE, 20),
    ],
  },

  // ── 法術 ──
  { kind: 'spell', id: 'fireball', name: '火球術', rarity: 'N', colors: ['red'], cost: 3, target: ANY, effects: [{ type: 'damage', amount: 7 }] },
  {
    kind: 'spell', id: 'devouring-flame', name: '烈焰吞噬', rarity: 'R', colors: ['red'], cost: 3,
    target: CREATURE, effects: [{ type: 'damage', amount: 8 }],
  },
  {
    kind: 'spell', id: 'annihilate', name: '湮滅', rarity: 'R', colors: ['black'], cost: 4,
    target: CREATURE, effects: [{ type: 'damage', amount: 11 }],
  },
  {
    kind: 'spell', id: 'plague', name: '瘟疫', rarity: 'R', colors: ['black'], cost: 4,
    target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 4 }],
  },
  {
    kind: 'spell', id: 'firestorm', name: '烈焰風暴', rarity: 'SR', colors: ['red'], cost: 6,
    target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 8 }],
  },
  {
    kind: 'spell', id: 'healing-light', name: '治癒之光', rarity: 'N', colors: ['white'], cost: 1,
    target: { kind: 'ally', allow: 'any' }, effects: [{ type: 'heal', amount: 4 }, { type: 'draw', count: 1 }],
  },
  // 抽牌的標準是 3 費抽 2（抽 1 張約 1.5 能量）。
  { kind: 'spell', id: 'inspiration', name: '靈感', rarity: 'R', colors: ['blue'], cost: 3, target: NONE, effects: [{ type: 'draw', count: 2 }] },
  {
    kind: 'spell', id: 'shatter', name: '裂解', rarity: 'R', colors: ['black'], cost: 2,
    target: { kind: 'enemyItemOrField' }, effects: [{ type: 'destroy' }],
  },
  {
    kind: 'spell', id: 'energy-crystal', name: '能量結晶', rarity: 'R', colors: ['green'], cost: 2,
    target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }],
  },
  // 跳費：能量上限 +1 約 2 能量，所以 4 費跳兩費，或 4 費跳一費再抽 1 張。
  {
    kind: 'spell', id: 'earth-pulse', name: '大地脈動', rarity: 'R', colors: ['green'], cost: 4,
    target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 2 }],
  },
  {
    kind: 'spell', id: 'harvest-rite', name: '豐收儀式', rarity: 'R', colors: ['green'], cost: 4,
    target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }, { type: 'draw', count: 1 }],
  },

  // ── 道具與場地 ──
  // 道具的預算：1 費 ≈ HP 上限 +4 ≈ 攻擊 +2 ≈ 減傷 1。道具會被破壞、生物倒下就一起沒了，所以給得比增益大方。
  { kind: 'item', id: 'iron-armor', name: '鐵甲', rarity: 'N', colors: ['white'], cost: 2, damageReduction: 2, hp: 3 },
  { kind: 'item', id: 'claws', name: '利爪', rarity: 'N', colors: ['red'], cost: 1, attack: 2, hp: 1 },
  // ── 無色 ──
  {
    kind: 'creature', id: 'gargoyle', name: '石像鬼', rarity: 'N', colors: [],
    stage: 0, cost: 4, hp: 10,
    skills: [hit('俯擊', 3, ANY, 7)],
  },
  { kind: 'item', id: 'travel-cloak', name: '旅人斗篷', rarity: 'N', colors: [], cost: 1, hp: 4 },

  // ── 白：守護、秩序。挑釁、回復、減傷，異常狀態是沉睡 ──
  {
    kind: 'creature', id: 'squire', name: '見習騎士', rarity: 'N', colors: ['white'],
    stage: 0, cost: 2, hp: 6,
    skills: [hit('直刺', 2, OPPOSITE, 7)],
  },
  {
    kind: 'creature', id: 'paladin', name: '聖騎士', rarity: 'R', colors: ['white'],
    stage: 1, evolvesFrom: 'squire', cost: 3, hp: 13,
    skills: [
      { name: '守護', cost: 1, target: NONE, effects: [{ type: 'taunt' }] },
      hit('聖光斬', 3, OPPOSITE, 10),
    ],
  },
  {
    kind: 'creature', id: 'seraph', name: '熾天使', rarity: 'SR', colors: ['white'],
    stage: 2, evolvesFrom: 'paladin', cost: 4, hp: 23,
    skills: [
      { name: '神聖庇護', cost: 2, target: ALLY, effects: [{ type: 'heal', amount: 6 }], instant: true },
      hit('審判之光', 5, OPPOSITE, 18),
    ],
  },
  {
    kind: 'creature', id: 'spring-nun', name: '聖泉修女', rarity: 'R', colors: ['white'],
    stage: 0, cost: 2, hp: 5,
    skills: [
      { name: '治療', cost: 1, target: ALLY, effects: [{ type: 'heal', amount: 4 }], instant: true },
      hit('聖光', 2, ANY, 4),
    ],
  },
  {
    kind: 'creature', id: 'lullaby-priest', name: '安眠祭司', rarity: 'R', colors: ['white'],
    stage: 0, cost: 3, hp: 7,
    skills: [
      { name: '安眠', cost: 2, target: CREATURE, effects: [{ type: 'sleep' }] },
      hit('杖擊', 2, ANY, 4),
    ],
  },
  {
    kind: 'spell', id: 'holy-ward', name: '聖盾術', rarity: 'R', colors: ['white'], cost: 2, instant: true,
    target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 0, hp: 3, on: 'target' }],
  },

  // ── 藍：知識、控制。抽牌、干擾對手，異常狀態是麻痺 ──
  {
    kind: 'creature', id: 'jellyfish', name: '小水母', rarity: 'N', colors: ['blue'],
    stage: 0, cost: 1, hp: 4,
    skills: [hit('電擊', 1, ANY, 2)],
  },
  {
    kind: 'creature', id: 'storm-jelly', name: '雷光水母', rarity: 'R', colors: ['blue'],
    stage: 1, evolvesFrom: 'jellyfish', cost: 2, hp: 9,
    skills: [
      hit('電流', 2, ANY, 5),
      { name: '麻痺觸手', cost: 2, target: CREATURE, effects: [{ type: 'paralyze' }] },
    ],
  },
  {
    kind: 'creature', id: 'jelly-empress', name: '深海水母皇', rarity: 'SR', colors: ['blue'],
    stage: 2, evolvesFrom: 'storm-jelly', cost: 3, hp: 17,
    skills: [
      {
        name: '麻痺電網', cost: 3, target: CREATURE,
        effects: [{ type: 'damage', amount: 3 }, { type: 'paralyze' }], instant: true,
      },
      { name: '潮汐知識', cost: 3, target: NONE, effects: [{ type: 'draw', count: 2 }] },
    ],
  },
  {
    kind: 'creature', id: 'mind-thief', name: '心靈竊賊', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 3, hp: 8,
    skills: [
      {
        name: '竊讀', cost: 3, target: NONE,
        effects: [{ type: 'draw', count: 1 }, { type: 'opponentDiscardRandom', count: 1 }],
      },
      hit('念力', 2, ANY, 5),
    ],
  },
  {
    kind: 'creature', id: 'sea-serpent', name: '海龍', rarity: 'SR', colors: ['blue'],
    stage: 0, cost: 6, hp: 15,
    skills: [
      hit('潮湧', 4, DIAGONAL, 15),
      { name: '深海呼喚', cost: 3, target: NONE, effects: [{ type: 'draw', count: 2 }] },
    ],
  },
  { kind: 'spell', id: 'ice-shard', name: '冰錐', rarity: 'N', colors: ['blue'], cost: 2, instant: true, target: ANY, effects: [{ type: 'damage', amount: 4 }] },
  {
    kind: 'spell', id: 'glacial-bind', name: '冰封', rarity: 'R', colors: ['blue'], cost: 2, instant: true,
    target: CREATURE, effects: [{ type: 'paralyze' }],
  },

  // ── 黑：侵蝕、犧牲。破壞卡牌、讓對手棄牌、HP 減半，異常狀態是中毒 ──
  {
    kind: 'creature', id: 'skeleton', name: '骷髏兵', rarity: 'N', colors: ['black'],
    stage: 0, cost: 2, hp: 6,
    skills: [hit('骨刃', 2, CREATURE, 6)],
  },
  {
    kind: 'creature', id: 'skeleton-knight', name: '骷髏騎士', rarity: 'R', colors: ['black'],
    stage: 1, evolvesFrom: 'skeleton', cost: 3, hp: 13,
    skills: [
      hit('骨矛', 3, CREATURE, 9),
      { name: '碎骨', cost: 1, target: { kind: 'enemyItemOrField' }, effects: [{ type: 'destroy' }] },
    ],
  },
  {
    kind: 'creature', id: 'death-knight', name: '死亡騎士', rarity: 'SR', colors: ['black'],
    stage: 2, evolvesFrom: 'skeleton-knight', cost: 4, hp: 22,
    skills: [
      { name: '凋零', cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }] },
      hit('冥刃', 5, CREATURE, 16),
    ],
  },
  {
    kind: 'creature', id: 'venom-spider', name: '毒蛛', rarity: 'R', colors: ['black'],
    stage: 0, cost: 2, hp: 5,
    skills: [
      { name: '劇毒', cost: 2, target: CREATURE, effects: [{ type: 'poison', amount: 3 }] },
      hit('咬', 1, CREATURE, 3),
    ],
  },
  {
    kind: 'spell', id: 'death-touch', name: '死亡之觸', rarity: 'R', colors: ['black'], cost: 4, instant: true,
    target: CREATURE, effects: [{ type: 'halveHp' }],
  },

  // ── 紅：速度、爆發。直接傷害、只打英雄、範圍傷害、速攻，異常狀態是灼燒 ──
  {
    // 速攻是它的機制，HP 比基準少 2 來換。
    kind: 'creature', id: 'arsonist', name: '縱火狂', rarity: 'R', colors: ['red'],
    stage: 0, cost: 3, hp: 6, keywords: ['haste'],
    skills: [
      { name: '點燃', cost: 2, target: CREATURE, effects: [{ type: 'burn', amount: 3 }] },
      hit('火舌', 2, ANY, 5),
    ],
  },
  { kind: 'spell', id: 'scorching-ray', name: '灼熱射線', rarity: 'N', colors: ['red'], cost: 2, instant: true, target: HERO, effects: [{ type: 'damage', amount: 5 }] },

  // ── 綠：成長、巨大。大型生物、提高能量上限、高 HP ──
  {
    // 綠色的高 HP：比基準多 2，傷害少 1。用位置打：正對面空著就撞到英雄。
    kind: 'creature', id: 'forest-stag', name: '林鹿', rarity: 'N', colors: ['green'],
    stage: 0, cost: 2, hp: 8,
    skills: [hit('衝撞', 2, OPPOSITE, 6)],
  },
  {
    kind: 'creature', id: 'moss-lizard', name: '苔甲巨蜥', rarity: 'N', colors: ['green'],
    stage: 0, cost: 5, hp: 14,
    skills: [hit('甩尾', 4, DIAGONAL, 13)],
  },
  {
    kind: 'creature', id: 'grove-druid', name: '林語德魯伊', rarity: 'R', colors: ['green'],
    stage: 0, cost: 3, hp: 8,
    skills: [
      { name: '催生', cost: 2, target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 2, hp: 2, on: 'target' }] },
      hit('藤鞭', 2, ANY, 5),
    ],
  },
  {
    kind: 'creature', id: 'elder-treant', name: '萬年樹人', rarity: 'SR', colors: ['green'],
    stage: 0, cost: 7, hp: 18,
    skills: [
      hit('巨根', 4, OPPOSITE, 15),
      { name: '年輪', cost: 2, target: NONE, effects: [{ type: 'buff', attack: 0, hp: 4, on: 'self' }] },
    ],
  },
  {
    kind: 'spell', id: 'giant-growth', name: '巨化術', rarity: 'R', colors: ['green'], cost: 3, instant: true,
    target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 2, hp: 3, on: 'target' }],
  },

  // ── 異常狀態的新卡：進場施加狀態、對手每隻生物都中的法術、瞬發 ──
  // 進場效果照數值基準從本體扣（每 1 能量約少 2 HP）；對手每隻生物都中的狀態約是單體的 1.5 倍能量。
  {
    kind: 'creature', id: 'plague-rat', name: '瘟疫鼠', rarity: 'R', colors: ['black'],
    stage: 0, cost: 2, hp: 4,
    entry: { name: '病菌', target: CREATURE, effects: [{ type: 'poison', amount: 1 }] },
    skills: [
      hit('啃咬', 1, CREATURE, 3),
      { name: '散播', cost: 3, target: NONE, effects: [{ type: 'poison', amount: 1, all: true }] },
    ],
  },
  {
    kind: 'spell', id: 'toxic-fog', name: '毒霧', rarity: 'R', colors: ['black'], cost: 3,
    target: NONE, effects: [{ type: 'poison', amount: 2, all: true }],
  },
  {
    kind: 'spell', id: 'venom-dart', name: '腐毒箭', rarity: 'N', colors: ['black'], cost: 2, instant: true,
    target: CREATURE, effects: [{ type: 'damage', amount: 1 }, { type: 'poison', amount: 1 }],
  },
  { kind: 'item', id: 'bone-armor', name: '骨甲', rarity: 'N', colors: ['black'], cost: 1, attack: 1, hp: 2 },
  {
    kind: 'creature', id: 'blast-mage', name: '炎爆術士', rarity: 'R', colors: ['red'],
    stage: 0, cost: 2, hp: 4,
    entry: { name: '引燃', target: CREATURE, effects: [{ type: 'burn', amount: 1 }] },
    skills: [hit('火苗', 1, ANY, 2), hit('爆燃', 2, CREATURE, 6)],
  },
  {
    kind: 'spell', id: 'wildfire', name: '焚野', rarity: 'R', colors: ['red'], cost: 3,
    target: NONE, effects: [{ type: 'burn', amount: 2, all: true }],
  },
  {
    kind: 'creature', id: 'shock-eel', name: '電鰻', rarity: 'R', colors: ['blue'],
    stage: 0, cost: 3, hp: 4,
    entry: { name: '電擊', target: CREATURE, effects: [{ type: 'paralyze' }] },
    skills: [hit('放電', 2, ANY, 5), hit('纏繞', 1, CREATURE, 3)],
  },
  {
    kind: 'spell', id: 'thunderstorm', name: '雷暴', rarity: 'SR', colors: ['blue'], cost: 5,
    target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }, { type: 'paralyze', all: true }],
  },
  {
    kind: 'spell', id: 'counter-current', name: '反制電流', rarity: 'R', colors: ['blue'], cost: 3, instant: true,
    target: CREATURE, effects: [{ type: 'damage', amount: 2 }, { type: 'paralyze' }],
  },
  {
    kind: 'creature', id: 'dream-herald', name: '夢境使者', rarity: 'R', colors: ['white'],
    stage: 0, cost: 3, hp: 4,
    entry: { name: '入夢', target: CREATURE, effects: [{ type: 'sleep' }] },
    skills: [hit('夢擊', 2, ANY, 4), { name: '催眠', cost: 3, target: CREATURE, effects: [{ type: 'sleep' }] }],
  },
  {
    kind: 'spell', id: 'lullaby-light', name: '催眠之光', rarity: 'R', colors: ['white'], cost: 3,
    target: NONE, effects: [{ type: 'sleep', all: true }],
  },
  {
    // 綠色的高 HP：比基準多 2；進場增益約 1 能量，少 2。
    kind: 'creature', id: 'sapling-guard', name: '樹苗守衛', rarity: 'R', colors: ['green'],
    stage: 0, cost: 2, hp: 6,
    entry: { name: '萌芽', target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 1, hp: 1, on: 'target' }] },
    skills: [
      hit('藤鞭', 2, ANY, 4),
      { name: '扎根', cost: 2, target: NONE, effects: [{ type: 'buff', attack: 0, hp: 3, on: 'self' }] },
    ],
  },
  { kind: 'item', id: 'bark-armor', name: '樹皮護甲', rarity: 'N', colors: ['green'], cost: 2, hp: 6, damageReduction: 1 },

  // ── 高費（9–12）：每個顏色 2 張、無色 2 張 ──
  // 9 費以上的生物一張佔一格、一回合只能發一個技能，比兩隻便宜的生物吃虧，
  // 所以進場效果給得大方：每 1 能量的效果只扣 1 HP（一般是 2）。HP 照 2 + 2 × 費用：9 費 20、12 費 26。
  {
    kind: 'creature', id: 'siege-colossus', name: '攻城巨像', rarity: 'R', colors: [],
    stage: 0, cost: 9, hp: 20,
    skills: [
      hit('攻城錘', 4, OPPOSITE, 14),
      { name: '踐踏', cost: 5, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 5 }] },
    ],
  },
  {
    kind: 'creature', id: 'kraken', name: '深海巨妖', rarity: 'SR', colors: ['blue'],
    stage: 0, cost: 9, hp: 19,
    entry: { name: '萬觸纏身', target: NONE, effects: [{ type: 'paralyze', all: true }] },
    skills: [
      { name: '纏繞', cost: 4, target: CREATURE, effects: [{ type: 'damage', amount: 9 }, { type: 'paralyze' }] },
      hit('巨浪', 5, DIAGONAL, 17),
    ],
  },
  {
    kind: 'creature', id: 'lord-of-decay', name: '腐朽之王', rarity: 'SR', colors: ['black'],
    stage: 0, cost: 9, hp: 19,
    entry: { name: '腐朽之息', target: NONE, effects: [{ type: 'poison', amount: 2, all: true }] },
    skills: [
      { name: '凋零之觸', cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }] },
      hit('靈魂收割', 5, HERO, 13),
    ],
  },
  {
    kind: 'spell', id: 'meteor', name: '隕石術', rarity: 'SR', colors: ['red'], cost: 9,
    target: ANY, effects: [{ type: 'damage', amount: 18 }, { type: 'damageEnemyCreatures', amount: 2 }],
  },
  {
    kind: 'creature', id: 'archangel', name: '天使長', rarity: 'UR', colors: ['white'],
    stage: 0, cost: 10, hp: 24,
    entry: { name: '聖光降臨', target: ALLY, effects: [{ type: 'heal', amount: 8 }] },
    skills: [
      { name: '天使之翼', cost: 3, target: ALLY, effects: [{ type: 'heal', amount: 8 }], instant: true },
      hit('裁決之劍', 5, ANY, 12),
    ],
  },
  {
    kind: 'creature', id: 'mountain-giant', name: '山嶺巨人', rarity: 'SR', colors: ['green'],
    stage: 0, cost: 10, hp: 26,
    entry: { name: '大地之息', target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
    skills: [
      hit('巨石投擲', 4, ANY, 9),
      { name: '山崩', cost: 6, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 6 }] },
    ],
  },
  // 範圍 6 ≈ 5 能量、全體麻痺 ≈ 3、抽 2 ≈ 3，合計 11 ≈ SR 的 10 費。
  {
    kind: 'spell', id: 'tsunami', name: '大海嘯', rarity: 'SR', colors: ['blue'], cost: 10,
    target: NONE,
    effects: [{ type: 'damageEnemyCreatures', amount: 6 }, { type: 'paralyze', all: true }, { type: 'draw', count: 2 }],
  },
  // 全體 HP 減半 ≈ 單體的 1.5 倍（4.5 能量），再各受 3 ≈ 3.5 能量，棄 1 張 ≈ 2 能量。
  // 先減半再打，才清得掉場面；只有減半的話一隻都打不死，模擬裡勝率只有 43%。
  {
    kind: 'spell', id: 'withering', name: '萬物凋零', rarity: 'SR', colors: ['black'], cost: 10,
    target: NONE,
    effects: [{ type: 'halveHp', all: true }, { type: 'damageEnemyCreatures', amount: 3 }, { type: 'opponentDiscardRandom', count: 1 }],
  },
  {
    kind: 'creature', id: 'inferno-demon', name: '炎魔', rarity: 'UR', colors: ['red'],
    stage: 0, cost: 11, hp: 23,
    entry: {
      name: '煉獄降臨', target: HERO,
      effects: [{ type: 'damage', amount: 5 }, { type: 'damageEnemyCreatures', amount: 4 }],
    },
    skills: [hit('爆炎', 4, DIAGONAL, 14), hit('末日烈焰', 6, HERO, 16)],
  },
  {
    kind: 'creature', id: 'titan-of-light', name: '光之巨神', rarity: 'SR', colors: ['white'],
    stage: 0, cost: 11, hp: 23,
    entry: { name: '神聖光輝', target: NONE, effects: [{ type: 'sleep', all: true }] },
    skills: [
      { name: '聖盾', cost: 2, target: NONE, effects: [{ type: 'taunt' }, { type: 'buff', attack: 0, hp: 2, on: 'self' }] },
      hit('光之審判', 6, OPPOSITE, 20),
    ],
  },
  {
    kind: 'creature', id: 'earth-titan', name: '大地泰坦', rarity: 'UR', colors: ['green'],
    stage: 0, cost: 12, hp: 31,
    entry: { name: '震地', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] },
    skills: [
      hit('泰坦之拳', 5, CREATURE, 15),
      { name: '地裂', cost: 6, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 6 }] },
    ],
  },
  {
    kind: 'creature', id: 'astral-dragon', name: '星界巨龍', rarity: 'SR', colors: [],
    stage: 0, cost: 12, hp: 25,
    entry: { name: '星辰啟示', target: NONE, effects: [{ type: 'draw', count: 2 }] },
    skills: [
      { name: '星光吐息', cost: 5, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 5 }] },
      hit('星隕', 6, ANY, 15),
    ],
  },

  // ── 英雄進化：每局限一次，費用約 5–7 ──
  // 像爐石的英雄卡：打出時有進場效果（戰吼），天生技變強或多一個被動。
  {
    kind: 'heroEvolution', id: 'flame-sovereign', name: '烈焰君王', rarity: 'SR', colors: ['red'],
    cost: 6, evolvesFrom: 'flame-lord', hpBonus: 6,
    entry: { name: '焚城', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] },
    power: hit('煉獄', 2, ANY, 4),
  },
  {
    kind: 'heroEvolution', id: 'world-tree-king', name: '萬木之王', rarity: 'SR', colors: ['green'],
    cost: 5, evolvesFrom: 'forest-king', hpBonus: 8,
    entry: { name: '萬木回春', target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
    passive: { name: '萬木', creatures: { hp: 1 } },
  },
  {
    kind: 'heroEvolution', id: 'sword-saint', name: '無名劍聖', rarity: 'SR', colors: ['white'],
    cost: 6, evolvesFrom: 'nameless-swordsman', hpBonus: 7,
    entry: { name: '劍陣', target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 2, hp: 2, on: 'target' }] },
    power: {
      name: '劍意', cost: 2, target: { kind: 'ally', allow: 'creature' },
      effects: [{ type: 'buff', attack: 2, hp: 0, on: 'target' }],
    },
  },
  {
    kind: 'heroEvolution', id: 'tide-shadow-sovereign', name: '潮影君主', rarity: 'SR', colors: ['blue', 'black'],
    cost: 6, evolvesFrom: 'tide-shadow-twins', hpBonus: 6,
    entry: { name: '潮汐吞噬', target: NONE, effects: [{ type: 'opponentDiscardRandom', count: 2 }] },
    power: {
      name: '深淵低語', cost: 2, target: NONE,
      effects: [{ type: 'opponentDiscardRandom', count: 1 }, { type: 'draw', count: 1 }],
    },
  },

  { kind: 'field', id: 'guardian-shrine', name: '守護聖壇', rarity: 'SR', colors: [], cost: 3, creatures: { hp: 2 } },
];

export const sampleDb = () => buildCardDb(SAMPLE_CARDS, SAMPLE_HEROES);

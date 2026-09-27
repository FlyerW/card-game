import type { Ability, DeckCardDef, HeroDef, TargetSpec } from '../types';

// 第二彈「龍脈覺醒」（還沒發布）：100 張卡、5 個新的雙色英雄。
// 主題是龍：每個顏色都有龍，加上「召喚龍時」「每有另一隻龍」的卡。
// 新關鍵字 **覺醒**：能量上限 8 以上時，進場效果與法術多發動一段——前期是普通的卡，後期變強，
// 所以覺醒的卡大多在 7 費以下（8 費以上打得出來時通常已經覺醒了，沒有差別）。
// 第二批（第 29–100 張）補齊每個顏色 16 張、無色 10 張，加上 5 個新雙色英雄與他們的英雄進化、雙色卡。
// 生物的技能數照稀有度：N／R／SR／UR 各 1／2／3／4 個（進場、遺言、持續效果、同族加成都算一個），
// 每多一個技能，身材比基準少約 1 點。

const ANY: TargetSpec = { kind: 'enemy', allow: 'any' };
const CREATURE: TargetSpec = { kind: 'enemy', allow: 'creature' };
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

/**
 * 新的雙色英雄（UR，卡包抽到）：白藍、白黑、藍紅、黑綠、紅綠，每個顏色各出現兩次。
 * 已經有的雙色是白綠、藍黑、白紅；剩下的黑紅、藍綠之後再出。
 */
const HEROES: HeroDef[] = [
  {
    kind: 'hero', id: 'sky-envoy', name: '天穹龍使', rarity: 'UR', colors: ['white', 'blue'], hp: 40,
    power: { name: '聖諭', cost: 3, target: NONE, effects: [{ type: 'draw', count: 1 }, { type: 'healHero', amount: 2 }] },
  },
  {
    kind: 'hero', id: 'dusk-judge', name: '晨昏審判者', rarity: 'UR', colors: ['white', 'black'], hp: 38,
    power: { name: '汲魂', cost: 3, target: CREATURE, effects: [{ type: 'damage', amount: 2 }, { type: 'healHero', amount: 2 }] },
  },
  {
    kind: 'hero', id: 'storm-sorcerer', name: '雷焰術士', rarity: 'UR', colors: ['blue', 'red'], hp: 38,
    power: { name: '雷擊', cost: 3, target: CREATURE, effects: [{ type: 'damage', amount: 2 }, { type: 'paralyze' }] },
  },
  {
    kind: 'hero', id: 'bog-queen', name: '腐沼巫后', rarity: 'UR', colors: ['black', 'green'], hp: 40,
    power: { name: '腐根', cost: 2, target: CREATURE, effects: [{ type: 'poison', amount: 2 }] },
  },
  {
    kind: 'hero', id: 'wyrm-lord', name: '龍脈之主', rarity: 'UR', colors: ['red', 'green'], hp: 40,
    power: { name: '喚龍', cost: 5, target: NONE, effects: [{ type: 'summonToken', token: 'wyrm-token', count: 1 }] },
  },
];

const CARDS: DeckCardDef[] = [
  // 白：回復、增益
  {
    kind: 'creature', id: 'white-wyrmling', name: '白龍幼崽', rarity: 'N', colors: ['white'], race: 'dragon', stage: 0, cost: 2, attack: 2, hp: 2, skills: [],
    entry: { name: '龍息', target: NONE, effects: [{ type: 'healHero', amount: 2 }] },
  },
  {
    kind: 'creature', id: 'dragon-knight', name: '聖光龍騎士', rarity: 'R', colors: ['white'], race: 'human',
    stage: 0, cost: 4, attack: 3, hp: 3, skills: [],
    triggers: [{ when: 'allySummoned', race: 'dragon', name: '龍誓', effects: [{ type: 'healHero', amount: 3 }] }],
    entry: { name: '聖光', target: NONE, effects: [{ type: 'healHero', amount: 2 }] },
  },
  {
    kind: 'creature', id: 'dawn-dragon', name: '晨曦巨龍', rarity: 'SR', colors: ['white'], race: 'dragon',
    stage: 0, cost: 7, attack: 5, hp: 6,
    entry: { name: '聖息', target: NONE, effects: [{ type: 'healHero', amount: 3 }], awaken: [{ type: 'buff', attack: 1, hp: 1, on: 'all' }] },
    skills: [{ name: '光鱗', cost: 3, target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 1, hp: 1, on: 'target' }] }],
    triggers: [{ when: 'allySummoned', race: 'dragon', name: '晨曦', effects: [{ type: 'healHero', amount: 2 }] }],
  },
  {
    kind: 'spell', id: 'dragon-blessing', name: '龍之祝福', rarity: 'R', colors: ['white'], cost: 2,
    target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 1, hp: 2, on: 'target' }], awaken: [{ type: 'draw', count: 1 }],
  },
  { kind: 'item', id: 'dragonscale-shield', name: '龍鱗盾', rarity: 'N', colors: ['white'], cost: 2, hp: 2, damageReduction: 1 },
  // 藍：抽牌、麻痺
  {
    kind: 'creature', id: 'mist-wyrmling', name: '霧海幼龍', rarity: 'N', colors: ['blue'], race: 'dragon',
    stage: 0, cost: 3, attack: 3, hp: 4, skills: [], entry: { name: '霧息', target: NONE, effects: [{ type: 'draw', count: 1 }] },
  },
  {
    kind: 'creature', id: 'dragon-speaker', name: '龍語者', rarity: 'R', colors: ['blue'], race: 'human',
    stage: 0, cost: 3, attack: 2, hp: 3, skills: [],
    triggers: [{ when: 'allySummoned', race: 'dragon', name: '龍語', effects: [{ type: 'draw', count: 1 }] }],
    death: { name: '龍語遺書', effects: [{ type: 'draw', count: 1 }] },
  },
  {
    kind: 'creature', id: 'abyssal-elder-dragon', name: '深淵古龍', rarity: 'SR', colors: ['blue'], race: 'dragon',
    stage: 0, cost: 6, attack: 5, hp: 6,
    entry: { name: '冰息', target: NONE, effects: [{ type: 'draw', count: 1 }], awaken: [{ type: 'paralyze', all: true }] },
    skills: [hit('冰槍', 2, CREATURE, 4)],
    death: { name: '深淵回響', effects: [{ type: 'draw', count: 2 }] },
  },
  {
    kind: 'spell', id: 'dragon-lore', name: '龍脈學識', rarity: 'R', colors: ['blue'], cost: 2,
    target: NONE, effects: [{ type: 'draw', count: 2 }], awaken: [{ type: 'draw', count: 1 }],
  },
  // 黑：消滅、遺言
  {
    kind: 'creature', id: 'bone-dragon', name: '骸骨龍', rarity: 'R', colors: ['black'], race: 'dragon',
    stage: 0, cost: 5, attack: 4, hp: 5,
    skills: [{ name: '腐息', cost: 2, target: CREATURE, effects: [{ type: 'poison', amount: 2 }] }],
    death: { name: '骸骨重生', effects: [{ type: 'summonToken', token: 'skeleton-token', count: 1 }] },
  },
  {
    kind: 'creature', id: 'dragon-cultist', name: '冥龍信徒', rarity: 'R', colors: ['black'], race: 'human',
    stage: 0, cost: 3, attack: 2, hp: 3, skills: [],
    triggers: [{ when: 'allySummoned', race: 'dragon', name: '獻身', effects: [{ type: 'buff', attack: 2, hp: 2, on: 'self' }] }],
    death: { name: '獻祭', effects: [{ type: 'poison', amount: 1, all: true }] },
  },
  {
    kind: 'creature', id: 'shadow-dragon-queen', name: '暗影龍后', rarity: 'UR', colors: ['black'], race: 'dragon',
    stage: 0, cost: 9, attack: 8, hp: 10,
    entry: { name: '吞噬', target: CREATURE, effects: [{ type: 'destroyCreature' }] },
    skills: [
      { name: '龍威', cost: 5, target: NONE, effects: [{ type: 'halveHp', all: true }] },
      hit('暗焰', 3, ANY, 4),
    ],
    death: { name: '暗影消散', effects: [{ type: 'poison', amount: 2, all: true }] },
  },
  {
    kind: 'spell', id: 'blood-pact', name: '龍血契約', rarity: 'R', colors: ['black'], cost: 5,
    target: CREATURE, effects: [{ type: 'destroyCreature' }], awaken: [{ type: 'draw', count: 1 }],
  },
  { kind: 'item', id: 'fallen-dragon-fang', name: '墮龍之牙', rarity: 'N', colors: ['black'], cost: 2, attack: 3 },
  // 紅：速攻、傷害
  {
    kind: 'creature', id: 'fire-wyrmling', name: '火龍幼崽', rarity: 'N', colors: ['red'], race: 'dragon', stage: 0, cost: 1, attack: 1, hp: 1, skills: [],
    death: { name: '火花', effects: [{ type: 'damageEnemyCreatures', amount: 1 }] },
  },
  {
    kind: 'creature', id: 'flame-wyvern', name: '烈焰飛龍', rarity: 'R', colors: ['red'], race: 'dragon',
    stage: 0, cost: 4, attack: 3, hp: 3, keywords: ['haste'], skills: [hit('火息', 2, DIAGONAL, 4)],
    death: { name: '墜焰', effects: [{ type: 'damageEnemyCreatures', amount: 1 }] },
  },
  {
    kind: 'creature', id: 'dragon-rider', name: '龍騎士長', rarity: 'SR', colors: ['red'], race: 'human',
    stage: 0, cost: 5, attack: 3, hp: 5, skills: [hit('龍槍', 2, CREATURE, 3)], kin: { race: 'dragon', attack: 2 },
    entry: { name: '衝鋒號令', target: NONE, effects: [{ type: 'buff', attack: 1, hp: 0, on: 'all' }] },
  },
  {
    kind: 'creature', id: 'magma-dragon', name: '熔岩巨龍', rarity: 'UR', colors: ['red'], race: 'dragon',
    stage: 0, cost: 10, attack: 10, hp: 11,
    entry: { name: '熔岩吐息', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] },
    skills: [hit('龍怒', 4, ANY, 5), { name: '焚天', cost: 4, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] }],
    death: { name: '熔岩爆裂', effects: [{ type: 'damageEnemyCreatures', amount: 3 }] },
  },
  {
    kind: 'spell', id: 'dragonfire-burst', name: '龍焰爆發', rarity: 'R', colors: ['red'], cost: 3,
    target: ANY, effects: [{ type: 'damage', amount: 4 }], awaken: [{ type: 'damage', amount: 2 }],
  },
  { kind: 'item', id: 'dragon-claw', name: '龍鱗爪', rarity: 'N', colors: ['red'], cost: 1, attack: 2 },
  // 綠：加能量上限、大體型
  {
    kind: 'creature', id: 'grove-wyrmling', name: '翠林幼龍', rarity: 'N', colors: ['green'], race: 'dragon', stage: 0, cost: 3, attack: 3, hp: 3, skills: [],
    death: { name: '歸林', effects: [{ type: 'healHero', amount: 3 }] },
  },
  {
    kind: 'creature', id: 'ancient-wood-dragon', name: '古木龍', rarity: 'SR', colors: ['green'], race: 'dragon',
    stage: 0, cost: 6, attack: 4, hp: 6, skills: [{ name: '森息', cost: 3, target: NONE, effects: [{ type: 'healAll', amount: 3 }] }],
    entry: { name: '古木之息', target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
    death: { name: '歸根', effects: [{ type: 'summonToken', token: 'wyrm-token', count: 1 }] },
  },
  {
    kind: 'creature', id: 'nest-warden', name: '龍巢守護者', rarity: 'R', colors: ['green'], race: 'plant',
    stage: 0, cost: 5, attack: 3, hp: 5, skills: [],
    triggers: [{ when: 'allySummoned', race: 'dragon', name: '育龍', effects: [{ type: 'gainMaxEnergy', amount: 1 }] }],
    entry: { name: '護巢', target: NONE, effects: [{ type: 'healHero', amount: 3 }] },
  },
  {
    kind: 'spell', id: 'awakening-seed', name: '覺醒之種', rarity: 'R', colors: ['green'], cost: 2,
    target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }], awaken: [{ type: 'draw', count: 1 }],
  },
  {
    kind: 'creature', id: 'dragon-egg', name: '巨龍之卵', rarity: 'N', colors: ['green'], race: 'dragon',
    stage: 0, cost: 2, attack: 0, hp: 4, skills: [], death: { name: '破殼', effects: [{ type: 'summonToken', token: 'wyrm-token', count: 1 }] },
  },
  // 無色
  {
    kind: 'creature', id: 'dragon-hunter', name: '流浪龍獵人', rarity: 'R', colors: [], race: 'human',
    stage: 0, cost: 3, attack: 2, hp: 2, skills: [hit('屠龍', 2, CREATURE, 4)],
    entry: { name: '設陷', target: CREATURE, effects: [{ type: 'weaken' }] },
  },
  {
    kind: 'spell', id: 'dragon-scroll', name: '龍語卷軸', rarity: 'N', colors: [], cost: 2,
    target: NONE, effects: [{ type: 'draw', count: 1 }], awaken: [{ type: 'draw', count: 1 }],
  },
  {
    kind: 'creature', id: 'dragon-guardian', name: '龍蛋守衛', rarity: 'N', colors: [], race: 'dragon', stage: 0, cost: 5, attack: 4, hp: 4, skills: [],
    entry: { name: '守護', target: NONE, effects: [{ type: 'taunt' }] },
  },
  // 巨龍之卵的遺言召喚的
  { kind: 'creature', id: 'wyrm-token', name: '幼龍', rarity: 'N', colors: ['green'], race: 'dragon', stage: 0, cost: 0, attack: 3, hp: 3, skills: [], token: true },

  // ── 第二批：擴充到 100 張 ──────────────────────────────────────────────────────
  // 白：回復、增益、守護
  {
    kind: 'creature', id: 'chapel-novice', name: '聖堂見習生', rarity: 'N', colors: ['white'], race: 'human', stage: 0, cost: 1, attack: 1, hp: 2, skills: [],
    death: { name: '祈禱', effects: [{ type: 'healHero', amount: 2 }] },
  },
  {
    kind: 'creature', id: 'silverscale-guard', name: '銀鱗守衛', rarity: 'N', colors: ['white'], race: 'dragon', stage: 0, cost: 3, attack: 2, hp: 4, skills: [],
    entry: { name: '銀鱗', target: NONE, effects: [{ type: 'taunt' }] },
  },
  {
    kind: 'creature', id: 'dawn-egg', name: '晨光之卵', rarity: 'N', colors: ['white'], race: 'dragon',
    stage: 0, cost: 2, attack: 0, hp: 4, skills: [],
    death: { name: '孵化', effects: [{ type: 'summonToken', token: 'whelp-token', count: 1 }, { type: 'healHero', amount: 2 }] },
  },
  {
    kind: 'creature', id: 'lightwing-drake', name: '光翼龍', rarity: 'N', colors: ['white'], race: 'dragon',
    stage: 0, cost: 3, attack: 3, hp: 3, skills: [], entry: { name: '光息', target: NONE, effects: [{ type: 'healHero', amount: 3 }] },
  },
  {
    kind: 'creature', id: 'oathsworn-knight', name: '龍誓騎士', rarity: 'R', colors: ['white'], race: 'human',
    stage: 0, cost: 5, attack: 4, hp: 6, skills: [{ name: '聖盾', cost: 2, target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 0, hp: 3, on: 'target' }] }],
    entry: { name: '誓約', target: NONE, effects: [{ type: 'taunt' }] },
  },
  {
    kind: 'creature', id: 'radiant-apostle', name: '光輝使徒', rarity: 'R', colors: ['white'], race: 'angel',
    stage: 0, cost: 2, attack: 1, hp: 2, skills: [{ name: '祝福', cost: 1, target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 1, hp: 0, on: 'target' }] }],
    death: { name: '光之遺願', effects: [{ type: 'healHero', amount: 3 }] },
  },
  {
    kind: 'spell', id: 'dawn-hymn', name: '晨光聖歌', rarity: 'R', colors: ['white'], cost: 3,
    target: NONE, effects: [{ type: 'healAll', amount: 3 }], awaken: [{ type: 'buff', attack: 1, hp: 1, on: 'all' }],
  },
  { kind: 'item', id: 'holy-dragon-mail', name: '聖龍鎧甲', rarity: 'R', colors: ['white'], cost: 3, hp: 4, damageReduction: 1 },
  {
    kind: 'creature', id: 'white-dragon-maiden', name: '白龍聖女', rarity: 'SR', colors: ['white'], race: 'human',
    stage: 0, cost: 4, attack: 2, hp: 6, skills: [{ name: '聖光', cost: 2, target: ALLY, effects: [{ type: 'heal', amount: 4 }] }],
    triggers: [{ when: 'allySummoned', race: 'dragon', name: '龍之祈願', effects: [{ type: 'healAll', amount: 2 }] }],
    entry: { name: '祝禱', target: NONE, effects: [{ type: 'healAll', amount: 2 }] },
  },
  {
    kind: 'spell', id: 'judgement-light', name: '審判之光', rarity: 'SR', colors: ['white'], cost: 5,
    target: CREATURE, effects: [{ type: 'damage', amount: 7 }], awaken: [{ type: 'healHero', amount: 4 }],
  },
  {
    kind: 'creature', id: 'sky-sacred-dragon', name: '天穹聖龍', rarity: 'UR', colors: ['white'], race: 'dragon',
    stage: 0, cost: 8, attack: 8, hp: 9,
    skills: [hit('聖炎', 3, ANY, 4), { name: '天穹守護', cost: 3, target: NONE, effects: [{ type: 'buff', attack: 0, hp: 2, on: 'all' }] }],
    entry: { name: '聖光降臨', target: NONE, effects: [{ type: 'healAll', amount: 3 }] },
    triggers: [{ when: 'turnEnd', name: '天穹庇佑', effects: [{ type: 'healHero', amount: 2 }] }],
  },
  // 藍：抽牌、麻痺
  {
    kind: 'creature', id: 'tide-hatchling', name: '潮汐雛龍', rarity: 'N', colors: ['blue'], race: 'dragon', stage: 0, cost: 1, attack: 1, hp: 1, skills: [],
    death: { name: '退潮', effects: [{ type: 'draw', count: 1 }] },
  },
  {
    kind: 'creature', id: 'mist-adept', name: '霧隱術士', rarity: 'N', colors: ['blue'], race: 'human', stage: 0, cost: 2, attack: 2, hp: 2, skills: [],
    entry: { name: '霧隱', target: CREATURE, effects: [{ type: 'weaken' }] },
  },
  {
    kind: 'creature', id: 'ice-crystal-dragon', name: '冰晶龍', rarity: 'N', colors: ['blue'], race: 'dragon', stage: 0, cost: 4, attack: 3, hp: 4, skills: [],
    entry: { name: '冰晶', target: CREATURE, effects: [{ type: 'paralyze' }] },
  },
  { kind: 'spell', id: 'mist-snare', name: '霧中陷阱', rarity: 'N', colors: ['blue'], cost: 1, target: CREATURE, effects: [{ type: 'weaken' }] },
  {
    kind: 'spell', id: 'frost-breath', name: '冰霜吐息', rarity: 'N', colors: ['blue'], cost: 2,
    target: CREATURE, effects: [{ type: 'damage', amount: 2 }, { type: 'paralyze' }],
  },
  {
    kind: 'creature', id: 'sky-scholar', name: '蒼穹學者', rarity: 'R', colors: ['blue'], race: 'human',
    stage: 0, cost: 2, attack: 1, hp: 3, skills: [{ name: '研讀', cost: 2, target: NONE, effects: [{ type: 'draw', count: 1 }] }],
    death: { name: '遺稿', effects: [{ type: 'draw', count: 1 }] },
  },
  {
    kind: 'creature', id: 'tide-dragoon', name: '潮汐龍騎', rarity: 'R', colors: ['blue'], race: 'human',
    stage: 0, cost: 4, attack: 3, hp: 4, skills: [{ name: '潮擊', cost: 2, target: CREATURE, effects: [{ type: 'paralyze' }] }],
    kin: { race: 'dragon', attack: 1 },
  },
  {
    kind: 'creature', id: 'crystal-dragon-idol', name: '水晶龍像', rarity: 'R', colors: ['blue'], race: 'machine',
    stage: 0, cost: 5, attack: 3, hp: 4, skills: [],
    triggers: [{ when: 'turnEnd', name: '冥想', effects: [{ type: 'draw', count: 1 }] }],
    entry: { name: '水晶之光', target: CREATURE, effects: [{ type: 'paralyze' }] },
  },
  {
    kind: 'spell', id: 'dragon-eye', name: '龍眼預知', rarity: 'R', colors: ['blue'], cost: 3,
    target: NONE, effects: [{ type: 'lookPick', look: 3, pick: 1 }, { type: 'draw', count: 1 }],
  },
  {
    kind: 'creature', id: 'abyss-dragon-queen', name: '深海龍后', rarity: 'SR', colors: ['blue'], race: 'dragon',
    stage: 0, cost: 7, attack: 6, hp: 8, skills: [{ name: '深海呼喚', cost: 2, target: NONE, effects: [{ type: 'draw', count: 1 }] }],
    entry: { name: '深海漩渦', target: CREATURE, effects: [{ type: 'paralyze' }] },
    death: { name: '沉眠', effects: [{ type: 'draw', count: 1 }] },
  },
  {
    kind: 'spell', id: 'frozen-breath', name: '冰封之息', rarity: 'SR', colors: ['blue'], cost: 5,
    target: NONE, effects: [{ type: 'paralyze', all: true }], awaken: [{ type: 'draw', count: 2 }],
  },
  {
    kind: 'creature', id: 'void-dragon', name: '虛空龍', rarity: 'UR', colors: ['blue'], race: 'dragon',
    stage: 0, cost: 9, attack: 9, hp: 10,
    skills: [
      { name: '虛空凝視', cost: 2, target: CREATURE, effects: [{ type: 'paralyze' }, { type: 'draw', count: 1 }] },
      { name: '虛空吐息', cost: 4, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] },
    ],
    entry: { name: '虛空之門', target: NONE, effects: [{ type: 'draw', count: 2 }] },
    death: { name: '虛空崩塌', effects: [{ type: 'paralyze', all: true }] },
  },
  // 黑：中毒、消滅、犧牲
  {
    kind: 'creature', id: 'rot-hatchling', name: '腐爛雛龍', rarity: 'N', colors: ['black'], race: 'dragon', stage: 0, cost: 2, attack: 2, hp: 2, skills: [],
    death: { name: '腐屍', effects: [{ type: 'poison', amount: 1, all: true }] },
  },
  {
    kind: 'creature', id: 'ghoul-drake', name: '屍龍', rarity: 'N', colors: ['black'], race: 'undead', stage: 0, cost: 4, attack: 3, hp: 4, skills: [],
    death: { name: '屍爆', effects: [{ type: 'summonToken', token: 'skeleton-token', count: 1 }] },
  },
  {
    kind: 'creature', id: 'obsidian-egg', name: '黑曜之卵', rarity: 'N', colors: ['black'], race: 'dragon',
    stage: 0, cost: 2, attack: 0, hp: 3, skills: [], death: { name: '孵化', effects: [{ type: 'summonToken', token: 'whelp-token', count: 1 }] },
  },
  {
    kind: 'spell', id: 'netherflame-breath', name: '冥火吐息', rarity: 'N', colors: ['black'], cost: 3,
    target: CREATURE, effects: [{ type: 'damage', amount: 3 }, { type: 'poison', amount: 2 }],
  },
  {
    kind: 'creature', id: 'venomfang-drake', name: '毒牙龍', rarity: 'R', colors: ['black'], race: 'dragon',
    stage: 0, cost: 3, attack: 2, hp: 3, skills: [{ name: '毒牙', cost: 1, target: CREATURE, effects: [{ type: 'poison', amount: 2 }] }],
    death: { name: '毒血', effects: [{ type: 'poison', amount: 1, all: true }] },
  },
  {
    kind: 'creature', id: 'shadow-priest', name: '暗影祭司', rarity: 'R', colors: ['black'], race: 'human',
    stage: 0, cost: 2, attack: 1, hp: 2, skills: [{ name: '詛咒', cost: 2, target: CREATURE, effects: [{ type: 'weaken' }] }],
    death: { name: '臨終詛咒', effects: [{ type: 'opponentDiscardRandom', count: 1 }] },
  },
  {
    kind: 'creature', id: 'fallen-dragoon', name: '墮落龍騎', rarity: 'R', colors: ['black'], race: 'human',
    stage: 0, cost: 5, attack: 4, hp: 6, skills: [hit('黑焰', 2, ANY, 3)],
    kin: { race: 'dragon', attack: 1 },
  },
  {
    kind: 'spell', id: 'blood-offering', name: '血祭', rarity: 'R', colors: ['black'], cost: 4,
    target: NONE, effects: [{ type: 'draw', count: 2 }, { type: 'opponentDiscardRandom', count: 1 }],
  },
  {
    kind: 'spell', id: 'soul-reap', name: '靈魂收割', rarity: 'R', colors: ['black'], cost: 4,
    target: NONE, effects: [{ type: 'poison', amount: 2, all: true }], awaken: [{ type: 'healHero', amount: 4 }],
  },
  {
    kind: 'creature', id: 'bone-dragon-knight', name: '骨龍騎士', rarity: 'SR', colors: ['black'], race: 'undead', trait: 2,
    stage: 0, cost: 6, attack: 5, hp: 6, skills: [hit('骨刺', 2, CREATURE, 3)],
    death: { name: '骨爆', effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
    entry: { name: '骨誓', target: NONE, effects: [{ type: 'summonToken', token: 'skeleton-token', count: 1 }] },
  },
  {
    kind: 'creature', id: 'soul-eater-dragon', name: '噬魂龍', rarity: 'UR', colors: ['black'], race: 'dragon',
    stage: 0, cost: 8, attack: 8, hp: 9,
    skills: [
      { name: '噬魂', cost: 4, target: CREATURE, effects: [{ type: 'halveHp' }, { type: 'buff', attack: 1, hp: 1, on: 'self' }] },
      { name: '死亡之息', cost: 4, target: NONE, effects: [{ type: 'poison', amount: 3, all: true }] },
    ],
    entry: { name: '噬魂之嘯', target: NONE, effects: [{ type: 'opponentDiscardRandom', count: 1 }] },
    death: { name: '靈魂釋放', effects: [{ type: 'healHero', amount: 5 }] },
  },
  // 紅：速攻、傷害
  {
    kind: 'creature', id: 'spark-hatchling', name: '火花雛龍', rarity: 'N', colors: ['red'], race: 'dragon', stage: 0, cost: 2, attack: 2, hp: 2, skills: [],
    entry: { name: '火花', target: ANY, effects: [{ type: 'damage', amount: 1 }] },
  },
  {
    kind: 'creature', id: 'redscale-war-dragon', name: '赤鱗戰龍', rarity: 'N', colors: ['red'], race: 'dragon', stage: 0, cost: 5, attack: 5, hp: 5, skills: [],
    kin: { race: 'dragon', attack: 1 },
  },
  { kind: 'spell', id: 'burst-breath', name: '爆裂龍息', rarity: 'N', colors: ['red'], cost: 2, target: ANY, effects: [{ type: 'damage', amount: 3 }] },
  {
    kind: 'creature', id: 'dragonflame-berserker', name: '龍焰狂戰士', rarity: 'R', colors: ['red'], race: 'human',
    stage: 0, cost: 3, attack: 3, hp: 2, keywords: ['haste'], skills: [], kin: { race: 'dragon', attack: 1 },
    death: { name: '狂焰', effects: [{ type: 'damageEnemyCreatures', amount: 1 }] },
  },
  {
    kind: 'creature', id: 'twin-flame-wyvern', name: '焰翼雙龍', rarity: 'R', colors: ['red'], race: 'dragon',
    stage: 0, cost: 5, attack: 4, hp: 4, keywords: ['haste'],
    skills: [{ name: '焚翼', cost: 2, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 1 }] }],
    entry: { name: '雙焰', target: ANY, effects: [{ type: 'damage', amount: 2 }] },
  },
  {
    kind: 'spell', id: 'prairie-fire', name: '燎原之火', rarity: 'R', colors: ['red'], cost: 4,
    target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }], awaken: [{ type: 'damageEnemyCreatures', amount: 2 }],
  },
  {
    kind: 'spell', id: 'dragoon-charge', name: '龍騎突擊', rarity: 'R', colors: ['red'], cost: 2,
    target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 3, hp: 0, on: 'target' }], awaken: [{ type: 'draw', count: 1 }],
  },
  { kind: 'item', id: 'dragonfire-rune', name: '龍炎符文', rarity: 'R', colors: ['red'], cost: 2, attack: 2, skills: [hit('符文爆', 2, OPPOSITE, 4)] },
  {
    kind: 'creature', id: 'volcano-dragon', name: '火山龍', rarity: 'SR', colors: ['red'], race: 'dragon',
    stage: 0, cost: 7, attack: 6, hp: 8, entry: { name: '火山彈', target: ANY, effects: [{ type: 'damage', amount: 3 }] },
    skills: [{ name: '火山爆發', cost: 4, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 3 }] }],
    death: { name: '熔岩', effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
  },
  {
    kind: 'creature', id: 'inferno-dragon-king', name: '炎獄龍王', rarity: 'UR', colors: ['red'], race: 'dragon',
    stage: 0, cost: 9, attack: 9, hp: 10,
    skills: [hit('炎獄之門', 3, ANY, 4), { name: '龍王怒吼', cost: 2, target: NONE, effects: [{ type: 'buff', attack: 1, hp: 0, on: 'all' }] }],
    entry: { name: '炎獄降臨', target: NONE, effects: [{ type: 'burn', amount: 2, all: true }] },
    kin: { race: 'dragon', attack: 2 },
  },
  // 綠：能量上限、大體型、龍蛋
  {
    kind: 'creature', id: 'moss-hatchling', name: '苔蘚雛龍', rarity: 'N', colors: ['green'], race: 'dragon', stage: 0, cost: 1, attack: 1, hp: 2, skills: [],
    death: { name: '養分', effects: [{ type: 'healHero', amount: 2 }] },
  },
  {
    kind: 'creature', id: 'forest-drake-beast', name: '森林龍獸', rarity: 'N', colors: ['green'], race: 'beast', stage: 0, cost: 4, attack: 3, hp: 4, skills: [],
    death: { name: '巢穴', effects: [{ type: 'summonToken', token: 'whelp-token', count: 1 }] },
  },
  {
    kind: 'creature', id: 'great-horn-dragon', name: '巨角龍', rarity: 'N', colors: ['green'], race: 'dragon', stage: 0, cost: 6, attack: 6, hp: 6, skills: [],
    entry: { name: '巨角衝撞', target: CREATURE, effects: [{ type: 'damage', amount: 2 }] },
  },
  {
    kind: 'spell', id: 'sprouting-power', name: '萌芽之力', rarity: 'N', colors: ['green'], cost: 3,
    target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }, { type: 'healHero', amount: 3 }],
  },
  {
    kind: 'creature', id: 'leyline-vine', name: '龍脈藤', rarity: 'R', colors: ['green'], race: 'plant',
    stage: 0, cost: 2, attack: 1, hp: 3, skills: [{ name: '纏繞', cost: 1, target: CREATURE, effects: [{ type: 'weaken' }] }],
    triggers: [{ when: 'turnEnd', name: '汲取', effects: [{ type: 'healHero', amount: 1 }] }],
  },
  {
    kind: 'creature', id: 'nest-elder', name: '龍巢長老', rarity: 'N', colors: ['green'], race: 'human',
    stage: 0, cost: 4, attack: 3, hp: 4, skills: [], entry: { name: '喚雛', target: NONE, effects: [{ type: 'summonToken', token: 'whelp-token', count: 1 }] },
  },
  {
    kind: 'spell', id: 'earth-wrath', name: '大地之怒', rarity: 'R', colors: ['green'], cost: 5,
    target: CREATURE, effects: [{ type: 'damage', amount: 7 }], awaken: [{ type: 'healAll', amount: 3 }],
  },
  { kind: 'field', id: 'dragon-nest', name: '龍巢', rarity: 'R', colors: ['green'], cost: 3, creatures: { hp: 1, regenerate: 1 } },
  {
    kind: 'creature', id: 'jade-dragon', name: '翡翠龍', rarity: 'SR', colors: ['green'], race: 'dragon',
    stage: 0, cost: 5, attack: 4, hp: 6, regenerate: 2,
    skills: [{ name: '龍脈', cost: 3, uses: 1, target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] }],
    entry: { name: '翠光', target: NONE, effects: [{ type: 'healAll', amount: 2 }] },
    triggers: [{ when: 'turnStart', name: '龍脈滋養', effects: [{ type: 'healHero', amount: 2 }] }],
  },
  {
    kind: 'creature', id: 'ancient-egg', name: '遠古之卵', rarity: 'N', colors: ['green'], race: 'dragon',
    stage: 0, cost: 3, attack: 0, hp: 5, skills: [], death: { name: '破殼', effects: [{ type: 'summonToken', token: 'wyrm-token', count: 2 }] },
  },
  {
    kind: 'creature', id: 'ancient-tree-dragon-king', name: '巨木龍王', rarity: 'UR', colors: ['green'], race: 'dragon',
    stage: 0, cost: 10, attack: 10, hp: 11,
    skills: [
      { name: '根鬚纏繞', cost: 2, target: CREATURE, effects: [{ type: 'weaken' }, { type: 'draw', count: 1 }] },
      { name: '萬木回春', cost: 3, target: NONE, effects: [{ type: 'healAll', amount: 4 }] },
    ],
    entry: { name: '萬木生長', target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }] },
    triggers: [{ when: 'turnStart', name: '古木之心', effects: [{ type: 'healAll', amount: 2 }] }],
  },
  // 無色：比有顏色的少 1 點數值
  {
    kind: 'creature', id: 'dragon-apprentice', name: '龍語學徒', rarity: 'N', colors: [], race: 'human', stage: 0, cost: 2, attack: 2, hp: 2, skills: [],
    kin: { race: 'dragon', attack: 1 },
  },
  {
    kind: 'creature', id: 'wandering-dragoon', name: '流浪龍騎', rarity: 'N', colors: [], race: 'human', stage: 0, cost: 3, attack: 2, hp: 3, skills: [],
    entry: { name: '護衛', target: NONE, effects: [{ type: 'taunt' }] },
  },
  { kind: 'item', id: 'dragonbone-charm', name: '龍骨護符', rarity: 'N', colors: [], cost: 1, hp: 2 },
  {
    kind: 'spell', id: 'leyline-crystal', name: '龍脈水晶', rarity: 'R', colors: [], cost: 3,
    target: NONE, effects: [{ type: 'gainMaxEnergy', amount: 1 }], awaken: [{ type: 'draw', count: 2 }],
  },
  {
    kind: 'creature', id: 'mech-dragon', name: '機械龍', rarity: 'R', colors: [], race: 'machine',
    stage: 0, cost: 6, attack: 5, hp: 5, skills: [hit('機砲', 2, DIAGONAL, 3)],
    death: { name: '殘骸', effects: [{ type: 'summonToken', token: 'whelp-token', count: 1 }] },
  },
  { kind: 'field', id: 'ancient-stele', name: '古龍石碑', rarity: 'R', colors: [], cost: 4, creatures: { attack: 1 } },
  {
    kind: 'creature', id: 'dragonbone-colossus', name: '龍骨巨像', rarity: 'SR', colors: [], race: 'machine', trait: 2,
    stage: 0, cost: 8, attack: 6, hp: 8, skills: [{ name: '踐踏', cost: 3, target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] }],
    entry: { name: '骨震', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 1 }] },
    death: { name: '散骨', effects: [{ type: 'summonToken', token: 'whelp-token', count: 2 }] },
  },
  // 雙色：給新英雄的卡
  {
    kind: 'creature', id: 'skyward-warden', name: '天穹守望者', rarity: 'SR', colors: ['white', 'blue'], race: 'dragon',
    stage: 0, cost: 5, attack: 4, hp: 6,
    skills: [{ name: '聖霧', cost: 2, target: NONE, effects: [{ type: 'draw', count: 1 }, { type: 'healHero', amount: 2 }] }],
    entry: { name: '天光', target: NONE, effects: [{ type: 'healHero', amount: 3 }] },
    death: { name: '守望', effects: [{ type: 'draw', count: 1 }] },
  },
  {
    kind: 'creature', id: 'dusk-dragon', name: '晨昏龍', rarity: 'SR', colors: ['white', 'black'], race: 'dragon',
    stage: 0, cost: 6, attack: 5, hp: 7, keywords: ['lifesteal'], skills: [{ name: '汲魂', cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }] }],
    entry: { name: '暮光', target: CREATURE, effects: [{ type: 'damage', amount: 2 }] },
    death: { name: '晨曦再臨', effects: [{ type: 'healHero', amount: 4 }] },
  },
  {
    kind: 'creature', id: 'thunder-dragon', name: '雷暴龍', rarity: 'SR', colors: ['blue', 'red'], race: 'dragon',
    stage: 0, cost: 6, attack: 5, hp: 6, skills: [{ name: '雷焰', cost: 3, target: ANY, effects: [{ type: 'damage', amount: 3 }, { type: 'paralyze' }] }],
    entry: { name: '雷鳴', target: ANY, effects: [{ type: 'damage', amount: 2 }] },
    death: { name: '餘雷', effects: [{ type: 'damageEnemyCreatures', amount: 1 }] },
  },
  {
    kind: 'creature', id: 'miasma-lizard', name: '瘴氣巨蜥', rarity: 'SR', colors: ['black', 'green'], race: 'beast',
    stage: 0, cost: 5, attack: 4, hp: 6, regenerate: 1, skills: [{ name: '瘴毒', cost: 2, target: NONE, effects: [{ type: 'poison', amount: 1, all: true }] }],
    entry: { name: '毒霧', target: CREATURE, effects: [{ type: 'poison', amount: 2 }] },
    death: { name: '瘴氣', effects: [{ type: 'poison', amount: 1, all: true }] },
  },
  {
    kind: 'creature', id: 'blaze-grove-dragon', name: '焰林龍', rarity: 'SR', colors: ['red', 'green'], race: 'dragon',
    stage: 0, cost: 6, attack: 5, hp: 6, keywords: ['haste'], skills: [hit('焦土', 3, ANY, 4)],
    kin: { race: 'dragon', attack: 1 },
    death: { name: '餘燼新芽', effects: [{ type: 'summonToken', token: 'wyrm-token', count: 1 }] },
  },
  // 新英雄的英雄進化
  {
    kind: 'heroEvolution', id: 'sky-emperor', name: '天穹龍皇', rarity: 'UR', colors: ['white', 'blue'],
    cost: 6, evolvesFrom: 'sky-envoy', hpBonus: 9,
    entry: { name: '天啟', target: NONE, effects: [{ type: 'draw', count: 2 }] },
    power: { name: '天諭', cost: 3, target: NONE, effects: [{ type: 'draw', count: 1 }, { type: 'healHero', amount: 3 }] },
  },
  {
    kind: 'heroEvolution', id: 'dusk-sovereign', name: '晨昏主宰', rarity: 'UR', colors: ['white', 'black'],
    cost: 6, evolvesFrom: 'dusk-judge', hpBonus: 10,
    entry: { name: '終末', target: CREATURE, effects: [{ type: 'destroyCreature' }] },
    power: { name: '噬光', cost: 3, target: CREATURE, effects: [{ type: 'damage', amount: 3 }, { type: 'healHero', amount: 3 }] },
  },
  {
    kind: 'heroEvolution', id: 'storm-archmage', name: '雷焰大魔導', rarity: 'UR', colors: ['blue', 'red'],
    cost: 6, evolvesFrom: 'storm-sorcerer', hpBonus: 9,
    entry: { name: '雷暴', target: NONE, effects: [{ type: 'damageEnemyCreatures', amount: 2 }] },
    power: { name: '雷霆', cost: 3, target: ANY, effects: [{ type: 'damage', amount: 3 }, { type: 'paralyze' }] },
  },
  {
    kind: 'heroEvolution', id: 'bog-empress', name: '腐沼女王', rarity: 'UR', colors: ['black', 'green'],
    cost: 6, evolvesFrom: 'bog-queen', hpBonus: 10,
    entry: { name: '瘴氣', target: NONE, effects: [{ type: 'poison', amount: 2, all: true }] },
    power: { name: '腐蝕', cost: 2, target: CREATURE, effects: [{ type: 'poison', amount: 3 }] },
  },
  {
    kind: 'heroEvolution', id: 'wyrm-progenitor', name: '龍脈始祖', rarity: 'UR', colors: ['red', 'green'],
    cost: 6, evolvesFrom: 'wyrm-lord', hpBonus: 10,
    entry: { name: '群龍', target: NONE, effects: [{ type: 'summonToken', token: 'wyrm-token', count: 2 }] },
    power: {
      name: '龍嘯', cost: 5, target: NONE,
      effects: [{ type: 'summonToken', token: 'wyrm-token', count: 1 }, { type: 'buff', attack: 1, hp: 0, on: 'all' }],
    },
  },
  // 龍蛋與龍巢長老召喚的
  { kind: 'creature', id: 'whelp-token', name: '雛龍', rarity: 'N', colors: [], race: 'dragon', stage: 0, cost: 0, attack: 2, hp: 2, skills: [], token: true },
];

export const AWAKENING_CARDS: DeckCardDef[] = CARDS.map((card) => ({ ...card, set: 'awakening' }));
export const AWAKENING_HEROES: HeroDef[] = HEROES.map((hero) => ({ ...hero, set: 'awakening' }));

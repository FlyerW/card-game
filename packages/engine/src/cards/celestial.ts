import type { Ability, DeckCardDef, Effect, HeroDef, TargetSpec } from '../types';

// 第三彈「天機神殿」（還沒發布）：天使與機械，100 張卡、5 個新英雄。設計見 docs/design.md 的「第三彈」一節。
// 新機制：**聖盾**（第一次受到傷害時傷害變成 0）與 **連擊**（這回合已經打出過別的牌時多發動一段）。
// 生物照擴充卡包的規則：N／R／SR／UR 各 1／2／3／4 個能力，一個詞條算一個；trait: 0 是拿掉種族特色。

const ANY: TargetSpec = { kind: 'enemy', allow: 'any' };
const CREATURE: TargetSpec = { kind: 'enemy', allow: 'creature' };
const DIAGONAL: TargetSpec = { kind: 'lane', lane: 'diagonal' };
const ALLY: TargetSpec = { kind: 'ally', allow: 'any' };
const ALLY_CREATURE: TargetSpec = { kind: 'ally', allow: 'creature' };
const NONE: TargetSpec = { kind: 'none' };

const hit = (name: string, cost: number, target: TargetSpec, amount: number): Ability => ({ name, cost, target, effects: [{ type: 'damage', amount }] });
const damage = (amount: number): Effect => ({ type: 'damage', amount });
const aoe = (amount: number): Effect => ({ type: 'damageEnemyCreatures', amount });
const draw = (count: number): Effect => ({ type: 'draw', count });
const heal = (amount: number): Effect => ({ type: 'healHero', amount });
const healAll = (amount: number): Effect => ({ type: 'healAll', amount });
const summon = (token: string, count = 1): Effect => ({ type: 'summonToken', token, count });
const shieldTarget: Effect = { type: 'shield', on: 'target' };
const shieldSelf: Effect = { type: 'shield', on: 'self' };
const shieldAll: Effect = { type: 'shield', on: 'all' };
const gain: Effect = { type: 'gainMaxEnergy', amount: 1 };

const HEROES: HeroDef[] = [
  {
    kind: 'hero', id: 'blood-blade-lord', name: '血刃領主', rarity: 'UR', colors: ['black', 'red'], hp: 38,
    power: { name: '血刃', cost: 2, target: ANY, effects: [damage(1)], combo: [damage(1)] },
  },
  {
    kind: 'hero', id: 'tidegrove-druid', name: '潮林德魯伊', rarity: 'UR', colors: ['blue', 'green'], hp: 42,
    power: { name: '潮生', cost: 3, uses: 3, target: NONE, effects: [draw(1), gain] },
  },
  {
    kind: 'hero', id: 'libra-oracle', name: '天秤神官', rarity: 'UR', colors: ['white', 'blue', 'black'], hp: 41,
    power: { name: '天秤', cost: 2, target: ALLY_CREATURE, effects: [shieldTarget] },
  },
  {
    kind: 'hero', id: 'dawn-war-god', name: '曙光軍神', rarity: 'UR', colors: ['white', 'red', 'green'], hp: 33,
    passive: { name: '曙光', creatures: { attack: 1, hp: 1 } },
  },
  {
    kind: 'hero', id: 'gear-tyrant', name: '齒輪暴君', rarity: 'UR', colors: ['black', 'red', 'green'], hp: 38,
    power: { name: '組裝', cost: 3, target: NONE, effects: [summon('part-bot')] },
  },
];

const CARDS: DeckCardDef[] = [
  // ── 白：天使、聖盾、回復 ──
  { kind: 'creature', id: 'shield-novice', name: '聖盾見習生', rarity: 'N', colors: ['white'], race: 'human', trait: 0, stage: 0, cost: 1, attack: 1, hp: 1, keywords: ['shield'], skills: [] },
  {
    kind: 'creature', id: 'dawn-nun', name: '晨禱修女', rarity: 'N', colors: ['white'], race: 'human', trait: 0,
    stage: 0, cost: 2, attack: 2, hp: 2, skills: [], entry: { name: '晨禱', target: NONE, effects: [heal(2)] },
  },
  { kind: 'creature', id: 'featherlight-angel', name: '光羽天使', rarity: 'N', colors: ['white'], race: 'angel', trait: 2, stage: 0, cost: 2, attack: 2, hp: 2, skills: [] },
  { kind: 'creature', id: 'silver-guard', name: '銀甲衛兵', rarity: 'N', colors: ['white'], race: 'human', stage: 0, cost: 3, attack: 2, hp: 5, skills: [] },
  {
    kind: 'creature', id: 'temple-gatekeeper', name: '聖殿守門人', rarity: 'N', colors: ['white'], race: 'human', trait: 0,
    stage: 0, cost: 4, attack: 1, hp: 7, skills: [], entry: { name: '守門', target: NONE, effects: [{ type: 'taunt' }] },
  },
  { kind: 'creature', id: 'holy-cavalry', name: '聖光騎兵', rarity: 'N', colors: ['white'], race: 'human', stage: 0, cost: 5, attack: 6, hp: 4, skills: [] },
  {
    kind: 'creature', id: 'ward-priest', name: '護盾祭司', rarity: 'R', colors: ['white'], race: 'human',
    stage: 0, cost: 3, attack: 2, hp: 4, skills: [{ name: '賜盾', cost: 2, target: ALLY_CREATURE, effects: [shieldTarget] }],
  },
  { kind: 'creature', id: 'angel-lancer', name: '天使槍兵', rarity: 'R', colors: ['white'], race: 'angel', trait: 2, stage: 0, cost: 4, attack: 5, hp: 2, keywords: ['shield'], skills: [] },
  {
    kind: 'creature', id: 'choir-captain', name: '聖歌隊長', rarity: 'R', colors: ['white'], race: 'human',
    stage: 0, cost: 3, attack: 2, hp: 4, skills: [], death: { name: '聖歌', effects: [heal(3)] },
  },
  {
    kind: 'spell', id: 'temple-blessing', name: '神殿的祝福', rarity: 'R', colors: ['white'], cost: 2,
    target: ALLY_CREATURE, effects: [shieldTarget], combo: [draw(1)],
  },
  { kind: 'spell', id: 'purifying-light', name: '淨化之光', rarity: 'R', colors: ['white'], cost: 4, target: CREATURE, effects: [{ type: 'silence' }, draw(1)] },
  { kind: 'field', id: 'light-bulwark', name: '聖光壁壘', rarity: 'R', colors: ['white'], cost: 3, creatures: { hp: 1 }, heroRegenerate: 1 },
  {
    kind: 'creature', id: 'seraph-guardian', name: '熾翼守護天使', rarity: 'SR', colors: ['white'], race: 'angel', trait: 3,
    stage: 0, cost: 5, attack: 3, hp: 8, keywords: ['shield'], skills: [{ name: '神聖連結', cost: 2, target: ALLY_CREATURE, effects: [shieldTarget] }],
  },
  {
    kind: 'creature', id: 'knight-commander', name: '聖堂騎士團長', rarity: 'SR', colors: ['white'], race: 'human', trait: 2,
    stage: 0, cost: 6, attack: 5, hp: 8, entry: { name: '聖誓', target: NONE, effects: [shieldAll] },
    skills: [{ name: '號令', cost: 3, target: NONE, effects: [summon('soldier-token')] }],
  },
  { kind: 'spell', id: 'divine-punishment', name: '天罰', rarity: 'SR', colors: ['white'], cost: 6, target: NONE, effects: [aoe(4), heal(4)] },
  {
    kind: 'creature', id: 'celestial-archangel', name: '天界大天使', rarity: 'UR', colors: ['white'], race: 'angel', trait: 4,
    stage: 0, cost: 9, attack: 9, hp: 12, keywords: ['shield'],
    entry: { name: '天界降臨', target: NONE, effects: [shieldAll, { type: 'buff', attack: 1, hp: 1, on: 'all' }] },
    skills: [hit('天界審判', 4, ANY, 6)],
  },

  // ── 藍：奧術機械、連擊、抽牌與麻痺 ──
  { kind: 'creature', id: 'clockwork-owl', name: '發條貓頭鷹', rarity: 'N', colors: ['blue'], race: 'machine', stage: 0, cost: 1, attack: 0, hp: 3, skills: [] },
  {
    kind: 'creature', id: 'rune-apprentice', name: '秘文學徒', rarity: 'N', colors: ['blue'], race: 'human', trait: 0,
    stage: 0, cost: 2, attack: 1, hp: 3, skills: [], death: { name: '遺稿', effects: [draw(1)] },
  },
  { kind: 'creature', id: 'frostshield-bot', name: '霜盾機兵', rarity: 'N', colors: ['blue'], race: 'machine', trait: 0, stage: 0, cost: 3, attack: 2, hp: 4, keywords: ['shield'], skills: [] },
  {
    kind: 'creature', id: 'tide-chanter', name: '潮音術士', rarity: 'N', colors: ['blue'], race: 'human', trait: 0,
    stage: 0, cost: 3, attack: 3, hp: 3, skills: [], entry: { name: '潮音', target: CREATURE, effects: [{ type: 'weaken' }] },
  },
  {
    kind: 'creature', id: 'frost-colossus', name: '寒霜巨像', rarity: 'N', colors: ['blue'], race: 'machine', trait: 0,
    stage: 0, cost: 5, attack: 3, hp: 8, skills: [], entry: { name: '寒霜', target: CREATURE, effects: [{ type: 'paralyze' }] },
  },
  { kind: 'spell', id: 'arcane-missile', name: '秘法飛彈', rarity: 'N', colors: ['blue'], cost: 1, target: ANY, effects: [damage(1)], combo: [draw(1)] },
  {
    kind: 'creature', id: 'rune-smith', name: '符文工匠', rarity: 'R', colors: ['blue'], race: 'human',
    stage: 0, cost: 2, attack: 1, hp: 3, skills: [], entry: { name: '靈感', target: NONE, effects: [], combo: [draw(1)] },
  },
  {
    kind: 'creature', id: 'mirror-golem', name: '鏡像魔像', rarity: 'R', colors: ['blue'], race: 'machine',
    stage: 0, cost: 4, attack: 2, hp: 6, skills: [{ name: '反射', cost: 1, target: NONE, effects: [shieldSelf] }],
  },
  {
    kind: 'creature', id: 'tide-puppeteer', name: '潮汐傀儡師', rarity: 'R', colors: ['blue'], race: 'human',
    stage: 0, cost: 4, attack: 3, hp: 5, skills: [], triggers: [{ when: 'allySummoned', race: 'machine', name: '操偶', effects: [draw(1)] }],
  },
  { kind: 'spell', id: 'time-warp', name: '時間扭曲', rarity: 'R', colors: ['blue'], cost: 3, target: CREATURE, effects: [{ type: 'paralyze' }], combo: [draw(2)] },
  { kind: 'spell', id: 'arcane-resonance', name: '秘法共鳴', rarity: 'R', colors: ['blue'], cost: 2, target: NONE, effects: [draw(1)], combo: [draw(1)] },
  { kind: 'spell', id: 'arcane-ward', name: '奧術護盾', rarity: 'R', colors: ['blue'], cost: 1, target: ALLY_CREATURE, effects: [shieldTarget, draw(1)] },
  {
    kind: 'creature', id: 'astro-engineer', name: '天文機械師', rarity: 'SR', colors: ['blue'], race: 'human',
    stage: 0, cost: 5, attack: 2, hp: 7, triggers: [{ when: 'turnEnd', name: '觀星', effects: [draw(1)] }],
    skills: [{ name: '校準', cost: 2, target: ALLY_CREATURE, effects: [shieldTarget] }],
  },
  {
    kind: 'creature', id: 'tide-mech', name: '深潮機甲', rarity: 'SR', colors: ['blue'], race: 'machine',
    stage: 0, cost: 6, attack: 6, hp: 6, keywords: ['shield'],
    skills: [{ name: '潮砲', cost: 2, target: CREATURE, effects: [damage(3), { type: 'paralyze' }] }],
  },
  { kind: 'spell', id: 'timestream', name: '時空奔流', rarity: 'SR', colors: ['blue'], cost: 5, target: NONE, effects: [{ type: 'paralyze', all: true }], combo: [draw(2)] },
  {
    kind: 'creature', id: 'omni-machine-god', name: '萬象機神', rarity: 'UR', colors: ['blue'], race: 'machine', trait: 2,
    stage: 0, cost: 9, attack: 9, hp: 11, keywords: ['shield'], entry: { name: '萬象開啟', target: NONE, effects: [draw(2)] },
    skills: [{ name: '萬象', cost: 3, target: ANY, effects: [damage(4), { type: 'paralyze' }] }],
  },

  // ── 黑：連擊、中毒、消滅 ──
  {
    kind: 'creature', id: 'shadow-thief', name: '陰影盜賊', rarity: 'N', colors: ['black'], race: 'human', trait: 0,
    stage: 0, cost: 1, attack: 2, hp: 1, skills: [], entry: { name: '偷襲', target: ANY, effects: [], combo: [damage(2)] },
  },
  { kind: 'creature', id: 'rotting-soldier', name: '腐屍兵', rarity: 'N', colors: ['black'], race: 'undead', stage: 0, cost: 2, attack: 3, hp: 3, skills: [] },
  {
    kind: 'creature', id: 'venom-rat', name: '毒牙鼠', rarity: 'N', colors: ['black'], race: 'beast', trait: 0,
    stage: 0, cost: 2, attack: 2, hp: 2, skills: [], death: { name: '毒血', effects: [{ type: 'poison', amount: 1, all: true }] },
  },
  { kind: 'creature', id: 'alley-assassin', name: '暗巷刺客', rarity: 'N', colors: ['black'], race: 'human', trait: 0, stage: 0, cost: 3, attack: 4, hp: 1, keywords: ['haste'], skills: [] },
  {
    kind: 'creature', id: 'crypt-guard', name: '墓穴守衛', rarity: 'N', colors: ['black'], race: 'undead', trait: 0,
    stage: 0, cost: 4, attack: 5, hp: 3, skills: [], death: { name: '屍爆', effects: [summon('skeleton-token')] },
  },
  { kind: 'spell', id: 'venom-blade', name: '毒刃', rarity: 'N', colors: ['black'], cost: 2, target: CREATURE, effects: [damage(2), { type: 'poison', amount: 2 }] },
  {
    kind: 'creature', id: 'blood-pact-mage', name: '血契術士', rarity: 'R', colors: ['black'], race: 'human',
    stage: 0, cost: 3, attack: 2, hp: 5, skills: [], death: { name: '臨終詛咒', effects: [{ type: 'opponentDiscardRandom', count: 1 }] },
  },
  {
    kind: 'creature', id: 'shadow-blademaster', name: '暗影刀客', rarity: 'R', colors: ['black'], race: 'human',
    stage: 0, cost: 4, attack: 5, hp: 3, skills: [], entry: { name: '暗刃', target: CREATURE, effects: [], combo: [damage(3)] },
  },
  {
    kind: 'creature', id: 'plague-spider', name: '屍毒蜘蛛', rarity: 'R', colors: ['black'], race: 'beast',
    stage: 0, cost: 3, attack: 2, hp: 3, skills: [{ name: '毒絲', cost: 1, target: CREATURE, effects: [{ type: 'poison', amount: 2 }] }],
  },
  { kind: 'spell', id: 'soul-drain', name: '靈魂抽取', rarity: 'R', colors: ['black'], cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }], combo: [heal(4)] },
  {
    kind: 'item', id: 'plague-jar', name: '瘟疫之壺', rarity: 'R', colors: ['black'], cost: 2, attack: 1,
    skills: [{ name: '潑毒', cost: 2, target: NONE, effects: [{ type: 'poison', amount: 1, all: true }] }],
  },
  { kind: 'spell', id: 'assassination-order', name: '暗殺令', rarity: 'R', colors: ['black'], cost: 5, target: CREATURE, effects: [{ type: 'destroyCreature' }], combo: [draw(1)] },
  {
    kind: 'creature', id: 'necro-engineer', name: '死靈機工', rarity: 'SR', colors: ['black'], race: 'undead', trait: 2,
    stage: 0, cost: 5, attack: 4, hp: 6, triggers: [{ when: 'allySummoned', race: 'undead', name: '縫合術', effects: [draw(1)] }],
    skills: [{ name: '縫合', cost: 3, target: NONE, effects: [summon('skeleton-token')] }],
  },
  {
    kind: 'creature', id: 'shadow-duke', name: '暗影公爵', rarity: 'SR', colors: ['black'], race: 'human', trait: 2,
    stage: 0, cost: 6, attack: 6, hp: 5, entry: { name: '暗影密令', target: NONE, effects: [], combo: [{ type: 'opponentDiscardRandom', count: 1 }] },
    skills: [hit('暗刃', 2, ANY, 3)],
  },
  {
    kind: 'spell', id: 'venom-abyss', name: '萬毒深淵', rarity: 'SR', colors: ['black'], cost: 6,
    target: NONE, effects: [{ type: 'poison', amount: 3, all: true }], combo: [aoe(2)],
  },
  {
    kind: 'creature', id: 'netherworld-soul', name: '冥界機魂', rarity: 'UR', colors: ['black'], race: 'undead', trait: 3,
    stage: 0, cost: 9, attack: 8, hp: 9, entry: { name: '冥界', target: NONE, effects: [{ type: 'halveHp', all: true }] },
    death: { name: '亡者召集', effects: [summon('skeleton-token', 2)] },
    skills: [{ name: '魂噬', cost: 5, target: CREATURE, effects: [{ type: 'destroyCreature' }] }],
  },

  // ── 紅：連擊、速攻、爆破機械 ──
  {
    kind: 'creature', id: 'spark-imp', name: '火花小鬼', rarity: 'N', colors: ['red'], race: 'elemental', trait: 0,
    stage: 0, cost: 1, attack: 1, hp: 1, skills: [], death: { name: '火花', effects: [aoe(1)] },
  },
  { kind: 'creature', id: 'berserk-recruit', name: '狂戰新兵', rarity: 'N', colors: ['red'], race: 'human', trait: 0, stage: 0, cost: 2, attack: 4, hp: 1, keywords: ['haste'], skills: [] },
  {
    kind: 'creature', id: 'forge-sapper', name: '熔爐工兵', rarity: 'N', colors: ['red'], race: 'machine', trait: 0,
    stage: 0, cost: 3, attack: 3, hp: 3, skills: [], entry: { name: '火星', target: ANY, effects: [damage(1)] },
  },
  { kind: 'creature', id: 'flameheart-elemental', name: '焰心元素', rarity: 'N', colors: ['red'], race: 'elemental', stage: 0, cost: 4, attack: 5, hp: 4, skills: [] },
  { kind: 'creature', id: 'flame-fist-brawler', name: '炎拳鬥士', rarity: 'N', colors: ['red'], race: 'human', stage: 0, cost: 5, attack: 7, hp: 3, skills: [] },
  { kind: 'spell', id: 'searing-shot', name: '灼熱射擊', rarity: 'N', colors: ['red'], cost: 1, target: ANY, effects: [damage(2)] },
  {
    kind: 'creature', id: 'blast-bot', name: '爆裂機兵', rarity: 'R', colors: ['red'], race: 'machine',
    stage: 0, cost: 3, attack: 4, hp: 2, skills: [], death: { name: '殘骸爆炸', effects: [aoe(1)] },
  },
  {
    kind: 'creature', id: 'blade-dancer', name: '焰刃舞者', rarity: 'R', colors: ['red'], race: 'human', trait: 0,
    stage: 0, cost: 3, attack: 3, hp: 3, keywords: ['haste'], skills: [],
    entry: { name: '舞步', target: NONE, effects: [], combo: [{ type: 'buff', attack: 2, hp: 0, on: 'self' }] },
  },
  {
    kind: 'creature', id: 'zealous-smith', name: '狂熱鐵匠', rarity: 'R', colors: ['red'], race: 'human',
    stage: 0, cost: 4, attack: 3, hp: 5, skills: [],
    triggers: [{ when: 'allySummoned', race: 'machine', name: '鍛造', effects: [{ type: 'buff', attack: 1, hp: 1, on: 'self' }] }],
  },
  { kind: 'spell', id: 'chain-spark', name: '連環火花', rarity: 'R', colors: ['red'], cost: 2, target: ANY, effects: [damage(2)], combo: [damage(2)] },
  { kind: 'spell', id: 'flame-slash', name: '烈焰連斬', rarity: 'R', colors: ['red'], cost: 4, target: CREATURE, effects: [damage(4)], combo: [aoe(1)] },
  { kind: 'item', id: 'flamethrower', name: '火焰噴射器', rarity: 'R', colors: ['red'], cost: 3, attack: 2, skills: [{ name: '噴火', cost: 2, target: NONE, effects: [aoe(1)] }] },
  {
    kind: 'creature', id: 'lava-mech', name: '熔岩機甲', rarity: 'SR', colors: ['red'], race: 'machine',
    stage: 0, cost: 6, attack: 7, hp: 4, keywords: ['haste'], skills: [hit('熔岩砲', 3, ANY, 4)],
  },
  {
    kind: 'creature', id: 'flame-dancer', name: '焰魔舞姬', rarity: 'SR', colors: ['red'], race: 'elemental',
    stage: 0, cost: 5, attack: 5, hp: 4, entry: { name: '焰舞', target: NONE, effects: [], combo: [aoe(2)] },
    skills: [hit('火環', 2, DIAGONAL, 3)],
  },
  { kind: 'spell', id: 'demolition-plan', name: '爆破計畫', rarity: 'SR', colors: ['red'], cost: 5, target: ANY, effects: [damage(6)], combo: [aoe(2)] },
  {
    kind: 'creature', id: 'inferno-machine-god', name: '煉獄機神', rarity: 'UR', colors: ['red'], race: 'machine', trait: 2,
    stage: 0, cost: 10, attack: 9, hp: 10, keywords: ['haste'], entry: { name: '煉獄降臨', target: NONE, effects: [aoe(2)] },
    skills: [hit('煉獄砲', 4, ANY, 6)],
  },

  // ── 綠：能扛的大塊頭、回復、加能量上限 ──
  { kind: 'creature', id: 'acorn-sprite', name: '橡實精靈', rarity: 'N', colors: ['green'], race: 'plant', stage: 0, cost: 1, attack: 0, hp: 3, skills: [] },
  { kind: 'creature', id: 'glade-deer', name: '林間鹿', rarity: 'N', colors: ['green'], race: 'beast', stage: 0, cost: 2, attack: 3, hp: 3, skills: [] },
  {
    kind: 'creature', id: 'mossstone-guard', name: '苔石守衛', rarity: 'N', colors: ['green'], race: 'plant', trait: 0,
    stage: 0, cost: 3, attack: 2, hp: 4, skills: [], death: { name: '歸林', effects: [heal(3)] },
  },
  {
    kind: 'creature', id: 'great-stump', name: '巨木樁', rarity: 'N', colors: ['green'], race: 'plant', trait: 0,
    stage: 0, cost: 4, attack: 3, hp: 5, skills: [], entry: { name: '護林', target: NONE, effects: [heal(3)] },
  },
  { kind: 'creature', id: 'rockback-rhino', name: '岩背犀牛', rarity: 'N', colors: ['green'], race: 'beast', stage: 0, cost: 5, attack: 4, hp: 8, skills: [] },
  { kind: 'spell', id: 'force-of-nature', name: '自然之力', rarity: 'N', colors: ['green'], cost: 3, target: ALLY_CREATURE, effects: [{ type: 'buff', attack: 2, hp: 2, on: 'target' }] },
  {
    kind: 'creature', id: 'glade-druid', name: '林地德魯伊', rarity: 'R', colors: ['green'], race: 'human',
    stage: 0, cost: 3, attack: 2, hp: 4, skills: [], entry: { name: '祝禱', target: NONE, effects: [healAll(2)] },
  },
  { kind: 'creature', id: 'barkguard', name: '樹皮甲衛', rarity: 'R', colors: ['green'], race: 'plant', stage: 0, cost: 4, attack: 3, hp: 5, keywords: ['shield'], skills: [] },
  {
    kind: 'creature', id: 'sprawling-vine', name: '蔓生巨藤', rarity: 'R', colors: ['green'], race: 'plant',
    stage: 0, cost: 3, attack: 2, hp: 5, skills: [], triggers: [{ when: 'turnEnd', name: '汲取', effects: [heal(1)] }],
  },
  { kind: 'spell', id: 'wild-growth', name: '野性成長', rarity: 'R', colors: ['green'], cost: 2, target: NONE, effects: [gain], combo: [draw(1)] },
  {
    kind: 'spell', id: 'forest-call', name: '森林呼喚', rarity: 'R', colors: ['green'], cost: 3,
    target: NONE, effects: [summon('sprout-token', 2)], combo: [{ type: 'buff', attack: 0, hp: 1, on: 'all' }],
  },
  {
    kind: 'item', id: 'beast-heart', name: '巨獸之心', rarity: 'R', colors: ['green'], cost: 3, hp: 4,
    skills: [{ name: '咆哮', cost: 2, target: NONE, effects: [{ type: 'buff', attack: 1, hp: 1, on: 'self' }] }],
  },
  {
    kind: 'creature', id: 'ancient-grove-guardian', name: '古林守護者', rarity: 'SR', colors: ['green'], race: 'plant', trait: 2,
    stage: 0, cost: 6, attack: 4, hp: 9, keywords: ['shield'], skills: [], entry: { name: '古木之息', target: NONE, effects: [gain] },
  },
  {
    kind: 'creature', id: 'thunderhorn-beast', name: '雷角巨獸', rarity: 'SR', colors: ['green'], race: 'beast',
    stage: 0, cost: 7, attack: 8, hp: 7, death: { name: '散林', effects: [summon('sprout-token', 2)] },
    skills: [{ name: '踐踏', cost: 3, target: NONE, effects: [aoe(2)] }],
  },
  { kind: 'spell', id: 'earth-renewal', name: '大地復甦', rarity: 'SR', colors: ['green'], cost: 5, target: NONE, effects: [healAll(5), draw(1)] },
  {
    kind: 'creature', id: 'world-tree-guardian', name: '世界樹守護神', rarity: 'UR', colors: ['green'], race: 'plant', trait: 3,
    stage: 0, cost: 10, attack: 6, hp: 16, keywords: ['shield'], triggers: [{ when: 'turnStart', name: '生命之泉', effects: [healAll(2)] }],
    skills: [{ name: '萬物生長', cost: 3, target: NONE, effects: [gain, summon('sprout-token')] }],
  },

  // ── 無色：機械零件（比有顏色的少 1 點數值） ──
  { kind: 'creature', id: 'gear-beetle', name: '齒輪甲蟲', rarity: 'N', colors: [], race: 'machine', stage: 0, cost: 1, attack: 2, hp: 1, skills: [] },
  {
    kind: 'creature', id: 'parts-collector', name: '零件收集者', rarity: 'N', colors: [], race: 'machine', trait: 0,
    stage: 0, cost: 2, attack: 1, hp: 3, skills: [], death: { name: '回收', effects: [summon('part-bot')] },
  },
  { kind: 'creature', id: 'shield-patrol', name: '盾甲巡邏機', rarity: 'N', colors: [], race: 'machine', trait: 0, stage: 0, cost: 3, attack: 2, hp: 3, keywords: ['shield'], skills: [] },
  { kind: 'creature', id: 'steel-infantry', name: '鋼鐵步兵', rarity: 'N', colors: [], race: 'machine', stage: 0, cost: 4, attack: 2, hp: 6, skills: [] },
  {
    kind: 'creature', id: 'assembly-bot', name: '組裝機器人', rarity: 'R', colors: [], race: 'machine',
    stage: 0, cost: 3, attack: 2, hp: 3, skills: [], entry: { name: '組裝', target: NONE, effects: [], combo: [summon('part-bot')] },
  },
  {
    kind: 'creature', id: 'repair-drone', name: '修理無人機', rarity: 'R', colors: [], race: 'machine',
    stage: 0, cost: 2, attack: 1, hp: 3, skills: [{ name: '修理', cost: 1, target: ALLY, effects: [{ type: 'heal', amount: 3 }] }],
  },
  {
    kind: 'item', id: 'energy-core', name: '能量核心', rarity: 'R', colors: [], cost: 2, attack: 1, hp: 2,
    skills: [{ name: '過載', cost: 0, maxEnergyCost: 1, target: NONE, effects: [{ type: 'buff', attack: 2, hp: 2, on: 'self' }] }],
  },
  { kind: 'field', id: 'machine-workshop', name: '機械工坊', rarity: 'R', colors: [], cost: 5, creatures: { damageReduction: 1 } },
  {
    kind: 'creature', id: 'guardian-idol', name: '守護機神像', rarity: 'SR', colors: [], race: 'machine', trait: 2,
    stage: 0, cost: 6, attack: 4, hp: 8, keywords: ['shield'], skills: [], entry: { name: '神盾', target: NONE, effects: [shieldAll] },
  },
  {
    kind: 'creature', id: 'auto-turret', name: '自動砲台', rarity: 'SR', colors: [], race: 'machine',
    stage: 0, cost: 5, attack: 1, hp: 8, triggers: [{ when: 'turnEnd', name: '掃射', effects: [aoe(1)] }], skills: [hit('瞄準', 2, ANY, 2)],
  },

  // ── 多色：每個新英雄一張 ──
  {
    kind: 'creature', id: 'bloodblade-twins', name: '血刃雙子', rarity: 'SR', colors: ['black', 'red'], race: 'human', trait: 0,
    stage: 0, cost: 5, attack: 6, hp: 4, keywords: ['haste'], entry: { name: '雙刃', target: ANY, effects: [], combo: [damage(3)] },
    skills: [{ name: '血刃', cost: 2, target: CREATURE, effects: [damage(2), heal(2)] }],
  },
  {
    kind: 'creature', id: 'tidegrove-tortoise', name: '潮林巨龜', rarity: 'SR', colors: ['blue', 'green'], race: 'beast', trait: 0,
    stage: 0, cost: 6, attack: 3, hp: 10, keywords: ['shield'], entry: { name: '潮林', target: NONE, effects: [draw(1), gain] },
    skills: [{ name: '潮汐', cost: 2, target: NONE, effects: [heal(3)] }],
  },
  {
    kind: 'creature', id: 'libra-apostle', name: '天秤使徒', rarity: 'UR', colors: ['white', 'blue', 'black'], race: 'angel', trait: 3,
    stage: 0, cost: 7, attack: 5, hp: 7, keywords: ['shield'], entry: { name: '天秤', target: CREATURE, effects: [{ type: 'destroyCreature' }] },
    skills: [{ name: '審判', cost: 4, target: ALLY_CREATURE, effects: [shieldTarget, draw(1)] }],
  },
  {
    kind: 'creature', id: 'dawn-standard-bearer', name: '曙光戰旗手', rarity: 'SR', colors: ['white', 'red', 'green'], race: 'human', trait: 2,
    stage: 0, cost: 5, attack: 4, hp: 5, entry: { name: '戰旗', target: NONE, effects: [{ type: 'buff', attack: 1, hp: 0, on: 'all' }] },
    skills: [{ name: '衝鋒', cost: 2, target: NONE, effects: [shieldSelf] }],
  },
  {
    kind: 'creature', id: 'gear-behemoth', name: '齒輪巨獸', rarity: 'UR', colors: ['black', 'red', 'green'], race: 'machine', trait: 2,
    stage: 0, cost: 8, attack: 10, hp: 8, keywords: ['haste'], death: { name: '解體', effects: [summon('part-bot', 2)] },
    skills: [hit('碾碎', 3, CREATURE, 5)],
  },

  // ── 英雄進化 ──
  {
    kind: 'heroEvolution', id: 'blood-demon-lord', name: '血刃魔君', rarity: 'UR', colors: ['black', 'red'],
    cost: 6, evolvesFrom: 'blood-blade-lord', hpBonus: 9,
    entry: { name: '魔刃', target: ANY, effects: [damage(4)] },
    power: { name: '血刃', cost: 2, target: ANY, effects: [damage(2)], combo: [damage(2)] },
  },
  {
    kind: 'heroEvolution', id: 'tidegrove-archdruid', name: '潮林大德魯伊', rarity: 'UR', colors: ['blue', 'green'],
    cost: 6, evolvesFrom: 'tidegrove-druid', hpBonus: 10,
    entry: { name: '潮林甦醒', target: NONE, effects: [gain, draw(1)] },
    power: { name: '潮生', cost: 3, target: NONE, effects: [draw(1), heal(2)] },
  },
  {
    kind: 'heroEvolution', id: 'libra-bishop', name: '天秤主教', rarity: 'UR', colors: ['white', 'blue', 'black'],
    cost: 6, evolvesFrom: 'libra-oracle', hpBonus: 9,
    entry: { name: '天秤庇護', target: NONE, effects: [shieldAll] },
    power: { name: '天秤', cost: 2, target: ALLY_CREATURE, effects: [shieldTarget, { type: 'buff', attack: 1, hp: 1, on: 'target' }] },
  },
  {
    kind: 'heroEvolution', id: 'dawn-war-deity', name: '曙光戰神', rarity: 'UR', colors: ['white', 'red', 'green'],
    cost: 6, evolvesFrom: 'dawn-war-god', hpBonus: 9,
    entry: { name: '曙光降臨', target: NONE, effects: [{ type: 'buff', attack: 1, hp: 1, on: 'all' }] },
    passive: { name: '戰意', ownTurn: { attack: 1 } },
  },
  {
    kind: 'heroEvolution', id: 'gear-overlord', name: '齒輪霸主', rarity: 'UR', colors: ['black', 'red', 'green'],
    cost: 6, evolvesFrom: 'gear-tyrant', hpBonus: 10,
    entry: { name: '大量組裝', target: NONE, effects: [summon('part-bot', 2)] },
    power: { name: '組裝', cost: 3, target: NONE, effects: [summon('part-bot'), { type: 'buff', attack: 1, hp: 0, on: 'all' }] },
  },

  // 機械卡與齒輪暴君召喚的
  { kind: 'creature', id: 'part-bot', name: '零件機兵', rarity: 'N', colors: [], race: 'machine', stage: 0, cost: 0, attack: 1, hp: 2, skills: [], token: true },
];

export const CELESTIAL_CARDS: DeckCardDef[] = CARDS.map((card) => ({ ...card, set: 'celestial' }));
export const CELESTIAL_HEROES: HeroDef[] = HEROES.map((hero) => ({ ...hero, set: 'celestial' }));

import type { Ability, ConditionalEffects, DeckCardDef, Effect, HeroDef, TargetSpec } from '../types';

// 第四彈「命運試煉」（還沒發布）：條件觸發，100 張卡、5 個新英雄。設計見 docs/design.md 的「第四彈」一節。
// 新機制：**條件**——成立時多發動一段效果（寫法跟連擊一樣）。條件越難，多的那段越強：
// - 構築條件（看開局的牌組）：奇數牌組、偶數牌組（最難，只能用一半的卡）、獨一（沒有同名卡）、階梯 N（N 種以上不同費用）
// - 累積條件（看本局）：軍勢 N（召喚過 N 隻生物）、詠唱 N（施放過 N 個法術）、亡魂 N（我方倒下過 N 隻生物）
// 奇數牌組的卡自己都是奇數費用、偶數牌組的卡都是偶數費用，放得進那種牌組。
// 生物照擴充卡包的規則：N／R／SR／UR 各 1／2／3／4 個能力，一個詞條算一個（條件算在同一個能力裡）；trait: 0 是拿掉種族特色。

const ANY: TargetSpec = { kind: 'enemy', allow: 'any' };
const CREATURE: TargetSpec = { kind: 'enemy', allow: 'creature' };
const HERO: TargetSpec = { kind: 'enemy', allow: 'hero' };
const ALLY_CREATURE: TargetSpec = { kind: 'ally', allow: 'creature' };
const NONE: TargetSpec = { kind: 'none' };

const hit = (name: string, cost: number, target: TargetSpec, amount: number): Ability => ({ name, cost, target, effects: [{ type: 'damage', amount }] });
const damage = (amount: number): Effect => ({ type: 'damage', amount });
const aoe = (amount: number): Effect => ({ type: 'damageEnemyCreatures', amount });
const draw = (count: number): Effect => ({ type: 'draw', count });
const heal = (amount: number): Effect => ({ type: 'healHero', amount });
const healAll = (amount: number): Effect => ({ type: 'healAll', amount });
const summon = (token: string, count = 1): Effect => ({ type: 'summonToken', token, count });
const buff = (attack: number, hp: number, on: 'self' | 'target' | 'all'): Effect => ({ type: 'buff', attack, hp, on });
const poison = (amount: number, all?: boolean): Effect => ({ type: 'poison', amount, ...(all ? { all } : {}) });
const gain: Effect = { type: 'gainMaxEnergy', amount: 1 };
const destroy: Effect = { type: 'destroyCreature' };
const taunt: Effect = { type: 'taunt' };

// 條件
const odd = (...effects: Effect[]): ConditionalEffects => ({ when: { kind: 'odd' }, effects });
const even = (...effects: Effect[]): ConditionalEffects => ({ when: { kind: 'even' }, effects });
const lone = (...effects: Effect[]): ConditionalEffects => ({ when: { kind: 'singleton' }, effects });
const ladder = (count: number, ...effects: Effect[]): ConditionalEffects => ({ when: { kind: 'costs', count }, effects });
const army = (count: number, ...effects: Effect[]): ConditionalEffects => ({ when: { kind: 'summoned', count }, effects });
const chant = (count: number, ...effects: Effect[]): ConditionalEffects => ({ when: { kind: 'spells', count }, effects });
const souls = (count: number, ...effects: Effect[]): ConditionalEffects => ({ when: { kind: 'fallen', count }, effects });

const SOLDIER = 'soldier-token';
const SKELETON = 'skeleton-token';
const FIRE_SPIRIT = 'fire-spirit-token';
const SPROUT = 'sprout-token';

const HEROES: HeroDef[] = [
  {
    kind: 'hero', id: 'odd-gate-mage', name: '奇門術士', rarity: 'UR', colors: ['blue', 'black', 'red'], hp: 35,
    power: { name: '奇術', cost: 2, target: ANY, effects: [damage(1)], condition: odd(damage(1)) },
  },
  {
    kind: 'hero', id: 'twin-aspect-saint', name: '兩儀聖女', rarity: 'UR', colors: ['white', 'blue', 'green'], hp: 42,
    power: { name: '兩儀', cost: 2, target: NONE, effects: [heal(3)], condition: even(draw(1)) },
  },
  {
    kind: 'hero', id: 'legion-marshal', name: '萬軍元帥', rarity: 'UR', colors: ['white', 'black', 'red'], hp: 38,
    power: { name: '點兵', cost: 3, target: NONE, effects: [summon(SOLDIER)], condition: army(8, buff(1, 0, 'all')) },
  },
  {
    kind: 'hero', id: 'stair-walker', name: '登階行者', rarity: 'UR', colors: ['blue', 'red', 'green'], hp: 41,
    power: { name: '登階', cost: 2, target: NONE, effects: [draw(1)], condition: ladder(9, gain) },
  },
  {
    kind: 'hero', id: 'lone-star-blade', name: '孤星劍客', rarity: 'UR', colors: ['white', 'black', 'green'], hp: 37,
    power: { name: '孤星', cost: 2, target: CREATURE, effects: [damage(1)], condition: lone(damage(1)) },
  },
];

const CARDS: DeckCardDef[] = [
  // ── 白：軍勢（召喚越多越強）、偶數牌組、獨一 ──
  {
    kind: 'creature', id: 'recruiting-officer', name: '募兵官', rarity: 'N', colors: ['white'], race: 'human', trait: 0,
    stage: 0, cost: 2, attack: 2, hp: 2, skills: [], entry: { name: '募兵', target: NONE, effects: [], condition: army(4, summon(SOLDIER)) },
  },
  {
    kind: 'creature', id: 'twin-shield-guard', name: '雙盾衛兵', rarity: 'N', colors: ['white'], race: 'human', trait: 0,
    stage: 0, cost: 2, attack: 1, hp: 4, skills: [], entry: { name: '列陣', target: NONE, effects: [taunt], condition: even(buff(2, 2, 'self')) },
  },
  {
    kind: 'creature', id: 'phalanx-spearman', name: '方陣長槍兵', rarity: 'N', colors: ['white'], race: 'human', trait: 0,
    stage: 0, cost: 4, attack: 3, hp: 4, skills: [], entry: { name: '方陣', target: NONE, effects: [], condition: army(5, buff(2, 2, 'self')) },
  },
  { kind: 'creature', id: 'temple-knight', name: '聖堂騎士', rarity: 'N', colors: ['white'], race: 'human', stage: 0, cost: 5, attack: 5, hp: 6, skills: [] },
  {
    kind: 'creature', id: 'herald-trumpeter', name: '號角傳令兵', rarity: 'R', colors: ['white'], race: 'human', trait: 0,
    stage: 0, cost: 3, attack: 1, hp: 3, entry: { name: '號令', target: NONE, effects: [summon(SOLDIER)] },
    skills: [{ name: '整隊', cost: 2, target: ALLY_CREATURE, effects: [buff(1, 0, 'target')], condition: army(6, buff(1, 0, 'all')) }],
  },
  {
    kind: 'creature', id: 'lone-paladin', name: '孤高聖騎', rarity: 'R', colors: ['white'], race: 'human', trait: 0,
    stage: 0, cost: 4, attack: 4, hp: 4, keywords: ['lifesteal'], skills: [],
    entry: { name: '誓約', target: NONE, effects: [], condition: lone(buff(3, 3, 'self')) },
  },
  {
    kind: 'creature', id: 'silver-twin-knight', name: '白銀雙子騎士', rarity: 'R', colors: ['white'], race: 'human',
    stage: 0, cost: 6, attack: 4, hp: 4, skills: [], entry: { name: '雙子', target: NONE, effects: [], condition: even(summon(SOLDIER, 2)) },
  },
  {
    kind: 'creature', id: 'centurion', name: '千人隊長', rarity: 'SR', colors: ['white'], race: 'human',
    stage: 0, cost: 5, attack: 3, hp: 5, entry: { name: '點兵', target: NONE, effects: [summon(SOLDIER)], condition: army(6, summon(SOLDIER)) },
    skills: [{ name: '衝鋒號', cost: 3, target: NONE, effects: [buff(1, 0, 'all')] }],
  },
  {
    kind: 'creature', id: 'judgment-seraph', name: '審判熾天使', rarity: 'SR', colors: ['white'], race: 'angel',
    stage: 0, cost: 7, attack: 6, hp: 6, keywords: ['shield'], skills: [],
    entry: { name: '審判', target: CREATURE, effects: [damage(5)], condition: lone(destroy) },
  },
  {
    kind: 'creature', id: 'king-of-legions', name: '萬軍之王', rarity: 'UR', colors: ['white'], race: 'human',
    stage: 0, cost: 8, attack: 6, hp: 7, entry: { name: '王師', target: NONE, effects: [summon(SOLDIER, 2)], condition: army(10, buff(2, 2, 'all')) },
    skills: [{ name: '王命', cost: 3, target: NONE, effects: [summon(SOLDIER)] }], death: { name: '遺志', effects: [summon(SOLDIER)] },
  },
  { kind: 'spell', id: 'form-ranks', name: '列隊', rarity: 'N', colors: ['white'], cost: 2, target: NONE, effects: [summon(SOLDIER)], condition: army(5, summon(SOLDIER)) },
  {
    kind: 'spell', id: 'twin-blessing', name: '雙重祝福', rarity: 'N', colors: ['white'], cost: 2,
    target: ALLY_CREATURE, effects: [buff(2, 2, 'target')], condition: even(buff(1, 1, 'all')),
  },
  {
    kind: 'spell', id: 'shield-of-light', name: '光明之盾', rarity: 'R', colors: ['white'], cost: 3,
    target: ALLY_CREATURE, effects: [{ type: 'shield', on: 'target' }, draw(1)], condition: lone({ type: 'shield', on: 'all' }),
  },
  { kind: 'spell', id: 'devout-prayer', name: '聖光禱言', rarity: 'R', colors: ['white'], cost: 1, target: NONE, effects: [heal(3)], condition: lone(draw(1)) },
  {
    kind: 'spell', id: 'oath-of-many', name: '集眾之誓', rarity: 'R', colors: ['white'], cost: 3,
    target: NONE, effects: [buff(0, 2, 'all')], condition: army(8, buff(2, 0, 'all')),
  },
  { kind: 'spell', id: 'heavenly-judgment', name: '天界審判', rarity: 'SR', colors: ['white'], cost: 6, target: NONE, effects: [aoe(3)], condition: even(aoe(2)) },

  // ── 藍：詠唱（法術越多越強）、奇數牌組、階梯 ──
  {
    kind: 'creature', id: 'spell-apprentice', name: '咒文學徒', rarity: 'N', colors: ['blue'], race: 'human', trait: 0,
    stage: 0, cost: 1, attack: 1, hp: 2, skills: [], entry: { name: '咒文', target: NONE, effects: [], condition: chant(3, draw(1)) },
  },
  {
    kind: 'creature', id: 'odd-scholar', name: '奇數學者', rarity: 'N', colors: ['blue'], race: 'human', trait: 0,
    stage: 0, cost: 3, attack: 2, hp: 4, skills: [], entry: { name: '解析', target: NONE, effects: [draw(1)], condition: odd(draw(1)) },
  },
  {
    kind: 'creature', id: 'tablet-scribe', name: '石板書記', rarity: 'N', colors: ['blue'], race: 'human', trait: 0,
    stage: 0, cost: 4, attack: 3, hp: 5, skills: [], entry: { name: '抄錄', target: NONE, effects: [draw(1)], condition: ladder(8, draw(1)) },
  },
  {
    kind: 'creature', id: 'rune-mage', name: '符文法師', rarity: 'R', colors: ['blue'], race: 'human', trait: 0,
    stage: 0, cost: 2, attack: 3, hp: 3, entry: { name: '符文', target: NONE, effects: [], condition: chant(2, draw(1)) },
    skills: [{ name: '奧術飛彈', cost: 1, target: ANY, effects: [damage(1)], condition: chant(4, damage(2)) }],
  },
  {
    kind: 'creature', id: 'odd-stargazer', name: '奇點觀星者', rarity: 'R', colors: ['blue'], race: 'elemental',
    stage: 0, cost: 5, attack: 3, hp: 5, skills: [], entry: { name: '星爆', target: ANY, effects: [damage(2)], condition: odd(damage(3)) },
  },
  {
    kind: 'creature', id: 'abyss-oddwhale', name: '深淵奇鯨', rarity: 'R', colors: ['blue'], race: 'beast', trait: 0,
    stage: 0, cost: 7, attack: 5, hp: 7, entry: { name: '潛流', target: NONE, effects: [draw(1)], condition: odd(draw(2)) },
    skills: [{ name: '潮汐', cost: 4, target: CREATURE, effects: [{ type: 'bounce' }] }],
  },
  {
    kind: 'creature', id: 'chant-archmage', name: '詠唱大法師', rarity: 'SR', colors: ['blue'], race: 'human',
    stage: 0, cost: 6, attack: 5, hp: 6, entry: { name: '詠唱', target: ANY, effects: [damage(3)], condition: chant(4, damage(3)) },
    skills: [{ name: '奧術', cost: 2, target: NONE, effects: [draw(1)] }],
  },
  {
    kind: 'creature', id: 'ladder-orrery', name: '萬階天象儀', rarity: 'SR', colors: ['blue'], race: 'machine',
    stage: 0, cost: 9, attack: 7, hp: 9, entry: { name: '星圖', target: NONE, effects: [draw(2)], condition: ladder(10, draw(2), gain) },
    skills: [hit('星軌', 4, ANY, 5)],
  },
  {
    kind: 'creature', id: 'thousand-spell-empress', name: '千咒天后', rarity: 'UR', colors: ['blue'], race: 'human',
    stage: 0, cost: 9, attack: 7, hp: 9, entry: { name: '千咒', target: NONE, effects: [draw(2)], condition: chant(5, aoe(6)) },
    skills: [{ name: '咒流', cost: 3, target: ANY, effects: [damage(3)], condition: chant(5, damage(3)) }], death: { name: '餘韻', effects: [draw(2)] },
  },
  { kind: 'spell', id: 'arcane-spark', name: '奧術火花', rarity: 'N', colors: ['blue'], cost: 1, target: ANY, effects: [damage(2)], condition: odd(damage(2)) },
  { kind: 'spell', id: 'spell-echo', name: '咒語回響', rarity: 'N', colors: ['blue'], cost: 1, target: NONE, effects: [draw(1)], condition: chant(4, draw(1)) },
  {
    kind: 'spell', id: 'frost-ring', name: '冰霜之環', rarity: 'N', colors: ['blue'], cost: 3,
    target: CREATURE, effects: [{ type: 'paralyze' }, damage(2)], condition: ladder(7, { type: 'paralyze', all: true }),
  },
  { kind: 'spell', id: 'ladder-of-knowledge', name: '知識階梯', rarity: 'R', colors: ['blue'], cost: 3, target: NONE, effects: [draw(2)], condition: ladder(9, draw(1), gain) },
  { kind: 'spell', id: 'odd-reversal', name: '奇術反轉', rarity: 'R', colors: ['blue'], cost: 3, target: CREATURE, effects: [{ type: 'bounce' }], condition: odd(draw(2)) },
  { kind: 'spell', id: 'prophecy', name: '預言', rarity: 'R', colors: ['blue'], cost: 1, target: NONE, effects: [{ type: 'lookPick', look: 3, pick: 1 }], condition: chant(3, draw(1)) },
  { kind: 'spell', id: 'spell-storm', name: '咒語風暴', rarity: 'SR', colors: ['blue'], cost: 7, target: NONE, effects: [aoe(3)], condition: chant(6, aoe(3)) },

  // ── 黑：亡魂（我方倒下越多越強）、奇數牌組、獨一 ──
  {
    kind: 'creature', id: 'crypt-rat', name: '墓穴老鼠', rarity: 'N', colors: ['black'], race: 'beast', trait: 0,
    stage: 0, cost: 1, attack: 1, hp: 2, skills: [], entry: { name: '啃食', target: NONE, effects: [], condition: souls(3, buff(2, 2, 'self')) },
  },
  {
    kind: 'creature', id: 'odd-venom-spider', name: '奇毒蜘蛛', rarity: 'N', colors: ['black'], race: 'beast', trait: 0,
    stage: 0, cost: 1, attack: 1, hp: 1, skills: [], entry: { name: '毒牙', target: CREATURE, effects: [poison(1)], condition: odd(poison(1)) },
  },
  {
    kind: 'creature', id: 'ash-caster', name: '骨灰術士', rarity: 'N', colors: ['black'], race: 'human', trait: 0,
    stage: 0, cost: 3, attack: 2, hp: 2, skills: [], entry: { name: '骨灰', target: CREATURE, effects: [poison(1)], condition: souls(3, poison(2)) },
  },
  {
    kind: 'creature', id: 'grave-colossus', name: '墳場巨像', rarity: 'N', colors: ['black'], race: 'undead', trait: 0,
    stage: 0, cost: 5, attack: 4, hp: 6, skills: [], entry: { name: '屍堆', target: NONE, effects: [], condition: souls(4, buff(3, 3, 'self')) },
  },
  {
    kind: 'creature', id: 'soul-reaper', name: '靈魂收割者', rarity: 'R', colors: ['black'], race: 'undead',
    stage: 0, cost: 3, attack: 2, hp: 3, skills: [], entry: { name: '收割', target: NONE, effects: [], condition: souls(3, draw(2)) },
  },
  {
    kind: 'creature', id: 'lone-assassin', name: '孤魂刺客', rarity: 'R', colors: ['black'], race: 'undead',
    stage: 0, cost: 5, attack: 4, hp: 3, skills: [], entry: { name: '暗殺', target: CREATURE, effects: [damage(3)], condition: lone(destroy) },
  },
  {
    kind: 'creature', id: 'corpse-behemoth', name: '屍山巨獸', rarity: 'R', colors: ['black'], race: 'undead', trait: 2,
    stage: 0, cost: 7, attack: 6, hp: 7, skills: [], entry: { name: '屍山', target: NONE, effects: [], condition: souls(5, summon(SKELETON, 3)) },
  },
  {
    kind: 'creature', id: 'soul-commander', name: '亡魂指揮官', rarity: 'SR', colors: ['black'], race: 'undead',
    stage: 0, cost: 4, attack: 3, hp: 4, entry: { name: '招魂', target: NONE, effects: [summon(SKELETON)] },
    skills: [{ name: '喚魂', cost: 3, target: NONE, effects: [summon(SKELETON)], condition: souls(4, summon(SKELETON)) }],
  },
  {
    kind: 'creature', id: 'odd-reaper', name: '奇數死神', rarity: 'SR', colors: ['black'], race: 'undead', trait: 2,
    stage: 0, cost: 9, attack: 5, hp: 6, entry: { name: '死神', target: CREATURE, effects: [destroy], condition: odd(poison(3, true)) },
    skills: [hit('收割', 4, CREATURE, 4)],
  },
  {
    kind: 'creature', id: 'styx-ferryman', name: '冥河擺渡人', rarity: 'UR', colors: ['black'], race: 'undead', trait: 2,
    stage: 0, cost: 7, attack: 4, hp: 6, entry: { name: '渡魂', target: NONE, effects: [poison(1, true)], condition: souls(6, poison(2, true)) },
    skills: [{ name: '擺渡', cost: 3, target: CREATURE, effects: [{ type: 'halveHp' }] }], death: { name: '最後一程', effects: [draw(2)] },
  },
  { kind: 'spell', id: 'whispers-of-dead', name: '亡者低語', rarity: 'N', colors: ['black'], cost: 1, target: NONE, effects: [draw(1)], condition: souls(3, draw(1)) },
  { kind: 'spell', id: 'corrosion-curse', name: '腐蝕詛咒', rarity: 'N', colors: ['black'], cost: 3, target: CREATURE, effects: [poison(2)], condition: odd(poison(2)) },
  { kind: 'spell', id: 'lone-blood-pact', name: '血之契約', rarity: 'R', colors: ['black'], cost: 2, target: CREATURE, effects: [damage(4)], condition: lone(draw(2)) },
  { kind: 'spell', id: 'odd-hex', name: '奇數詛咒', rarity: 'R', colors: ['black'], cost: 3, target: CREATURE, effects: [{ type: 'weaken' }], condition: odd({ type: 'weaken', all: true }) },
  { kind: 'spell', id: 'dance-of-death', name: '死亡之舞', rarity: 'R', colors: ['black'], cost: 5, target: CREATURE, effects: [damage(5)], condition: souls(4, destroy) },
  { kind: 'spell', id: 'soul-lament', name: '萬魂哀歌', rarity: 'SR', colors: ['black'], cost: 7, target: NONE, effects: [poison(3, true)], condition: souls(6, aoe(4)) },

  // ── 紅：詠唱、軍勢、奇數牌組；快攻與燒傷 ──
  {
    kind: 'creature', id: 'chant-spark-imp', name: '詠火小妖', rarity: 'N', colors: ['red'], race: 'elemental', trait: 0,
    stage: 0, cost: 1, attack: 2, hp: 1, skills: [], entry: { name: '火花', target: ANY, effects: [], condition: chant(2, damage(2)) },
  },
  {
    kind: 'creature', id: 'rage-warrior', name: '狂焰戰士', rarity: 'N', colors: ['red'], race: 'human', trait: 0,
    stage: 0, cost: 3, attack: 4, hp: 2, skills: [], entry: { name: '狂焰', target: NONE, effects: [], condition: army(4, buff(2, 0, 'self')) },
  },
  {
    kind: 'creature', id: 'odd-berserker', name: '奇焰狂戰士', rarity: 'N', colors: ['red'], race: 'beast', trait: 0,
    stage: 0, cost: 5, attack: 5, hp: 5, skills: [], entry: { name: '狂化', target: NONE, effects: [], condition: odd(buff(2, 2, 'self')) },
  },
  {
    kind: 'creature', id: 'spell-flamer', name: '咒火法師', rarity: 'R', colors: ['red'], race: 'human', trait: 0,
    stage: 0, cost: 2, attack: 2, hp: 2, keywords: ['haste'],
    skills: [{ name: '火舌', cost: 1, target: ANY, effects: [damage(1)], condition: chant(4, damage(2)) }],
  },
  {
    kind: 'creature', id: 'odd-fire-sprite', name: '奇數火精', rarity: 'R', colors: ['red'], race: 'elemental',
    stage: 0, cost: 3, attack: 3, hp: 2, skills: [], entry: { name: '火精', target: ANY, effects: [damage(1)], condition: odd(damage(2)) },
  },
  {
    kind: 'creature', id: 'flame-vanguard', name: '烈焰突擊兵', rarity: 'R', colors: ['red'], race: 'human',
    stage: 0, cost: 4, attack: 4, hp: 3, skills: [], entry: { name: '增援', target: NONE, effects: [], condition: army(5, summon(FIRE_SPIRIT, 2)) },
  },
  {
    kind: 'creature', id: 'blast-magus', name: '爆裂魔導', rarity: 'R', colors: ['red'], race: 'human', trait: 0,
    stage: 0, cost: 6, attack: 4, hp: 5, entry: { name: '爆裂', target: NONE, effects: [aoe(1)], condition: chant(5, aoe(2)) },
    skills: [hit('爆炎', 3, ANY, 4)],
  },
  {
    kind: 'creature', id: 'chain-arsonist', name: '連環縱火者', rarity: 'SR', colors: ['red'], race: 'human',
    stage: 0, cost: 5, attack: 4, hp: 4, keywords: ['haste'], skills: [],
    entry: { name: '縱火', target: ANY, effects: [damage(2)], condition: chant(6, damage(4)) },
  },
  {
    kind: 'creature', id: 'odd-flame-dragon', name: '奇數炎龍', rarity: 'SR', colors: ['red'], race: 'dragon',
    stage: 0, cost: 7, attack: 6, hp: 5, keywords: ['haste'], skills: [], entry: { name: '龍焰', target: NONE, effects: [], condition: odd(aoe(3)) },
  },
  {
    kind: 'creature', id: 'sky-burning-demon', name: '焚天魔王', rarity: 'UR', colors: ['red'], race: 'elemental', trait: 2,
    stage: 0, cost: 9, attack: 7, hp: 6, keywords: ['haste'], entry: { name: '焚天', target: ANY, effects: [damage(3)], condition: chant(8, damage(5)) },
    skills: [{ name: '煉獄', cost: 5, target: NONE, effects: [aoe(3)] }],
  },
  { kind: 'spell', id: 'fire-spark', name: '火花術', rarity: 'N', colors: ['red'], cost: 1, target: ANY, effects: [damage(2)], condition: odd(damage(1)) },
  { kind: 'spell', id: 'chain-lightning', name: '連鎖閃電', rarity: 'N', colors: ['red'], cost: 2, target: ANY, effects: [damage(2)], condition: chant(3, damage(2)) },
  { kind: 'spell', id: 'army-war-cry', name: '軍勢戰吼', rarity: 'N', colors: ['red'], cost: 3, target: NONE, effects: [buff(1, 0, 'all')], condition: army(6, buff(2, 0, 'all')) },
  { kind: 'spell', id: 'fire-rain', name: '火雨', rarity: 'R', colors: ['red'], cost: 4, target: NONE, effects: [aoe(2)], condition: chant(5, aoe(2)) },
  { kind: 'spell', id: 'blast-shell', name: '爆炎彈', rarity: 'R', colors: ['red'], cost: 5, target: ANY, effects: [damage(5)], condition: odd(damage(3)) },
  { kind: 'spell', id: 'doom-firestorm', name: '末日火雨', rarity: 'SR', colors: ['red'], cost: 9, target: HERO, effects: [aoe(5), damage(4)], condition: odd(aoe(3)) },

  // ── 綠：階梯（大費用的卡也要帶）、偶數牌組、軍勢 ──
  {
    kind: 'creature', id: 'sprout-guard', name: '嫩芽守衛', rarity: 'N', colors: ['green'], race: 'plant', trait: 0,
    stage: 0, cost: 2, attack: 2, hp: 3, skills: [], entry: { name: '萌芽', target: NONE, effects: [], condition: even(buff(2, 2, 'self')) },
  },
  {
    kind: 'creature', id: 'thorn-hedgehog', name: '荊棘刺蝟', rarity: 'N', colors: ['green'], race: 'beast', trait: 0,
    stage: 0, cost: 3, attack: 3, hp: 3, skills: [], entry: { name: '豎刺', target: NONE, effects: [], condition: army(4, buff(1, 1, 'self'), taunt) },
  },
  {
    kind: 'creature', id: 'grove-elk', name: '林間巨鹿', rarity: 'N', colors: ['green'], race: 'beast', trait: 0,
    stage: 0, cost: 4, attack: 3, hp: 4, skills: [], entry: { name: '登高', target: NONE, effects: [], condition: ladder(8, buff(2, 2, 'self')) },
  },
  { kind: 'creature', id: 'mossstone-giant', name: '苔石巨人', rarity: 'N', colors: ['green'], race: 'plant', trait: 2, stage: 0, cost: 6, attack: 4, hp: 8, skills: [] },
  {
    kind: 'creature', id: 'vine-weaver', name: '藤蔓術士', rarity: 'R', colors: ['green'], race: 'human', trait: 0,
    stage: 0, cost: 2, attack: 2, hp: 2, entry: { name: '纏繞', target: NONE, effects: [], condition: even(gain) },
    skills: [{ name: '生長', cost: 2, target: ALLY_CREATURE, effects: [buff(1, 1, 'target')] }],
  },
  {
    kind: 'creature', id: 'pack-leader-wolf', name: '群狼首領', rarity: 'R', colors: ['green'], race: 'beast',
    stage: 0, cost: 4, attack: 3, hp: 4, skills: [], entry: { name: '狼嚎', target: NONE, effects: [], condition: army(6, buff(2, 2, 'self')) },
  },
  {
    kind: 'creature', id: 'even-elder-tree', name: '偶數古樹', rarity: 'R', colors: ['green'], race: 'plant', trait: 2,
    stage: 0, cost: 6, attack: 4, hp: 8, skills: [], entry: { name: '古木', target: NONE, effects: [], condition: even(heal(6), gain) },
  },
  {
    kind: 'creature', id: 'ladder-wyrm', name: '階梯巨龍', rarity: 'SR', colors: ['green'], race: 'dragon',
    stage: 0, cost: 8, attack: 7, hp: 7, entry: { name: '龍威', target: NONE, effects: [], condition: ladder(9, aoe(3)) },
    skills: [hit('龍吼', 4, CREATURE, 5)],
  },
  {
    kind: 'creature', id: 'world-tree-heart', name: '世界樹之心', rarity: 'SR', colors: ['green'], race: 'plant', trait: 3,
    stage: 0, cost: 10, attack: 6, hp: 12, entry: { name: '萬物', target: NONE, effects: [gain], condition: even(draw(3)) },
    skills: [{ name: '生命', cost: 2, target: NONE, effects: [healAll(3)] }],
  },
  {
    kind: 'creature', id: 'titan-of-all', name: '萬象泰坦', rarity: 'UR', colors: ['green'], race: 'elemental',
    stage: 0, cost: 12, attack: 11, hp: 11, regenerate: 1, entry: { name: '萬象', target: NONE, effects: [], condition: ladder(10, aoe(6)) },
    skills: [{ name: '震地', cost: 5, target: NONE, effects: [aoe(3)] }],
  },
  {
    kind: 'spell', id: 'even-wild-growth', name: '雙生滋長', rarity: 'N', colors: ['green'], cost: 2,
    target: ALLY_CREATURE, effects: [buff(2, 2, 'target')], condition: even(buff(1, 1, 'target')),
  },
  { kind: 'spell', id: 'stampede', name: '獸群奔騰', rarity: 'N', colors: ['green'], cost: 4, target: NONE, effects: [summon(SPROUT, 2)], condition: army(6, buff(1, 1, 'all')) },
  { kind: 'spell', id: 'seed-sprout', name: '種子萌發', rarity: 'R', colors: ['green'], cost: 2, target: NONE, effects: [gain], condition: ladder(8, draw(1)) },
  { kind: 'spell', id: 'growth-rite', name: '生長儀式', rarity: 'R', colors: ['green'], cost: 3, target: NONE, effects: [buff(1, 1, 'all')], condition: army(6, buff(1, 1, 'all')) },
  { kind: 'spell', id: 'wrath-of-earth', name: '偶數地裂', rarity: 'R', colors: ['green'], cost: 6, target: CREATURE, effects: [damage(8)], condition: even(draw(1)) },
  {
    kind: 'spell', id: 'all-grows', name: '萬物生長', rarity: 'SR', colors: ['green'], cost: 8,
    target: NONE, effects: [buff(2, 2, 'all'), draw(1)], condition: ladder(10, buff(2, 2, 'all'), draw(2)),
  },

  // ── 無色：各種條件的小零件 ──
  {
    kind: 'creature', id: 'odd-automaton', name: '奇數機兵', rarity: 'N', colors: [], race: 'machine', trait: 0,
    stage: 0, cost: 1, attack: 1, hp: 1, skills: [], entry: { name: '奇數', target: NONE, effects: [], condition: odd(buff(2, 2, 'self')) },
  },
  {
    kind: 'creature', id: 'even-automaton', name: '偶數機兵', rarity: 'N', colors: [], race: 'machine', trait: 0,
    stage: 0, cost: 2, attack: 1, hp: 2, skills: [], entry: { name: '偶數', target: NONE, effects: [], condition: even(buff(2, 2, 'self')) },
  },
  {
    kind: 'creature', id: 'wandering-bard', name: '流浪詩人', rarity: 'N', colors: [], race: 'human', trait: 0,
    stage: 0, cost: 3, attack: 2, hp: 3, skills: [], entry: { name: '吟遊', target: NONE, effects: [], condition: chant(3, draw(1)) },
  },
  {
    kind: 'creature', id: 'mercenary-captain', name: '傭兵隊長', rarity: 'N', colors: [], race: 'human', trait: 0,
    stage: 0, cost: 4, attack: 3, hp: 4, skills: [], entry: { name: '招募', target: NONE, effects: [], condition: army(5, summon(SOLDIER)) },
  },
  {
    kind: 'creature', id: 'lone-ranger', name: '獨行俠', rarity: 'R', colors: [], race: 'human',
    stage: 0, cost: 3, attack: 3, hp: 3, skills: [], entry: { name: '獨行', target: NONE, effects: [], condition: lone(draw(2)) },
  },
  {
    kind: 'creature', id: 'trial-guardian', name: '試煉守護者', rarity: 'R', colors: [], race: 'machine',
    stage: 0, cost: 5, attack: 3, hp: 6, skills: [], entry: { name: '試煉', target: NONE, effects: [], condition: ladder(8, buff(3, 3, 'self'), taunt) },
  },
  {
    kind: 'creature', id: 'odd-golem', name: '奇數石像', rarity: 'R', colors: [], race: 'machine',
    stage: 0, cost: 7, attack: 5, hp: 7, skills: [], entry: { name: '奇爆', target: NONE, effects: [], condition: odd(aoe(3)) },
  },
  {
    kind: 'creature', id: 'even-golem', name: '雙生石像', rarity: 'R', colors: [], race: 'machine',
    stage: 0, cost: 8, attack: 6, hp: 8, skills: [], entry: { name: '雙生', target: NONE, effects: [], condition: even(buff(2, 2, 'all')) },
  },
  {
    kind: 'creature', id: 'ladder-colossus', name: '萬階巨像', rarity: 'SR', colors: [], race: 'machine',
    stage: 0, cost: 10, attack: 9, hp: 10, entry: { name: '登頂', target: NONE, effects: [], condition: ladder(10, draw(3), gain) },
    skills: [hit('碾壓', 4, CREATURE, 6)],
  },
  { kind: 'spell', id: 'wheel-of-fate', name: '命運之輪', rarity: 'SR', colors: [], cost: 6, target: NONE, effects: [draw(2)], condition: lone(draw(2), heal(5)) },

  // ── 多色：每個新英雄一張 ──
  {
    kind: 'creature', id: 'odd-gate-wisp', name: '奇門鬼火', rarity: 'SR', colors: ['blue', 'black', 'red'], race: 'elemental',
    stage: 0, cost: 5, attack: 4, hp: 5, entry: { name: '鬼火', target: ANY, effects: [damage(2)], condition: odd(damage(1)) },
    skills: [{ name: '幽焰', cost: 3, target: CREATURE, effects: [poison(2)] }],
  },
  {
    kind: 'creature', id: 'twin-aspect-spirit', name: '兩儀守護靈', rarity: 'SR', colors: ['white', 'blue', 'green'], race: 'angel',
    stage: 0, cost: 4, attack: 2, hp: 4, entry: { name: '守護', target: NONE, effects: [], condition: even({ type: 'shield', on: 'all' }) },
    skills: [{ name: '祝福', cost: 3, target: ALLY_CREATURE, effects: [buff(1, 1, 'target')] }],
  },
  {
    kind: 'creature', id: 'legion-standard', name: '萬軍旗手', rarity: 'UR', colors: ['white', 'black', 'red'], race: 'human',
    stage: 0, cost: 6, attack: 4, hp: 5, entry: { name: '揚旗', target: NONE, effects: [summon(SOLDIER)], condition: army(6, buff(2, 0, 'all')) },
    skills: [{ name: '督戰', cost: 4, target: NONE, effects: [buff(1, 0, 'all')] }], death: { name: '旗倒', effects: [summon(SOLDIER, 2)] },
  },
  {
    kind: 'creature', id: 'stair-dragon', name: '登階龍', rarity: 'UR', colors: ['blue', 'red', 'green'], race: 'dragon',
    stage: 0, cost: 8, attack: 5, hp: 7, keywords: ['haste'], entry: { name: '登階', target: NONE, effects: [draw(1)], condition: ladder(9, aoe(3)) },
    skills: [hit('吐息', 4, ANY, 4)],
  },
  {
    kind: 'creature', id: 'lone-star-ranger', name: '孤星遊俠', rarity: 'SR', colors: ['white', 'black', 'green'], race: 'human',
    stage: 0, cost: 5, attack: 5, hp: 4, entry: { name: '孤星', target: NONE, effects: [], condition: lone(buff(2, 2, 'self'), { type: 'shield', on: 'self' }) },
    skills: [hit('斬擊', 3, CREATURE, 3)],
  },

  // ── 英雄進化 ──（奇門天師 5 費，放得進奇數牌組）
  {
    kind: 'heroEvolution', id: 'odd-gate-sage', name: '奇門天師', rarity: 'UR', colors: ['blue', 'black', 'red'],
    cost: 5, evolvesFrom: 'odd-gate-mage', hpBonus: 9,
    entry: { name: '天雷', target: ANY, effects: [damage(2)], condition: odd(damage(2)) },
    power: { name: '奇術', cost: 2, target: ANY, effects: [damage(2)], condition: odd(damage(1)) },
  },
  {
    kind: 'heroEvolution', id: 'twin-aspect-empress', name: '兩儀天后', rarity: 'UR', colors: ['white', 'blue', 'green'],
    cost: 6, evolvesFrom: 'twin-aspect-saint', hpBonus: 10,
    entry: { name: '陰陽', target: NONE, effects: [buff(1, 1, 'all'), draw(1)], condition: even(draw(2)) },
    power: { name: '兩儀', cost: 2, target: NONE, effects: [healAll(3)], condition: even(draw(1)) },
  },
  {
    kind: 'heroEvolution', id: 'legion-generalissimo', name: '萬軍統帥', rarity: 'UR', colors: ['white', 'black', 'red'],
    cost: 6, evolvesFrom: 'legion-marshal', hpBonus: 10,
    entry: { name: '大軍', target: NONE, effects: [summon(SOLDIER, 2)] },
    power: { name: '點兵', cost: 3, target: NONE, effects: [summon(SOLDIER)], condition: army(8, buff(1, 1, 'all')) },
  },
  {
    kind: 'heroEvolution', id: 'stair-sage', name: '登天聖者', rarity: 'UR', colors: ['blue', 'red', 'green'],
    cost: 6, evolvesFrom: 'stair-walker', hpBonus: 10,
    entry: { name: '登天', target: NONE, effects: [gain, draw(2)] },
    power: { name: '登階', cost: 1, target: NONE, effects: [draw(1)], condition: ladder(9, gain) },
  },
  {
    kind: 'heroEvolution', id: 'lone-star-saint', name: '孤星劍聖', rarity: 'UR', colors: ['white', 'black', 'green'],
    cost: 6, evolvesFrom: 'lone-star-blade', hpBonus: 9,
    entry: { name: '孤星斬', target: CREATURE, effects: [destroy], condition: lone(draw(1)) },
    power: { name: '孤星', cost: 2, target: CREATURE, effects: [damage(2)], condition: lone(damage(1)) },
  },
];

export const TRIALS_CARDS: DeckCardDef[] = CARDS.map((card) => ({ ...card, set: 'trials' }));
export const TRIALS_HEROES: HeroDef[] = HEROES.map((hero) => ({ ...hero, set: 'trials' }));

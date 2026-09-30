import { traitOf } from './queries';
import type {
  Ability,
  CardDb,
  Color,
  Condition,
  ConditionalEffects,
  CreatureDef,
  CreatureModifier,
  DeathEffect,
  DeckCardDef,
  EntryEffect,
  Effect,
  HeroDef,
  HeroPassive,
  Race,
  TargetSpec,
  TriggeredEffect,
  TriggerWhen,
} from './types';

// 卡面文字由資料產生，不另外手寫，資料和說明才不會對不上。
// 常見的效果寫成關鍵字（**中毒 2**、**遺言**），用 ** 包起來表示粗體；關鍵字的意思由 explainKeywords 另外列出。

export const COLOR_NAMES: Record<Color, string> = { white: '白', blue: '藍', black: '黑', red: '紅', green: '綠' };

export const RACE_NAMES: Record<Race, string> = {
  human: '人類',
  beast: '野獸',
  undead: '亡靈',
  elemental: '元素',
  plant: '植物',
  dragon: '龍',
  machine: '機械',
  angel: '天使',
};

/** 每個種族特色的名字。 */
export const TRAIT_NAMES: Record<Race, string> = {
  human: '同袍',
  beast: '猛撲',
  undead: '不死',
  elemental: '元素之力',
  plant: '再生', // 植物的種族特色就是再生（以前叫扎根，效果一樣）
  dragon: '龍鱗',
  machine: '堅固',
  angel: '光輝',
};

/** 沒有強度的種族特色：有或沒有。 */
const UNSCALED: ReadonlySet<Race> = new Set<Race>(['beast', 'dragon']);

/** 粗體的關鍵字。 */
const keyword = (name: string) => `**${name}**`;

/** 關鍵字的意思；N 換成卡上的數字。 */
export const KEYWORDS: Record<string, string> = {
  同袍: '我方場上有其他人類時 ⚔ +N',
  猛撲: '召喚當回合就能攻擊生物（不能打英雄）',
  不死: '第一次被打倒時留下 N♥',
  元素之力: '技能、進場與遺言的傷害 +N',
  龍鱗: '不會中異常狀態',
  堅固: '受到的傷害 −N',
  光輝: '召喚時你的英雄回復 N♥',
  速攻: '召喚當回合就能攻擊或發動技能；進化卡都有速攻，召喚當回合也能進化，進化完馬上能動',
  吸血: '牠造成傷害時（攻擊、反擊、技能），你的英雄回復等量的 ♥',
  再生: '你的回合開始時回復 N♥',
  進場: '召喚時（或進化成這張時）發動',
  遺言: '死掉時發動（被打倒或被消滅）；沉默中死掉就不發動',
  覺醒: '你的能量上限 8 以上時，多發動這一段（目標跟前面一樣）',
  連擊: '這回合你已經打出過別的牌（生物、進化、法術、道具、場地、英雄進化）時，多發動這一段',
  聖盾: '第一次受到傷害時，傷害變成 0，聖盾消失（中毒、HP 減半、消滅擋不住；沉默會拿掉聖盾）',
  奇數牌組: '開局的牌組每張卡的費用都是奇數時，多發動這一段',
  偶數牌組: '開局的牌組每張卡的費用都是偶數時，多發動這一段',
  階梯: '開局的牌組有 N 種以上不同費用的卡時，多發動這一段',
  獨一: '開局的牌組沒有同名的卡時，多發動這一段',
  軍勢: '本局你召喚過 N 隻以上生物（包括這一隻，衍生物也算）時，多發動這一段',
  詠唱: '本局你施放過 N 個以上法術（包括這一個）時，多發動這一段',
  亡魂: '本局我方有 N 隻以上生物倒下（衍生物也算）時，多發動這一段',
  回合開始: '在場上時，你的每個回合開始時發動（抽牌之後）',
  回合結束: '在場上時，你的每個回合結束時發動',
  每當回復: '在場上時，每當你的英雄回復 ♥ 就發動',
  每當召喚: '在場上時，每當你召喚後面寫的那種族的生物（衍生物也算，不含牠自己）就發動',
  挑釁: '對手下回合打得到牠的攻擊與單體技能，都必須先打牠',
  中毒: '施放者的每個回合結束時失去 N♥（不算傷害，減傷擋不住；再中一次相加）',
  灼燒: '施放者的每個回合結束時受到 N 傷害（再中一次取大的）',
  麻痺: '到牠的下個回合結束前不能攻擊、不能發動技能',
  沉默: '到牠的下個回合結束前不能發動技能、卡上的效果失效（攻擊照常）；身上的增益與挑釁消失',
  虛弱: '到牠的下個回合結束前不能攻擊，也不會反擊（技能照常）',
  消滅: '直接送進棄牌區，不看 HP、不算傷害',
  休息: '不花能量；這回合還沒攻擊才能用，用了就不能攻擊',
  增益: '⚔ 與 ♥ 上限各 +N（指示物，進化後保留）',
  突破: '我方生物攻擊時，正前方與斜對角都被擋住也打得到英雄',
  衍生物: '只能由效果召喚，不能放進牌組；離場就消失',
};

/** 一個關鍵字（例如「中毒 2」）的意思，數字帶進去；不是關鍵字就是 null。 */
export function explainKeyword(word: string): string | null {
  const [, name = word, n] = /^(.+?)(?: (\d+))?$/.exec(word) ?? [];
  const text = KEYWORDS[name];
  if (!text) return null;
  return n ? text.replaceAll('N', n) : text;
}

/** 這幾行說明裡出現的關鍵字，各自一行解釋，例如「**中毒 2**：施放者的每個回合結束時失去 2♥……」。 */
export function explainKeywords(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    for (const [, word] of line.matchAll(/\*\*([^*]+)\*\*/g)) {
      if (word === undefined || seen.has(word)) continue;
      seen.add(word);
      const text = explainKeyword(word);
      if (text) out.push(`${keyword(word)}：${text}`);
    }
  }
  return out;
}

/** 卡上的種族特色，例如「**同袍 2**」「**猛撲**」；沒有就是 null。 */
export function describeTrait(card: CreatureDef): string | null {
  const level = traitOf(card);
  if (card.race === undefined || level === 0) return null;
  return keyword(UNSCALED.has(card.race) ? TRAIT_NAMES[card.race] : `${TRAIT_NAMES[card.race]} ${level}`);
}

export const describeColors = (colors: readonly Color[]): string =>
  colors.length === 0 ? '無色' : colors.map((color) => COLOR_NAMES[color]).join('');

export function describeTarget(spec: TargetSpec): string | null {
  switch (spec.kind) {
    case 'none':
      return null;
    case 'enemy':
      return { any: '任意目標', creature: '只打生物', hero: '只打英雄' }[spec.allow];
    case 'lane':
      return spec.lane === 'opposite' ? '正對面' : '斜對角';
    case 'ally':
      return spec.allow === 'any' ? '我方單位' : '我方生物';
    case 'enemyItem':
      return '對手的道具';
    case 'enemyItemOrField':
      return '對手的道具或場地卡';
  }
}

/** 把卡牌 id 換成名字；召喚衍生物的說明用得到。card：查卡片資料（進化生物要知道基礎形態的數值）。 */
export type Names = ((id: string) => string) & { card?: (id: string) => DeckCardDef | undefined };
const ids: Names = (id) => id;

/** 卡牌 id 換成名字；衍生物帶上數值（例如「烈陽騎兵（1/1、速攻）」），看得出召喚出來的是什麼。 */
export function cardNames(db: CardDb): Names {
  const names: Names = (id) => {
    const card = db.cards.get(id);
    if (card?.kind === 'creature' && card.token) return `${card.name}（${card.attack}/${card.hp}${card.keywords?.includes('haste') ? `、${keyword('速攻')}` : ''}）`;
    return card?.name ?? db.heroes.get(id)?.name ?? id;
  };
  names.card = (id) => db.cards.get(id);
  return names;
}

/** 進化生物比基礎形態多了多少（進化時照這個加上去，已受的傷害與指示物保留）；不是進化生物或查不到基礎形態就是 null。 */
export function evolutionGain(card: DeckCardDef, base: DeckCardDef | undefined): { attack: number; hp: number } | null {
  if (card.kind !== 'creature' || card.stage === 0 || base?.kind !== 'creature') return null;
  return { attack: card.attack - base.attack, hp: card.hp - base.hp };
}

/** +3、-1、+0。 */
export const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

/** 傷害的數字；有加成（元素之力）時寫成「7 (+1)」。 */
const amountWith = (amount: number, bonus: number) => (bonus > 0 ? `${amount} (+${bonus})` : `${amount}`);

/** 生物的技能、進場、遺言與持續效果多造成的傷害：元素之力 N。 */
export const damageBonus = (card: CreatureDef): number => (card.race === 'elemental' ? traitOf(card) : 0);

/** bonus：這個效果的傷害加成（元素之力），寫在數字後面的括號裡。 */
export function describeEffect(effect: Effect, names: Names = ids, bonus = 0): string {
  switch (effect.type) {
    case 'summonToken':
      return `召喚 ${effect.count} 隻${names(effect.token)}`;
    case 'damage':
      return `造成 ${amountWith(effect.amount, bonus)} 傷害`;
    case 'damageEnemyCreatures':
      return `對手每隻生物各受 ${amountWith(effect.amount, bonus)} 傷害`;
    case 'handDamage':
      // 元素之力的加成一樣寫在括號裡：「造成等同你手牌張數的傷害（+1）」。
      return `造成等同你手牌張數${effect.bonus ? ` +${effect.bonus}` : ''}的傷害${bonus > 0 ? `（+${bonus}）` : ''}`;
    case 'bounce':
      return `${effect.all ? '對手每隻生物' : ''}回到手牌`;
    case 'draw':
      return `抽 ${effect.count} 張牌`;
    case 'opponentDiscardRandom':
      return `對手隨機棄 ${effect.count} 張手牌`;
    case 'heal':
      return `回復 ${effect.amount}♥`;
    case 'healAll':
      return `我方英雄與每隻生物各回復 ${effect.amount}♥`;
    case 'healHero':
      return `我方英雄回復 ${effect.amount}♥`;
    case 'destroyCreature':
      return keyword('消滅');
    case 'lookPick':
      return `看牌庫頂 ${effect.look} 張，選 ${effect.pick} 張加入手牌，其餘放回牌庫底`;
    case 'halveHp':
      return `${effect.all ? '對手每隻生物' : ''}剩餘 ♥ 減半`;
    case 'taunt':
      return keyword('挑釁');
    case 'shield': {
      const who = effect.on === 'self' ? '自身' : effect.on === 'all' ? '我方每隻生物' : '';
      return `${who}${keyword('聖盾')}`;
    }
    case 'buff': {
      const who = effect.on === 'self' ? '自身' : effect.on === 'all' ? '我方每隻生物' : '目標';
      if (effect.attack === effect.hp) return `${who}${keyword(`增益 ${effect.attack}`)}`;
      const parts: string[] = [];
      if (effect.attack > 0) parts.push(`⚔ +${effect.attack}`);
      if (effect.hp > 0) parts.push(`♥ 上限 +${effect.hp}`);
      return `${who} ${parts.join('、')}`;
    }
    case 'gainMaxEnergy':
      return `能量上限 +${effect.amount}`;
    case 'raiseCeiling':
      return `最高上限 +${effect.amount}`;
    case 'destroy':
      return '破壞';
    case 'searchEvolution':
      return '從牌庫把自己的進化卡加入手牌';
    case 'evolveFromDeck':
      return '用牌庫裡自己的進化卡直接進化';
    case 'poison':
      return `${effect.all ? '對手每隻生物' : ''}${keyword(`中毒 ${effect.amount}`)}`;
    case 'burn':
      return `${effect.all ? '對手每隻生物' : ''}${keyword(`灼燒 ${effect.amount}`)}`;
    case 'paralyze':
      return `${effect.all ? '對手每隻生物' : ''}${keyword('麻痺')}`;
    case 'silence':
      return `${effect.all ? '對手每隻生物' : ''}${keyword('沉默')}`;
    case 'weaken':
      return `${effect.all ? '對手每隻生物' : ''}${keyword('虛弱')}`;
  }
}

/** 目標與效果：「〔任意目標〕造成 7 傷害」。 */
export function describeEffects(ability: Omit<Ability, 'cost'>, names: Names = ids, bonus = 0): string {
  const target = describeTarget(ability.target);
  return `${target === null ? '' : `〔${target}〕`}${ability.effects.map((effect) => describeEffect(effect, names, bonus)).join('，')}`;
}

/** 技能與天生技：「火花（能量 2）：〔斜對角〕造成 7 傷害」。 */
export function describeAbility(ability: Ability, names: Names = ids, bonus = 0): string {
  // 費用：能量（只付能量上限、或休息技能不花能量時不寫）、能量上限 −N、休息、每局次數。
  const parts: string[] = [];
  if (ability.cost > 0 || (!ability.rest && !ability.maxEnergyCost)) parts.push(`能量 ${ability.cost}`);
  if (ability.maxEnergyCost) parts.push(`能量上限 −${ability.maxEnergyCost}`);
  if (ability.rest) parts.push(keyword('休息'));
  if (ability.uses) parts.push(`每局 ${ability.uses} 次`);
  return `${ability.name}（${parts.join('，')}）：${describeEffects(ability, names, bonus)}${describeCombo(ability.combo, names, bonus)}${describeCondition(ability.condition, names, bonus)}`;
}

/** 進場效果：「**進場** 火星：〔任意目標〕造成 2 傷害」。 */
export function describeEntry(entry: EntryEffect, names: Names = ids, bonus = 0): string {
  // 只有連擊（或條件）才有效果的進場：「**進場** 暗刃：**連擊**時〔只打生物〕造成 3 傷害」。
  const only = entry.effects.length === 0 ? (entry.combo?.length ? { label: '連擊', effects: entry.combo } : entry.condition ? { label: conditionLabel(entry.condition.when), effects: entry.condition.effects } : null) : null;
  if (only) {
    const target = describeTarget(entry.target);
    return `${keyword('進場')} ${entry.name}：${keyword(only.label)}時${target === null ? '' : `〔${target}〕`}${only.effects
      .map((effect) => describeEffect(effect, names, bonus))
      .join('，')}`;
  }
  return `${keyword('進場')} ${entry.name}：${describeEffects(entry, names, bonus)}${describeAwaken(entry.awaken, names, bonus)}${describeCombo(entry.combo, names, bonus)}${describeCondition(entry.condition, names, bonus)}`;
}

/** 條件的關鍵字：「奇數牌組」「階梯 10」「軍勢 6」…… */
export function conditionLabel(when: Condition): string {
  switch (when.kind) {
    case 'odd':
      return '奇數牌組';
    case 'even':
      return '偶數牌組';
    case 'costs':
      return `階梯 ${when.count}`;
    case 'singleton':
      return '獨一';
    case 'summoned':
      return `軍勢 ${when.count}`;
    case 'spells':
      return `詠唱 ${when.count}`;
    case 'fallen':
      return `亡魂 ${when.count}`;
  }
}

/**
 * 覺醒、連擊、條件那一段：「；**覺醒**：再造成 3 傷害」。這一段是多出來的，造成、抽、召喚前面加「再」，
 * 不然「**奇數牌組**：造成 1 傷害」看起來像是改成 1 傷害。
 */
const describeExtra = (label: string, effects: readonly Effect[] | undefined, names: Names, bonus = 0) =>
  effects?.length
    ? `；${keyword(label)}：${effects
        .map((effect, i) => {
          const text = describeEffect(effect, names, bonus);
          return i === 0 && /^(造成|抽|召喚)/.test(text) ? `再${text}` : text;
        })
        .join('，')}`
    : '';
const describeAwaken = (awaken: readonly Effect[] | undefined, names: Names, bonus = 0) => describeExtra('覺醒', awaken, names, bonus);
const describeCombo = (combo: readonly Effect[] | undefined, names: Names, bonus = 0) => describeExtra('連擊', combo, names, bonus);
/** 條件那一段：「；**奇數牌組**：再造成 3 傷害」。 */
const describeCondition = (condition: ConditionalEffects | undefined, names: Names, bonus = 0) =>
  condition ? describeExtra(conditionLabel(condition.when), condition.effects, names, bonus) : '';

/** 遺言：「**遺言** 傳承：召喚 1 隻士兵（2/2）」。 */
export const describeDeath = (death: DeathEffect, names: Names = ids, bonus = 0): string =>
  `${keyword('遺言')} ${death.name}：${death.effects.map((effect) => describeEffect(effect, names, bonus)).join('，')}`;

/** 持續效果的關鍵字。 */
const TRIGGER_NAMES: Record<TriggerWhen, string> = { turnStart: '回合開始', turnEnd: '回合結束', heroHealed: '每當回復', allySummoned: '每當召喚' };

/** 持續效果：「**回合結束** 觀星：抽 1 張牌」「**每當召喚**亡靈 守墓：抽 1 張牌」。 */
export const describeTrigger = (trigger: TriggeredEffect, names: Names = ids, bonus = 0): string =>
  `${keyword(TRIGGER_NAMES[trigger.when])}${trigger.race ? RACE_NAMES[trigger.race] : ''} ${trigger.name}：${trigger.effects
    .map((effect) => describeEffect(effect, names, bonus))
    .join('，')}`;

/** 種族特色與關鍵字放在同一行：「**同袍 2**、**速攻**、**吸血**」。 */
function describeTraits(card: CreatureDef): string[] {
  const words: string[] = [];
  // 植物的種族特色就是再生：卡上另外寫的再生合在一起，寫成一個「再生 N」。
  const plantRegen = card.race === 'plant' ? traitOf(card) : 0;
  const trait = plantRegen > 0 ? null : describeTrait(card);
  if (trait) words.push(trait);
  // 進化卡都有速攻。
  if (card.keywords?.includes('haste') || card.evolvesFrom !== undefined) words.push(keyword('速攻'));
  if (card.keywords?.includes('lifesteal')) words.push(keyword('吸血'));
  if (card.keywords?.includes('shield')) words.push(keyword('聖盾'));
  const regenerate = plantRegen + (card.regenerate ?? 0);
  if (regenerate > 0) words.push(keyword(`再生 ${regenerate}`));
  return words.length > 0 ? [words.join('、')] : [];
}

/** 「我方生物 ⚔ +1、♥ 上限 +2」這類持續加成的說明。 */
function describeModifier(modifier: CreatureModifier | undefined): string[] {
  const parts: string[] = [];
  if (modifier?.attack) parts.push(`⚔ +${modifier.attack}`);
  if (modifier?.hp) parts.push(`♥ 上限 +${modifier.hp}`);
  if (modifier?.damageReduction) parts.push(`受到傷害 −${modifier.damageReduction}`);
  if (modifier?.regenerate) parts.push(keyword(`再生 ${modifier.regenerate}`));
  return parts;
}

/** 「我方生物 ⚔ +1」；符號或關鍵字開頭的（⚔、♥、**再生 1**）前面空一格。 */
const ourCreatures = (parts: string[]) => {
  const text = parts.join('、');
  return `我方生物${/^[A-Za-z⚔♥*]/.test(text) ? ' ' : ''}${text}`;
};

function describeOwnEffects(creatures: CreatureModifier | undefined, ceilingBonus: number | undefined): string {
  const parts: string[] = [];
  const modifier = describeModifier(creatures);
  if (modifier.length > 0) parts.push(ourCreatures(modifier));
  if (ceilingBonus) parts.push(`我方最高上限 +${ceilingBonus}`);
  return parts.join('；');
}

/** 場地卡在自己回合開始時的效果。 */
function describeFieldTriggers(field: Extract<DeckCardDef, { kind: 'field' }>): string[] {
  const lines: string[] = [];
  if (field.extraDraw) lines.push(`你的回合開始時多抽 ${field.extraDraw} 張`);
  if (field.heroRegenerate) lines.push(`你的回合開始時，你的英雄回復 ${field.heroRegenerate}♥`);
  if (field.enemyDecay) {
    const drain = field.lifesteal ? `，你的英雄回復等量的 ♥（${keyword('吸血')}）` : '';
    lines.push(`你的回合開始時，對手每隻生物失去 ${field.enemyDecay}♥${drain}`);
  }
  return lines;
}


/** 生物的身材：「⚔ 5｜♥ 6」；進化生物寫成加多少：「⚔ +3｜♥ +3（進化後 5/6）」。 */
function statLine(card: CreatureDef, names: Names): string {
  const gain = card.evolvesFrom ? evolutionGain(card, names.card?.(card.evolvesFrom)) : null;
  if (!gain) return `⚔ ${card.attack}｜♥ ${card.hp}`;
  return `⚔ ${signed(gain.attack)}｜♥ ${signed(gain.hp)}（進化後 ${card.attack}/${card.hp}）`;
}

/** 整張卡的說明，第一行是標題，其餘是效果。費用一律寫成「能量 N」；進化生物寫的是進化要花的能量。 */
export function describeCard(card: DeckCardDef, names: Names = ids): string[] {
  const tag = `${card.rarity}・${describeColors(card.colors)}`;
  const cost = `能量 ${card.cost}`;
  switch (card.kind) {
    case 'creature': {
      const race = card.race ? `・${RACE_NAMES[card.race]}` : '';
      if (card.token) return [`${card.name}　${tag}${race}・衍生物｜⚔ ${card.attack}｜♥ ${card.hp}`, ...describeTraits(card), keyword('衍生物')];
      const stage = card.evolvesFrom === undefined ? '基礎' : `由${names(card.evolvesFrom)}進化`;
      const bonus = damageBonus(card);
      const entry = card.entry ? [describeEntry(card.entry, names, bonus)] : [];
      const death = card.death ? [describeDeath(card.death, names, bonus)] : [];
      const triggers = (card.triggers ?? []).map((trigger) => describeTrigger(trigger, names, bonus));
      if (card.kin) triggers.unshift(`我方每有另一隻${RACE_NAMES[card.kin.race]}，牠 ⚔ +${card.kin.attack}`);
      const skills = card.skills.map((skill) => describeAbility(skill, names, bonus));
      return [
        `${card.name}　${tag}${race}・${stage}｜${cost}｜${statLine(card, names)}`,
        ...describeTraits(card),
        ...entry,
        ...triggers,
        ...death,
        ...skills,
      ];
    }
    case 'spell':
      return [
        `${card.name}　${tag}・法術｜${cost}`,
        `${describeEffects(card, names)}${describeAwaken(card.awaken, names)}${describeCombo(card.combo, names)}${describeCondition(card.condition, names)}`,
      ];
    case 'item':
      const stats = describeModifier(card);
      return [
        `${card.name}　${tag}・道具｜${cost}`,
        ...(stats.length > 0 ? [`這隻生物${stats.join('、')}`] : []),
        ...(card.skills ?? []).map((skill) => `多一個技能 ${describeAbility(skill, names)}`),
      ];
    case 'field': {
      const own = describeOwnEffects(card.creatures, card.ceilingBonus);
      return [`${card.name}　${tag}・場地｜${cost}`, ...(own ? [own] : []), ...describeFieldTriggers(card)];
    }
    case 'heroEvolution': {
      // 英雄加的 HP 跟生物的身材一樣寫在標題（卡面右下角也有），不另外一行。
      const lines = [`${card.name}　${tag}・英雄進化｜${cost}｜♥ +${card.hpBonus}｜由${names(card.evolvesFrom)}進化`];
      if (card.entry) lines.push(describeEntry(card.entry, names));
      if (card.power) lines.push(`天生技換成 ${describeAbility(card.power, names)}`);
      if (card.alternatePower) lines.push(`每發動一次就跟 ${describeAbility(card.alternatePower, names)} 輪流`);
      if (card.passive) lines.push(`多一個被動 ${describePassive(card.passive, names)}`);
      lines.push('每局只能進化一次');
      return lines;
    }
  }
}

/** 英雄被動：「劍士之道：**突破**；我方生物 ⚔ +1；……」。不寫「被動」兩個字；突破寫在最前面。 */
export function describePassive(passive: HeroPassive, names: Names = ids): string {
  const parts = [passive.pierce ? keyword('突破') : '', describeOwnEffects(passive.creatures, passive.ceilingBonus)];
  if (passive.heroArmor) parts.push(`英雄受到的傷害 −${passive.heroArmor}`);
  if (passive.turnStart) parts.push(`${keyword('回合開始')}：${passive.turnStart.map((effect) => describeEffect(effect, names)).join('，')}`);
  const own = describeModifier(passive.ownTurn);
  if (own.length > 0) parts.push(`我方回合，${ourCreatures(own)}`);
  const theirs = describeModifier(passive.opponentTurn);
  if (theirs.length > 0) parts.push(`對方回合，${ourCreatures(theirs)}`);
  return `${passive.name}：${parts.filter((part) => part).join('；')}`;
}

export function describeHero(hero: HeroDef, names: Names = ids): string[] {
  const kind = hero.boss ? 'BOSS・' : hero.rarity ? `${hero.rarity} 英雄・` : '';
  const lines = [`${hero.name}　${kind}${describeColors(hero.colors)}｜♥ ${hero.hp}`];
  if (hero.passive) lines.push(describePassive(hero.passive, names));
  if (hero.power) lines.push(`天生技 ${describeAbility(hero.power, names)}`);
  if (hero.alternatePower) lines.push(`每發動一次就跟 ${describeAbility(hero.alternatePower, names)} 輪流`);
  if (!hero.passive && !hero.power) lines.push('沒有效果');
  return lines;
}

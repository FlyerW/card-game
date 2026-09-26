import { traitOf } from './queries';
import type {
  Ability,
  CardDb,
  Color,
  CreatureDef,
  CreatureModifier,
  DeathEffect,
  DeckCardDef,
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
  plant: '扎根',
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
  扎根: '你的回合開始時回復 N♥',
  龍鱗: '不會中異常狀態',
  堅固: '受到的傷害 −N',
  光輝: '召喚時你的英雄回復 N♥',
  速攻: '召喚當回合就能攻擊或發動技能；進化卡都有速攻，召喚當回合也能進化，進化完馬上能動',
  吸血: '牠造成傷害時（攻擊、反擊、技能），你的英雄回復等量的 ♥',
  再生: '你的回合開始時回復 N♥',
  進場: '召喚時（或進化成這張時）發動',
  遺言: '死掉時發動（被打倒或被消滅）；沉默中死掉就不發動',
  回合開始: '在場上時，你的每個回合開始時發動（抽牌之後）',
  回合結束: '在場上時，你的每個回合結束時發動',
  每當回復: '在場上時，每當你的英雄回復 ♥ 就發動',
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

/** 這幾行說明裡出現的關鍵字，各自一行解釋，例如「**中毒 2**：施放者的每個回合結束時失去 2♥……」。 */
export function explainKeywords(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    for (const [, word] of line.matchAll(/\*\*([^*]+)\*\*/g)) {
      if (word === undefined || seen.has(word)) continue;
      seen.add(word);
      const [, name = word, n] = /^(.+?)(?: (\d+))?$/.exec(word) ?? [];
      const text = KEYWORDS[name];
      if (text) out.push(`${keyword(word)}：${n ? text.replaceAll('N', n) : text}`);
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

/** 把卡牌 id 換成名字；召喚衍生物的說明用得到。 */
export type Names = (id: string) => string;
const ids: Names = (id) => id;

/** 卡牌 id 換成名字；衍生物帶上數值（例如「烈陽騎兵（1/1、速攻）」），看得出召喚出來的是什麼。 */
export function cardNames(db: CardDb): Names {
  return (id) => {
    const card = db.cards.get(id);
    if (card?.kind === 'creature' && card.token) return `${card.name}（${card.attack}/${card.hp}${card.keywords?.includes('haste') ? `、${keyword('速攻')}` : ''}）`;
    return card?.name ?? db.heroes.get(id)?.name ?? id;
  };
}

export function describeEffect(effect: Effect, names: Names = ids): string {
  switch (effect.type) {
    case 'summonToken':
      return `召喚 ${effect.count} 隻${names(effect.token)}`;
    case 'damage':
      return `造成 ${effect.amount} 傷害`;
    case 'damageEnemyCreatures':
      return `對手每隻生物各受 ${effect.amount} 傷害`;
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
export function describeEffects(ability: Omit<Ability, 'cost'>, names: Names = ids): string {
  const target = describeTarget(ability.target);
  return `${target === null ? '' : `〔${target}〕`}${ability.effects.map((effect) => describeEffect(effect, names)).join('，')}`;
}

/** 技能與天生技：「火花（能量 2）：〔斜對角〕造成 7 傷害」。 */
export function describeAbility(ability: Ability, names: Names = ids): string {
  // 費用：能量（只付能量上限、或休息技能不花能量時不寫）、能量上限 −N、休息、每局次數。
  const parts: string[] = [];
  if (ability.cost > 0 || (!ability.rest && !ability.maxEnergyCost)) parts.push(`能量 ${ability.cost}`);
  if (ability.maxEnergyCost) parts.push(`能量上限 −${ability.maxEnergyCost}`);
  if (ability.rest) parts.push(keyword('休息'));
  if (ability.uses) parts.push(`每局 ${ability.uses} 次`);
  return `${ability.name}（${parts.join('，')}）：${describeEffects(ability, names)}`;
}

/** 進場效果：「**進場** 火星：〔任意目標〕造成 2 傷害」。 */
export const describeEntry = (entry: Omit<Ability, 'cost'>, names: Names = ids): string =>
  `${keyword('進場')} ${entry.name}：${describeEffects(entry, names)}`;

/** 遺言：「**遺言** 傳承：召喚 1 隻士兵（2/2）」。 */
export const describeDeath = (death: DeathEffect, names: Names = ids): string =>
  `${keyword('遺言')} ${death.name}：${death.effects.map((effect) => describeEffect(effect, names)).join('，')}`;

/** 持續效果的關鍵字。 */
const TRIGGER_NAMES: Record<TriggerWhen, string> = { turnStart: '回合開始', turnEnd: '回合結束', heroHealed: '每當回復' };

/** 持續效果：「**回合結束** 觀星：抽 1 張牌」。 */
export const describeTrigger = (trigger: TriggeredEffect, names: Names = ids): string =>
  `${keyword(TRIGGER_NAMES[trigger.when])} ${trigger.name}：${trigger.effects.map((effect) => describeEffect(effect, names)).join('，')}`;

/** 種族特色與關鍵字放在同一行：「**同袍 2**、**速攻**、**吸血**」。 */
function describeTraits(card: CreatureDef): string[] {
  const words: string[] = [];
  const trait = describeTrait(card);
  if (trait) words.push(trait);
  // 進化卡都有速攻。
  if (card.keywords?.includes('haste') || card.evolvesFrom !== undefined) words.push(keyword('速攻'));
  if (card.keywords?.includes('lifesteal')) words.push(keyword('吸血'));
  if (card.regenerate) words.push(keyword(`再生 ${card.regenerate}`));
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

/** 「我方生物 ⚔ +1」；符號開頭的（⚔、♥）前面空一格。 */
const ourCreatures = (parts: string[]) => {
  const text = parts.join('、');
  return `我方生物${/^[A-Za-z⚔♥]/.test(text) ? ' ' : ''}${text}`;
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


/** 整張卡的說明，第一行是標題，其餘是效果。費用一律寫成「能量 N」；進化生物寫的是進化要花的能量。 */
export function describeCard(card: DeckCardDef, names: Names = ids): string[] {
  const tag = `${card.rarity}・${describeColors(card.colors)}`;
  const cost = `能量 ${card.cost}`;
  switch (card.kind) {
    case 'creature': {
      const race = card.race ? `・${RACE_NAMES[card.race]}` : '';
      if (card.token) return [`${card.name}　${tag}${race}・衍生物｜⚔ ${card.attack}｜♥ ${card.hp}`, ...describeTraits(card), keyword('衍生物')];
      const stage = card.evolvesFrom === undefined ? '基礎' : `由${names(card.evolvesFrom)}進化`;
      const entry = card.entry ? [describeEntry(card.entry, names)] : [];
      const death = card.death ? [describeDeath(card.death, names)] : [];
      const triggers = (card.triggers ?? []).map((trigger) => describeTrigger(trigger, names));
      const skills = card.skills.map((skill) => describeAbility(skill, names));
      return [
        `${card.name}　${tag}${race}・${stage}｜${cost}｜⚔ ${card.attack}｜♥ ${card.hp}`,
        ...describeTraits(card),
        ...entry,
        ...triggers,
        ...death,
        ...skills,
      ];
    }
    case 'spell':
      return [`${card.name}　${tag}・法術｜${cost}`, describeEffects(card, names)];
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
      const lines = [`${card.name}　${tag}・英雄進化｜${cost}｜由${names(card.evolvesFrom)}進化`];
      if (card.entry) lines.push(describeEntry(card.entry, names));
      lines.push(`英雄 ♥ 上限 +${card.hpBonus}`);
      if (card.power) lines.push(`天生技換成 ${describeAbility(card.power, names)}`);
      if (card.alternatePower) lines.push(`每發動一次就跟 ${describeAbility(card.alternatePower, names)} 輪流`);
      if (card.passive) lines.push(`多一個${describePassive(card.passive)}`);
      lines.push('每局只能進化一次');
      return lines;
    }
  }
}

export function describePassive(passive: HeroPassive): string {
  const parts = [describeOwnEffects(passive.creatures, passive.ceilingBonus)];
  if (passive.pierce) parts.push(keyword('突破'));
  const own = describeModifier(passive.ownTurn);
  if (own.length > 0) parts.push(`我方回合，${ourCreatures(own)}`);
  const theirs = describeModifier(passive.opponentTurn);
  if (theirs.length > 0) parts.push(`對方回合，${ourCreatures(theirs)}`);
  return `被動「${passive.name}」：${parts.filter((part) => part).join('；')}`;
}

export function describeHero(hero: HeroDef, names: Names = ids): string[] {
  const lines = [`${hero.name}　${hero.rarity ? `${hero.rarity} 英雄・` : ''}${describeColors(hero.colors)}｜♥ ${hero.hp}`];
  if (hero.passive) lines.push(describePassive(hero.passive));
  if (hero.power) lines.push(`天生技 ${describeAbility(hero.power, names)}`);
  if (hero.alternatePower) lines.push(`每發動一次就跟 ${describeAbility(hero.alternatePower, names)} 輪流`);
  if (!hero.passive && !hero.power) lines.push('沒有效果');
  return lines;
}

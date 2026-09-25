import type { Ability, Color, CreatureDef, CreatureModifier, DeckCardDef, Effect, HeroDef, HeroPassive, TargetSpec } from './types';

// 卡面文字由資料產生，不另外手寫，資料和說明才不會對不上。

export const COLOR_NAMES: Record<Color, string> = { white: '白', blue: '藍', black: '黑', red: '紅', green: '綠' };

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

export function describeEffect(effect: Effect): string {
  switch (effect.type) {
    case 'damage':
      return `造成 ${effect.amount} 傷害`;
    case 'damageEnemyCreatures':
      return `對手每隻生物各受 ${effect.amount} 傷害`;
    case 'draw':
      return `抽 ${effect.count} 張牌`;
    case 'opponentDiscardRandom':
      return `對手隨機棄 ${effect.count} 張手牌`;
    case 'heal':
      return `回復 ${effect.amount} HP`;
    case 'healAll':
      return `我方英雄與每隻生物各回復 ${effect.amount} HP`;
    case 'destroyCreature':
      return '消滅（直接送進棄牌區，不算傷害）';
    case 'halveHp':
      return `${effect.all ? '對手每隻生物' : ''}剩餘 HP 減半`;
    case 'taunt':
      return '挑釁（對手下回合的單體傷害必須先打牠）';
    case 'buff': {
      const who = effect.on === 'self' ? '自身' : '目標';
      if (effect.attack === effect.hp) return `${who}增益 ${effect.attack}`;
      const parts: string[] = [];
      if (effect.attack > 0) parts.push(`攻擊 +${effect.attack}`);
      if (effect.hp > 0) parts.push(`HP 上限 +${effect.hp}`);
      return `${who}${parts.join('、')}`;
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
      return `${effect.all ? '對手每隻生物' : ''}中毒 ${effect.amount}（牠的回合開始時失去 ${effect.amount} HP）`;
    case 'burn':
      return `${effect.all ? '對手每隻生物' : ''}灼燒 ${effect.amount}（牠的回合結束時受到 ${effect.amount} 傷害）`;
    case 'paralyze':
      return `${effect.all ? '對手每隻生物' : ''}麻痺（到牠的下個回合結束前不能發動技能）`;
    case 'sleep':
      return `${effect.all ? '對手每隻生物' : ''}沉睡（不能發動技能，受到傷害就醒；最多 2 個回合）`;
  }
}

/** 目標與效果：「〔任意目標〕造成 7 傷害」。 */
export function describeEffects(ability: Omit<Ability, 'cost'>): string {
  const target = describeTarget(ability.target);
  return `${target === null ? '' : `〔${target}〕`}${ability.effects.map(describeEffect).join('，')}`;
}

/** 技能與天生技：「火花（能量 2）：〔斜對角〕造成 7 傷害」。 */
export const describeAbility = (ability: Ability): string =>
  `${ability.name}（能量 ${ability.cost}）：${describeEffects(ability)}`;

/** 進場效果：「進場 火星：〔任意目標〕造成 2 傷害」。 */
export const describeEntry = (entry: Omit<Ability, 'cost'>): string => `進場 ${entry.name}：${describeEffects(entry)}`;

/** 關鍵字與再生，各自一行說明。 */
function describeTraits(card: CreatureDef): string[] {
  const lines: string[] = [];
  if (card.keywords?.includes('haste')) lines.push('速攻：召喚當回合就能發動技能');
  if (card.keywords?.includes('lifesteal')) lines.push('吸血：牠的技能與進場效果造成傷害時，你的英雄回復等量的 HP');
  if (card.regenerate) lines.push(`再生 ${card.regenerate}：你的回合開始時，牠回復 ${card.regenerate} HP`);
  return lines;
}

/** 「我方生物 HP 上限 +2、技能傷害 +1」這類持續加成的說明。 */
function describeModifier(modifier: CreatureModifier | undefined): string[] {
  const parts: string[] = [];
  if (modifier?.attack) parts.push(`技能傷害 +${modifier.attack}`);
  if (modifier?.hp) parts.push(`HP 上限 +${modifier.hp}`);
  if (modifier?.damageReduction) parts.push(`受到傷害 −${modifier.damageReduction}`);
  if (modifier?.regenerate) parts.push(`再生 ${modifier.regenerate}（你的回合開始時回復 ${modifier.regenerate} HP）`);
  return parts;
}

function describeOwnEffects(creatures: CreatureModifier | undefined, ceilingBonus: number | undefined): string {
  const parts: string[] = [];
  const modifier = describeModifier(creatures);
  if (modifier.length > 0) parts.push(`我方生物${modifier.join('、')}`);
  if (ceilingBonus) parts.push(`我方最高上限 +${ceilingBonus}`);
  return parts.join('；');
}

const STAGE_NAMES = ['基礎', '一階', '二階'] as const;

/** 整張卡的說明，第一行是標題，其餘是效果。費用一律寫成「能量 N」；進化生物寫的是進化要花的能量。 */
export function describeCard(card: DeckCardDef, names: (id: string) => string = (id) => id): string[] {
  const tag = `${card.rarity}・${describeColors(card.colors)}`;
  const cost = `能量 ${card.cost}`;
  switch (card.kind) {
    case 'creature': {
      const stage = STAGE_NAMES[card.stage];
      const from = card.evolvesFrom === undefined ? '' : `，由${names(card.evolvesFrom)}進化`;
      const entry = card.entry ? [describeEntry(card.entry)] : [];
      return [`${card.name}　${tag}・${stage}${from}｜${cost}｜HP ${card.hp}`, ...describeTraits(card), ...entry, ...card.skills.map(describeAbility)];
    }
    case 'spell':
      return [`${card.name}　${tag}・法術｜${cost}`, describeEffects(card)];
    case 'item':
      return [`${card.name}　${tag}・道具｜${cost}`, `這隻生物${describeModifier(card).join('、')}`];
    case 'field':
      return [`${card.name}　${tag}・場地｜${cost}`, describeOwnEffects(card.creatures, card.ceilingBonus)];
    case 'heroEvolution': {
      const lines = [`${card.name}　${tag}・英雄進化｜${cost}｜由${names(card.evolvesFrom)}進化`];
      if (card.entry) lines.push(describeEntry(card.entry));
      lines.push(`英雄 HP 上限 +${card.hpBonus}`);
      if (card.power) lines.push(`天生技換成 ${describeAbility(card.power)}`);
      if (card.passive) lines.push(`多一個${describePassive(card.passive)}`);
      lines.push('每局只能進化一次');
      return lines;
    }
  }
}

const describePassive = (passive: HeroPassive): string =>
  `被動「${passive.name}」：${describeOwnEffects(passive.creatures, passive.ceilingBonus)}`;

export function describeHero(hero: HeroDef): string[] {
  const lines = [`${hero.name}　${describeColors(hero.colors)}｜HP ${hero.hp}`];
  if (hero.passive) lines.push(describePassive(hero.passive));
  if (hero.power) lines.push(`天生技 ${describeAbility(hero.power)}`);
  if (!hero.passive && !hero.power) lines.push('沒有效果');
  return lines;
}

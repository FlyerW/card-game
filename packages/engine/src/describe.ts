import type { Ability, Color, CreatureModifier, DeckCardDef, Effect, HeroDef, HeroPassive, TargetSpec } from './types';

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

export function describeAbility(ability: Ability): string {
  const target = describeTarget(ability.target);
  const effects = ability.effects.map(describeEffect).join('，');
  const instant = ability.instant ? '【瞬發】' : '';
  return `${instant}${ability.name}（${ability.cost}）：${target === null ? '' : `〔${target}〕`}${effects}`;
}

/** 「我方生物 HP 上限 +2、技能傷害 +1」這類持續加成的說明。 */
function describeModifier(modifier: CreatureModifier | undefined): string[] {
  const parts: string[] = [];
  if (modifier?.attack) parts.push(`技能傷害 +${modifier.attack}`);
  if (modifier?.hp) parts.push(`HP 上限 +${modifier.hp}`);
  if (modifier?.damageReduction) parts.push(`受到傷害 −${modifier.damageReduction}`);
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

/** 整張卡的說明，第一行是標題，其餘是效果。 */
export function describeCard(card: DeckCardDef, names: (id: string) => string = (id) => id): string[] {
  const tag = `${card.rarity}・${describeColors(card.colors)}`;
  switch (card.kind) {
    case 'creature': {
      const stage = STAGE_NAMES[card.stage];
      const from = card.evolvesFrom === undefined ? '' : `，由${names(card.evolvesFrom)}進化`;
      const cost = card.stage === 0 ? `召喚 ${card.cost}` : `進化 ${card.cost}`;
      const keywords = card.keywords?.includes('haste') ? '｜速攻' : '';
      const entry = card.entry ? [`進場 ${describeAbility({ ...card.entry, cost: 0 }).replace('（0）', '')}`] : [];
      return [`${card.name}　${tag}・${stage}${from}｜${cost}｜HP ${card.hp}${keywords}`, ...entry, ...card.skills.map(describeAbility)];
    }
    case 'spell':
      return [`${card.name}　${tag}・${card.instant ? '瞬發法術' : '法術'}`, describeAbility({ ...card, instant: false })];
    case 'item':
      return [`${card.name}　${tag}・道具（${card.cost}）`, `這隻生物${describeModifier(card).join('、')}`];
    case 'field':
      return [`${card.name}　${tag}・場地（${card.cost}）`, describeOwnEffects(card.creatures, card.ceilingBonus)];
    case 'heroEvolution': {
      const lines = [`${card.name}　${tag}・英雄進化（${card.cost}）｜由${names(card.evolvesFrom)}進化`];
      if (card.entry) lines.push(`進場 ${describeAbility({ ...card.entry, cost: 0 }).replace('（0）', '')}`);
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

import type { Ability, Color, DeckCardDef, Effect, HeroDef, TargetSpec } from './types';

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
      return '剩餘 HP 減半';
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
  }
}

export function describeAbility(ability: Ability): string {
  const target = describeTarget(ability.target);
  const effects = ability.effects.map(describeEffect).join('，');
  return `${ability.name}（${ability.cost}）：${target === null ? '' : `〔${target}〕`}${effects}`;
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
      const keywords = card.keywords?.includes('haste') ? '｜突襲' : '';
      return [`${card.name}　${tag}・${stage}${from}｜${cost}｜HP ${card.hp}${keywords}`, ...card.skills.map(describeAbility)];
    }
    case 'spell':
      return [`${card.name}　${tag}・法術`, describeAbility({ ...card })];
    case 'item': {
      const parts: string[] = [];
      if (card.attack) parts.push(`技能傷害 +${card.attack}`);
      if (card.damageReduction) parts.push(`受到傷害 −${card.damageReduction}`);
      if (card.hp) parts.push(`HP 上限 +${card.hp}`);
      return [`${card.name}　${tag}・道具（${card.cost}）`, `這隻生物${parts.join('、')}`];
    }
    case 'field':
      return [`${card.name}　${tag}・場地（${card.cost}）`, `雙方的最高上限 +${card.ceilingBonus ?? 0}`];
  }
}

export function describeHero(hero: HeroDef): string[] {
  const lines = [`${hero.name}　${describeColors(hero.colors)}｜HP ${hero.hp}`];
  if (hero.passive) lines.push(`被動「${hero.passive.name}」：最高上限 +${hero.passive.ceilingBonus ?? 0}`);
  if (hero.power) lines.push(`天生技 ${describeAbility(hero.power)}`);
  if (!hero.passive && !hero.power) lines.push('沒有效果');
  return lines;
}

import { RARITIES } from './types';
import type { Ability, CardDb, Color, CreatureModifier, DeckCardDef, Effect, HeroDef, TargetSpec } from './types';

const COLORS: ReadonlySet<Color> = new Set(['white', 'blue', 'black', 'red', 'green']);

/** 卡牌資料本身有錯。在建立資料庫時就擋下，不要等到對戰中才出事。 */
export class CardDataError extends Error {}

/** 會用到目標的效果，以及它們接受哪些目標類型。 */
function targetProblem(effect: Effect, spec: TargetSpec): string | null {
  switch (effect.type) {
    case 'damage':
      return spec.kind === 'enemy' || spec.kind === 'lane' ? null : '傷害只能指定對手或位置目標';
    case 'heal':
      return spec.kind === 'ally' ? null : '回復只能指定我方目標';
    case 'halveHp':
      return spec.kind === 'enemy' && spec.allow === 'creature' ? null : 'HP 減半只能指定對手的生物';
    case 'destroy':
      return spec.kind === 'enemyItem' || spec.kind === 'enemyItemOrField'
        ? null
        : '破壞只能指定道具或場地卡';
    case 'buff':
      if (effect.on === 'self') return null;
      return spec.kind === 'ally' && spec.allow === 'creature' ? null : '對目標增益只能指定我方生物';
    default:
      return null;
  }
}

function usesTarget(effect: Effect): boolean {
  if (effect.type === 'buff') return effect.on === 'target';
  return ['damage', 'heal', 'halveHp', 'destroy'].includes(effect.type);
}

function checkAbility(ability: Ability, where: string, isCreatureSkill: boolean): string[] {
  const problems: string[] = [];
  const at = `${where}「${ability.name}」`;
  if (!Number.isInteger(ability.cost) || ability.cost < 0) problems.push(`${at}：費用必須是非負整數`);
  if (ability.effects.length === 0) problems.push(`${at}：沒有任何效果`);
  if (ability.target.kind === 'lane' && !isCreatureSkill) problems.push(`${at}：位置技能只能用在生物身上`);
  if (!isCreatureSkill && ability.effects.some((e) => e.type === 'searchEvolution' || e.type === 'evolveFromDeck')) {
    problems.push(`${at}：找進化卡、直接進化只能用在生物技能上`);
  }

  const targeted = ability.effects.filter(usesTarget);
  if (ability.target.kind === 'none' && targeted.length > 0) {
    problems.push(`${at}：效果需要目標，但沒有指定目標類型`);
  }
  if (ability.target.kind !== 'none' && targeted.length === 0) {
    problems.push(`${at}：指定了目標類型，但沒有效果用到它`);
  }
  for (const effect of targeted) {
    const problem = targetProblem(effect, ability.target);
    if (problem) problems.push(`${at}：${problem}`);
  }
  for (const effect of ability.effects) {
    for (const [key, value] of Object.entries(effect)) {
      if (typeof value === 'number' && (!Number.isInteger(value) || value < 0)) {
        problems.push(`${at}：${effect.type}.${key} 必須是非負整數`);
      }
    }
  }
  return problems;
}

function checkColors(colors: Color[], where: string): string[] {
  const problems: string[] = [];
  for (const color of colors) if (!COLORS.has(color)) problems.push(`${where}：未知的顏色 ${color}`);
  if (new Set(colors).size !== colors.length) problems.push(`${where}：顏色重複`);
  return problems;
}

function checkCard(
  card: DeckCardDef,
  cards: ReadonlyMap<string, DeckCardDef>,
  heroes: ReadonlyMap<string, HeroDef>,
): string[] {
  const where = `${card.name}（${card.id}）`;
  const problems = checkColors(card.colors, where);
  if (!Number.isInteger(card.cost) || card.cost < 0) problems.push(`${where}：費用必須是非負整數`);
  if (!RARITIES.includes(card.rarity)) problems.push(`${where}：未知的稀有度 ${card.rarity}`);

  switch (card.kind) {
    case 'creature': {
      if (!Number.isInteger(card.hp) || card.hp <= 0) problems.push(`${where}：HP 必須是正整數`);
      // N 卡是單純的數值卡，可以只有一個技能；其他稀有度至少兩個。
      const minSkills = card.rarity === 'N' ? 1 : 2;
      if (card.skills.length < minSkills) problems.push(`${where}：${card.rarity} 生物至少要有 ${minSkills} 個技能`);
      for (const skill of card.skills) problems.push(...checkAbility(skill, where, true));
      if (card.entry) problems.push(...checkAbility({ ...card.entry, cost: 0 }, `${where}的進場效果`, true));
      if (card.stage === 0 && card.evolvesFrom !== undefined) {
        problems.push(`${where}：基礎生物不能有進化來源`);
      }
      if (card.stage > 0) {
        const base = card.evolvesFrom === undefined ? undefined : cards.get(card.evolvesFrom);
        if (base === undefined) problems.push(`${where}：找不到進化來源 ${card.evolvesFrom ?? '（未填）'}`);
        else if (base.kind !== 'creature' || base.stage !== card.stage - 1) {
          problems.push(`${where}：進化來源必須是低一階的生物`);
        } else if (RARITIES.indexOf(card.rarity) !== RARITIES.indexOf(base.rarity) + 1) {
          problems.push(`${where}：進化後稀有度要升一級（${base.rarity} → ${RARITIES[RARITIES.indexOf(base.rarity) + 1] ?? '無'}），目前是 ${card.rarity}`);
        }
      }
      break;
    }
    case 'spell':
      problems.push(...checkAbility({ ...card, name: card.name }, where, false));
      break;
    case 'item':
      for (const key of ['attack', 'damageReduction', 'hp'] as const) {
        const value = card[key];
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
          problems.push(`${where}：${key} 必須是非負整數`);
        }
      }
      break;
    case 'heroEvolution': {
      const hero = heroes.get(card.evolvesFrom);
      if (hero === undefined) {
        problems.push(`${where}：找不到要進化的英雄 ${card.evolvesFrom}`);
      } else if ([...card.colors].sort().join() !== [...hero.colors].sort().join()) {
        problems.push(`${where}：英雄進化卡的顏色必須跟 ${hero.name} 相同`);
      }
      if (!Number.isInteger(card.hpBonus) || card.hpBonus < 0) problems.push(`${where}：hpBonus 必須是非負整數`);
      if (card.power) problems.push(...checkAbility(card.power, where, false));
      problems.push(...checkModifier(card.passive?.creatures, where));
      break;
    }
    case 'field':
      problems.push(...checkModifier(card.creatures, where));
      if (card.ceilingBonus !== undefined && (!Number.isInteger(card.ceilingBonus) || card.ceilingBonus < 0)) {
        problems.push(`${where}：ceilingBonus 必須是非負整數`);
      }
      break;
  }
  return problems;
}

function checkModifier(modifier: CreatureModifier | undefined, where: string): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(modifier ?? {})) {
    if (!Number.isInteger(value) || value < 0) problems.push(`${where}：${key} 必須是非負整數`);
  }
  return problems;
}

function checkHero(hero: HeroDef): string[] {
  const where = `英雄 ${hero.name}（${hero.id}）`;
  const problems = checkColors(hero.colors, where);
  if (hero.colors.length === 0) problems.push(`${where}：英雄至少要有一個顏色`);
  if (!Number.isInteger(hero.hp) || hero.hp <= 0) problems.push(`${where}：HP 必須是正整數`);
  if (hero.power) problems.push(...checkAbility(hero.power, where, false));
  problems.push(...checkModifier(hero.passive?.creatures, where));
  return problems;
}

/** 建立卡牌資料庫，資料有任何問題就一次列出全部。 */
export function buildCardDb(cards: readonly DeckCardDef[], heroes: readonly HeroDef[]): CardDb {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { id } of [...cards, ...heroes]) {
    if (seen.has(id)) problems.push(`重複的 id：${id}`);
    seen.add(id);
  }
  const cardMap = new Map(cards.map((card) => [card.id, card]));
  const heroMap = new Map(heroes.map((hero) => [hero.id, hero]));
  for (const card of cards) problems.push(...checkCard(card, cardMap, heroMap));
  for (const hero of heroes) problems.push(...checkHero(hero));
  if (problems.length > 0) throw new CardDataError(problems.join('\n'));
  return { cards: cardMap, heroes: heroMap };
}

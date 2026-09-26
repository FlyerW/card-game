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
      if (effect.all) return null;
      return spec.kind === 'enemy' && spec.allow === 'creature' ? null : 'HP 減半只能指定對手的生物';
    case 'destroy':
      return spec.kind === 'enemyItem' || spec.kind === 'enemyItemOrField'
        ? null
        : '破壞只能指定道具或場地卡';
    case 'destroyCreature':
      return spec.kind === 'enemy' && spec.allow === 'creature' ? null : '消滅只能指定對手的生物';
    case 'buff':
      if (effect.on === 'self') return null;
      return spec.kind === 'ally' && spec.allow === 'creature' ? null : '對目標增益只能指定我方生物';
    case 'poison':
    case 'burn':
    case 'paralyze':
    case 'silence':
    case 'weaken':
      if (effect.all) return null;
      return (spec.kind === 'enemy' && spec.allow !== 'hero') || spec.kind === 'lane'
        ? null
        : '異常狀態只能指定對手的生物（任意目標、只打生物或位置）';
    default:
      return null;
  }
}

function usesTarget(effect: Effect): boolean {
  if (effect.type === 'buff') return effect.on === 'target';
  const statuses = ['poison', 'burn', 'paralyze', 'silence', 'weaken'];
  if ((effect.type === 'halveHp' || statuses.includes(effect.type)) && 'all' in effect && effect.all) return false;
  return ['damage', 'heal', 'halveHp', 'destroy', 'destroyCreature', ...statuses].includes(effect.type);
}

function checkAbility(ability: Ability, where: string, isCreatureSkill: boolean): string[] {
  const problems: string[] = [];
  const at = `${where}「${ability.name}」`;
  if (!Number.isInteger(ability.cost) || ability.cost < 0) problems.push(`${at}：費用必須是非負整數`);
  if (ability.uses !== undefined && (!Number.isInteger(ability.uses) || ability.uses <= 0)) problems.push(`${at}：次數必須是正整數`);
  if (ability.effects.length === 0) problems.push(`${at}：沒有任何效果`);
  for (const effect of ability.effects) {
    if (effect.type === 'summonToken' && effect.count <= 0) problems.push(`${at}：召喚的數量至少 1`);
    if (effect.type === 'lookPick' && (effect.pick <= 0 || effect.pick >= effect.look)) problems.push(`${at}：選的張數要比翻開的少，而且至少 1 張`);
  }
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
      if (!Number.isInteger(card.attack) || card.attack < 0) problems.push(`${where}：攻擊力必須是非負整數`);
      if (card.regenerate !== undefined && (!Number.isInteger(card.regenerate) || card.regenerate <= 0)) {
        problems.push(`${where}：再生必須是正整數`);
      }
      for (const skill of card.skills) problems.push(...checkAbility(skill, where, true));
      if (card.entry) problems.push(...checkAbility({ ...card.entry, cost: 0 }, `${where}的進場效果`, true));
      if ((card.stage as number) > 1) problems.push(`${where}：最多進化一次，stage 只能是 0 或 1`);
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
      // 道具的技能由裝著它的生物發動，跟生物技能一樣可以用位置。
      for (const skill of card.skills ?? []) problems.push(...checkAbility(skill, where, true));
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
      if (card.entry) problems.push(...checkAbility({ ...card.entry, cost: 0 }, `${where}的進場效果`, false));
      for (const part of [card.passive?.creatures, card.passive?.ownTurn, card.passive?.opponentTurn]) problems.push(...checkModifier(part, where));
      break;
    }
    case 'field':
      problems.push(...checkModifier(card.creatures, where));
      for (const key of ['ceilingBonus', 'extraDraw', 'heroRegenerate', 'enemyDecay'] as const) {
        const value = card[key];
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) problems.push(`${where}：${key} 必須是非負整數`);
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
  for (const part of [hero.passive?.creatures, hero.passive?.ownTurn, hero.passive?.opponentTurn]) problems.push(...checkModifier(part, where));
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
  // 召喚的衍生物要存在，而且標成衍生物。
  const abilities = (card: DeckCardDef) =>
    card.kind === 'creature'
      ? [...card.skills, ...(card.entry ? [card.entry] : [])]
      : card.kind === 'spell'
        ? [card]
        : card.kind === 'item'
          ? (card.skills ?? [])
          : card.kind === 'heroEvolution'
            ? [...(card.power ? [card.power] : []), ...(card.entry ? [card.entry] : [])]
            : [];
  for (const card of cards) {
    for (const ability of abilities(card)) {
      for (const effect of ability.effects) {
        if (effect.type !== 'summonToken') continue;
        const token = cardMap.get(effect.token);
        if (token?.kind !== 'creature' || !token.token) problems.push(`${card.name}（${card.id}）：召喚的 ${effect.token} 不是衍生物`);
      }
    }
  }
  for (const hero of heroes) problems.push(...checkHero(hero));
  if (problems.length > 0) throw new CardDataError(problems.join('\n'));
  return { cards: cardMap, heroes: heroMap };
}

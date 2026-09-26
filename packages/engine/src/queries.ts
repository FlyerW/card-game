import type {
  Ability,
  CardDb,
  Creature,
  CreatureDef,
  CreatureModifier,
  DeckCardDef,
  FieldDef,
  GameState,
  HeroDef,
  HeroEvolutionDef,
  HeroPassive,
  ItemDef,
  Keyword,
  PlayerId,
} from './types';

export const other = (player: PlayerId): PlayerId => (player === 0 ? 1 : 0);

// 狀態裡的 cardId 一定存在於資料庫；找不到是程式錯誤，不是玩家的錯，所以直接丟例外。
export function cardDef(db: CardDb, cardId: string): DeckCardDef {
  const def = db.cards.get(cardId);
  if (def === undefined) throw new Error(`卡牌資料庫中沒有 ${cardId}`);
  return def;
}

export function heroDef(db: CardDb, state: GameState, player: PlayerId): HeroDef {
  const { heroId } = state.players[player];
  const def = db.heroes.get(heroId);
  if (def === undefined) throw new Error(`卡牌資料庫中沒有英雄 ${heroId}`);
  return def;
}

/** 這位玩家用掉的英雄進化卡；還沒進化就是 null。 */
export function heroEvolution(db: CardDb, state: GameState, player: PlayerId): HeroEvolutionDef | null {
  const card = state.players[player].heroEvolution;
  if (card === null) return null;
  const def = cardDef(db, card.cardId);
  if (def.kind !== 'heroEvolution') throw new Error(`${def.id} 不是英雄進化卡`);
  return def;
}

/** 目前的天生技：進化卡有新的就用新的。 */
export const heroPower = (db: CardDb, state: GameState, player: PlayerId): Ability | undefined =>
  heroEvolution(db, state, player)?.power ?? heroDef(db, state, player).power;

/** 目前生效的被動：原本的，加上進化卡多給的。 */
export function heroPassives(db: CardDb, state: GameState, player: PlayerId): HeroPassive[] {
  const passives = [heroDef(db, state, player).passive, heroEvolution(db, state, player)?.passive];
  return passives.filter((passive): passive is HeroPassive => passive !== undefined);
}

export const currentCardId = (creature: Creature): string => creature.cards.at(-1)!.cardId;

export function creatureDef(db: CardDb, creature: Creature): CreatureDef {
  const def = cardDef(db, currentCardId(creature));
  if (def.kind !== 'creature') throw new Error(`${def.id} 不是生物卡`);
  return def;
}

function itemDef(db: CardDb, creature: Creature): ItemDef | null {
  if (creature.item === null) return null;
  const def = cardDef(db, creature.item.cardId);
  if (def.kind !== 'item') throw new Error(`${def.id} 不是道具卡`);
  return def;
}

/** 英雄被動加上自己場地卡，給自己每隻生物的加成。 */
export function aura(db: CardDb, state: GameState, player: PlayerId): Required<CreatureModifier> {
  const ownTurn = state.activePlayer === player;
  const sources: (CreatureModifier | undefined)[] = heroPassives(db, state, player).flatMap((passive) => [
    passive.creatures,
    ownTurn ? passive.ownTurn : passive.opponentTurn,
  ]);
  const { field } = state.players[player];
  if (field !== null) {
    const def = cardDef(db, field.cardId);
    if (def.kind === 'field') sources.push(def.creatures);
  }
  const total = { attack: 0, hp: 0, damageReduction: 0, regenerate: 0 };
  for (const modifier of sources) {
    total.attack += modifier?.attack ?? 0;
    total.hp += modifier?.hp ?? 0;
    total.damageReduction += modifier?.damageReduction ?? 0;
    total.regenerate += modifier?.regenerate ?? 0;
  }
  return total;
}

export const maxHp = (db: CardDb, state: GameState, creature: Creature): number =>
  creatureDef(db, creature).hp +
  creature.hpCounters +
  (itemDef(db, creature)?.hp ?? 0) +
  aura(db, state, creature.owner).hp -
  creature.maxHpLost;

export const currentHp = (db: CardDb, state: GameState, creature: Creature): number =>
  maxHp(db, state, creature) - creature.damage;

/** 攻擊力加成：攻擊指示物、道具、場地卡與英雄被動。 */
export const attackBonus = (db: CardDb, state: GameState, creature: Creature): number =>
  creature.attackCounters + (itemDef(db, creature)?.attack ?? 0) + aura(db, state, creature.owner).attack;

/** 目前的攻擊力：卡上的攻擊力加上加成。 */
export const attackPower = (db: CardDb, state: GameState, creature: Creature): number =>
  creatureDef(db, creature).attack + attackBonus(db, state, creature);

/** 這隻生物能發動的技能：自己的技能，加上道具給的。 */
export const creatureSkills = (db: CardDb, creature: Creature): Ability[] => [
  ...creatureDef(db, creature).skills,
  ...(itemDef(db, creature)?.skills ?? []),
];

/** 自己場地區的場地卡；沒有就是 null。 */
export function fieldDef(db: CardDb, state: GameState, player: PlayerId): FieldDef | null {
  const card = state.players[player].field;
  if (card === null) return null;
  const def = cardDef(db, card.cardId);
  return def.kind === 'field' ? def : null;
}

export const damageReduction = (db: CardDb, state: GameState, creature: Creature): number =>
  (itemDef(db, creature)?.damageReduction ?? 0) + aura(db, state, creature.owner).damageReduction;

/** 再生：卡上的再生（沉默時失效），加上英雄被動與場地卡給的。 */
export const regeneration = (db: CardDb, state: GameState, creature: Creature): number =>
  (isSilenced(state, creature) ? 0 : (creatureDef(db, creature).regenerate ?? 0)) + aura(db, state, creature.owner).regenerate;

/** 這隻生物是衍生物（token）。 */
export const isToken = (db: CardDb, creature: Creature): boolean => creatureDef(db, creature).token === true;

export const hasKeyword = (db: CardDb, creature: Creature, keyword: Keyword): boolean =>
  creatureDef(db, creature).keywords?.includes(keyword) ?? false;

/** 只在對手回合生效的 HP 加成；自己的回合開始時消失。 */
export const opponentTurnHp = (db: CardDb, state: GameState, player: PlayerId): number =>
  heroPassives(db, state, player).reduce((sum, passive) => sum + (passive.opponentTurn?.hp ?? 0), 0);

export const heroMaxHp = (db: CardDb, state: GameState, player: PlayerId): number =>
  heroDef(db, state, player).hp + (heroEvolution(db, state, player)?.hpBonus ?? 0);

export const heroHp = (db: CardDb, state: GameState, player: PlayerId): number =>
  heroMaxHp(db, state, player) - state.players[player].heroDamage;

/** 最高上限 = 基本值 + 突破型卡牌 + 英雄被動 + 自己的場地卡。 */
export function ceiling(db: CardDb, state: GameState, player: PlayerId): number {
  const p = state.players[player];
  const fieldDef = p.field === null ? null : cardDef(db, p.field.cardId);
  const fieldBonus = fieldDef?.kind === 'field' ? (fieldDef.ceilingBonus ?? 0) : 0;
  return (
    state.rules.baseCeiling +
    p.ceilingBonus +
    heroPassives(db, state, player).reduce((sum, passive) => sum + (passive.ceilingBonus ?? 0), 0) +
    fieldBonus
  );
}

/** 挑釁在發動者下一個回合開始時結束，也就是持續到對手的回合結束。 */
export const isTaunting = (state: GameState, creature: Creature): boolean =>
  creature.tauntUntilTurn !== null && state.turn <= creature.tauntUntilTurn;

/** 麻痺：到擁有者的下一個回合結束前都不能攻擊、不能發動技能。 */
export const isParalyzed = (state: GameState, creature: Creature): boolean =>
  creature.paralyzedUntilTurn !== null && state.turn <= creature.paralyzedUntilTurn;

/** 沉默：不能發動技能，卡上的吸血與再生失效，攻擊照常。 */
export function isSilenced(state: GameState, creature: Creature): boolean {
  return creature.silencedUntilTurn !== null && state.turn <= creature.silencedUntilTurn;
}

/** 虛弱：不能攻擊，也不會反擊；技能照常。 */
export const isWeakened = (state: GameState, creature: Creature): boolean =>
  creature.weakenedUntilTurn !== null && state.turn <= creature.weakenedUntilTurn;

/** 卡上的吸血在沉默時失效。 */
export const hasLifesteal = (db: CardDb, state: GameState, creature: Creature): boolean =>
  hasKeyword(db, creature, 'lifesteal') && !isSilenced(state, creature);

/**
 * 擁有者往後數第 n 個回合的回合編號。回合雙方輪流，所以現在是擁有者的回合時，
 * 下一個是 turn + 2；是對手的回合時，下一個是 turn + 1。
 */
export function ownersTurn(state: GameState, owner: PlayerId, n: number): number {
  const next = state.activePlayer === owner ? state.turn + 2 : state.turn + 1;
  return next + 2 * (n - 1);
}

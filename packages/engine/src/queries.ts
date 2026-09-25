import type {
  CardDb,
  Creature,
  CreatureDef,
  CreatureModifier,
  DeckCardDef,
  GameState,
  HeroDef,
  ItemDef,
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
  const sources: (CreatureModifier | undefined)[] = [heroDef(db, state, player).passive?.creatures];
  const { field } = state.players[player];
  if (field !== null) {
    const def = cardDef(db, field.cardId);
    if (def.kind === 'field') sources.push(def.creatures);
  }
  const total = { attack: 0, hp: 0, damageReduction: 0 };
  for (const modifier of sources) {
    total.attack += modifier?.attack ?? 0;
    total.hp += modifier?.hp ?? 0;
    total.damageReduction += modifier?.damageReduction ?? 0;
  }
  return total;
}

export const maxHp = (db: CardDb, state: GameState, creature: Creature): number =>
  creatureDef(db, creature).hp +
  creature.hpCounters +
  (itemDef(db, creature)?.hp ?? 0) +
  aura(db, state, creature.owner).hp;

export const currentHp = (db: CardDb, state: GameState, creature: Creature): number =>
  maxHp(db, state, creature) - creature.damage;

/** 技能傷害加成：攻擊指示物、道具、場地卡與英雄被動。 */
export const attackBonus = (db: CardDb, state: GameState, creature: Creature): number =>
  creature.attackCounters + (itemDef(db, creature)?.attack ?? 0) + aura(db, state, creature.owner).attack;

export const damageReduction = (db: CardDb, state: GameState, creature: Creature): number =>
  (itemDef(db, creature)?.damageReduction ?? 0) + aura(db, state, creature.owner).damageReduction;

export const heroMaxHp = (db: CardDb, state: GameState, player: PlayerId): number =>
  heroDef(db, state, player).hp;

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
    (heroDef(db, state, player).passive?.ceilingBonus ?? 0) +
    fieldBonus
  );
}

/** 挑釁在發動者下一個回合開始時結束，也就是持續到對手的回合結束。 */
export const isTaunting = (state: GameState, creature: Creature): boolean =>
  creature.tauntUntilTurn !== null && state.turn <= creature.tauntUntilTurn;

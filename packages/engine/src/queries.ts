import type { CardDb, Creature, CreatureDef, DeckCardDef, GameState, HeroDef, ItemDef, PlayerId } from './types';

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

export const maxHp = (db: CardDb, creature: Creature): number =>
  creatureDef(db, creature).hp + creature.hpCounters + (itemDef(db, creature)?.hp ?? 0);

export const currentHp = (db: CardDb, creature: Creature): number => maxHp(db, creature) - creature.damage;

/** 技能傷害加成：攻擊指示物加上道具。 */
export const attackBonus = (db: CardDb, creature: Creature): number =>
  creature.attackCounters + (itemDef(db, creature)?.attack ?? 0);

export const damageReduction = (db: CardDb, creature: Creature): number =>
  itemDef(db, creature)?.damageReduction ?? 0;

export const heroMaxHp = (db: CardDb, state: GameState, player: PlayerId): number =>
  heroDef(db, state, player).hp;

export const heroHp = (db: CardDb, state: GameState, player: PlayerId): number =>
  heroMaxHp(db, state, player) - state.players[player].heroDamage;

/** 最高上限 = 基本值 + 突破型卡牌 + 英雄被動 + 場地卡（雙方共享）。 */
export function ceiling(db: CardDb, state: GameState, player: PlayerId): number {
  const fieldDef = state.field === null ? null : cardDef(db, state.field.card.cardId);
  const fieldBonus = fieldDef?.kind === 'field' ? (fieldDef.ceilingBonus ?? 0) : 0;
  return (
    state.rules.baseCeiling +
    state.players[player].ceilingBonus +
    (heroDef(db, state, player).passive?.ceilingBonus ?? 0) +
    fieldBonus
  );
}

/** 挑釁在發動者下一個回合開始時結束，也就是持續到對手的回合結束。 */
export const isTaunting = (state: GameState, creature: Creature): boolean =>
  creature.tauntUntilTurn !== null && state.turn <= creature.tauntUntilTurn;

import {
  attackBonus,
  ceiling,
  currentCardId,
  currentHp,
  damageReduction,
  heroHp,
  heroMaxHp,
  isTaunting,
  maxHp,
  other,
} from './queries';
import type { CardDb, CardRef, Creature, GameResult, GameState, PlayerId } from './types';

export interface CreatureView {
  uid: number;
  cardId: string;
  /** 進化鏈，基礎形態在前。 */
  evolutionChain: string[];
  hp: number;
  maxHp: number;
  attackBonus: number;
  damageReduction: number;
  attackCounters: number;
  hpCounters: number;
  item: string | null;
  taunting: boolean;
  skillUsedThisTurn: boolean;
  summonedThisTurn: boolean;
}

export interface SideView {
  heroId: string;
  heroHp: number;
  heroMaxHp: number;
  heroPowerUsedThisTurn: boolean;
  zones: (CreatureView | null)[];
  handCount: number;
  deckCount: number;
  discard: string[];
  energy: number;
  maxEnergy: number;
  ceiling: number;
  mulliganDone: boolean;
}

/**
 * 某位玩家看得到的局面。伺服器只把這個送給客戶端，不送完整狀態：
 * 對手的手牌只有張數，雙方的牌庫順序都不公開，亂數狀態也不公開。
 */
export interface PlayerView {
  viewer: PlayerId;
  turn: number;
  phase: GameState['phase'];
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  result: GameResult | null;
  field: { cardId: string; owner: PlayerId } | null;
  you: SideView & { hand: CardRef[] };
  opponent: SideView;
}

function creatureView(db: CardDb, state: GameState, creature: Creature): CreatureView {
  return {
    uid: creature.uid,
    cardId: currentCardId(creature),
    evolutionChain: creature.cards.map((card) => card.cardId),
    hp: currentHp(db, creature),
    maxHp: maxHp(db, creature),
    attackBonus: attackBonus(db, creature),
    damageReduction: damageReduction(db, creature),
    attackCounters: creature.attackCounters,
    hpCounters: creature.hpCounters,
    item: creature.item?.cardId ?? null,
    taunting: isTaunting(state, creature),
    skillUsedThisTurn: creature.skillUsedTurn === state.turn,
    summonedThisTurn: creature.summonedTurn === state.turn,
  };
}

function sideView(db: CardDb, state: GameState, player: PlayerId): SideView {
  const p = state.players[player];
  return {
    heroId: p.heroId,
    heroHp: heroHp(db, state, player),
    heroMaxHp: heroMaxHp(db, state, player),
    heroPowerUsedThisTurn: p.heroPowerUsedTurn === state.turn,
    zones: p.zones.map((creature) => (creature === null ? null : creatureView(db, state, creature))),
    handCount: p.hand.length,
    deckCount: p.deck.length,
    discard: p.discard.map((card) => card.cardId),
    energy: p.energy,
    maxEnergy: p.maxEnergy,
    ceiling: ceiling(db, state, player),
    mulliganDone: p.mulliganDone,
  };
}

export function viewFor(db: CardDb, state: GameState, player: PlayerId): PlayerView {
  return {
    viewer: player,
    turn: state.turn,
    phase: state.phase,
    activePlayer: state.activePlayer,
    firstPlayer: state.firstPlayer,
    result: state.result,
    field: state.field === null ? null : { cardId: state.field.card.cardId, owner: state.field.owner },
    you: { ...sideView(db, state, player), hand: state.players[player].hand.map((card) => ({ ...card })) },
    opponent: sideView(db, state, other(player)),
  };
}

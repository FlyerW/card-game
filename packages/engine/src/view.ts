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
  /** 用掉的英雄進化卡；還沒進化是 null。 */
  heroEvolution: string | null;
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
  /** 自己場地區的場地卡。 */
  field: string | null;
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
  /** 對手的英雄從重抽階段就看得到，可以先看對手是誰再決定要不要重抽。 */
  you: SideView & { hand: CardRef[] };
  opponent: SideView;
}

function creatureView(db: CardDb, state: GameState, creature: Creature): CreatureView {
  return {
    uid: creature.uid,
    cardId: currentCardId(creature),
    evolutionChain: creature.cards.map((card) => card.cardId),
    hp: currentHp(db, state, creature),
    maxHp: maxHp(db, state, creature),
    attackBonus: attackBonus(db, state, creature),
    damageReduction: damageReduction(db, state, creature),
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
    heroEvolution: p.heroEvolution?.cardId ?? null,
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
    field: p.field?.cardId ?? null,
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
    you: { ...sideView(db, state, player), hand: state.players[player].hand.map((card) => ({ ...card })) },
    opponent: sideView(db, state, other(player)),
  };
}

import { expect } from 'vitest';
import { createEngine } from '../src/engine';
import { other } from '../src/queries';
import type { Action, Creature, GameState, PlayerId } from '../src/types';
import { testDb } from './fixtures';

export const db = testDb();
export const engine = createEngine(db);

export interface Started {
  state: GameState;
  /** 先攻玩家。 */
  a: PlayerId;
  /** 後攻玩家。 */
  b: PlayerId;
}

/**
 * 開一局並跳過重抽，停在先攻玩家的第 1 回合。
 * 牌組全放 filler，測試再自己往手上塞牌、往場上放生物。
 */
export function start(opts: { seed?: number; deckSize?: number; filler?: string } = {}): Started {
  const deckSize = opts.deckSize ?? 30;
  const deck = Array.from({ length: deckSize }, () => opts.filler ?? 'wolf');
  const created = engine.createGame({
    seed: opts.seed ?? 1,
    players: [
      { heroId: 'blank', deck },
      { heroId: 'blank', deck },
    ],
    rules: { deckSize, maxCopies: 99 },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = act(created.state, { type: 'mulligan', player: 0, cards: [] });
  state = act(state, { type: 'mulligan', player: 1, cards: [] });
  return { state, a: state.activePlayer, b: other(state.activePlayer) };
}

/** 執行動作，預期成功，回傳新狀態。 */
export function act(state: GameState, action: Action): GameState {
  const result = engine.apply(state, action);
  if (!result.ok) throw new Error(`${action.type} 被拒絕：${result.error.code} ${result.error.message}`);
  return result.state;
}

/** 執行動作，預期被拒絕，回傳錯誤碼。狀態不會被改動。 */
export function reject(state: GameState, action: Action): string {
  const before = structuredClone(state);
  const result = engine.apply(state, action);
  if (result.ok) throw new Error(`預期 ${action.type} 被拒絕，但成功了`);
  expect(state).toEqual(before);
  return result.error.code;
}

export const endTurn = (state: GameState): GameState => act(state, { type: 'endTurn', player: state.activePlayer });

/** 直接放一張卡到手牌，回傳 uid。 */
export function give(state: GameState, player: PlayerId, cardId: string): number {
  const uid = state.nextUid++;
  state.players[player].hand.push({ uid, cardId });
  return uid;
}

/** 直接放一隻生物到場上。預設不是本回合召喚的，可以立刻行動。 */
export function place(
  state: GameState,
  player: PlayerId,
  zone: number,
  cardId: string,
  patch: Partial<Creature> = {},
): Creature {
  const uid = state.nextUid++;
  const creature: Creature = {
    uid,
    owner: player,
    cards: [{ uid, cardId }],
    damage: 0,
    attackCounters: 0,
    hpCounters: 0,
    item: null,
    summonedTurn: 0,
    evolvedTurn: null,
    actedTurn: null,
    tauntUntilTurn: null,
    poison: 0,
    burn: 0,
    paralyzedUntilTurn: null,
    silencedUntilTurn: null,
    disarmedUntilTurn: null,
    weakenedUntilTurn: null,
    cursedUntilTurn: null,
    ...patch,
  };
  state.players[player].zones[zone] = creature;
  return creature;
}

export const at = (state: GameState, player: PlayerId, zone: number): Creature | null =>
  state.players[player].zones[zone] ?? null;

export const hero = (player: PlayerId) => ({ kind: 'hero', player }) as const;
export const creatureAt = (player: PlayerId, zone: number) => ({ kind: 'creature', player, zone }) as const;

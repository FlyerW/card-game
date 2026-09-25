import { beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_CARDS, sampleDb } from '../src/cards/sample';
import { createEngine, type GameConfig } from '../src/engine';
import { eventsFor } from '../src/view';
import { currentHp } from '../src/queries';
import { nextRandom } from '../src/rng';
import type { Action, GameState } from '../src/types';

// 用範例卡讓兩個隨機行動的機器人對打。隨機機器人不能拿來評估平衡，
// 但它會走到各種奇怪的局面，拿來抓規則引擎的漏洞很有效。

const db = sampleDb();
const engine = createEngine(db);
const DECK_SIZE = 40;

/** 從範例卡池隨機組 40 張（每種最多 3 張）。虹彩賢者是五色，全部卡都能放。 */
function randomDeck(seed: number): string[] {
  // 虹彩賢者沒有英雄進化卡，別的英雄的進化卡不能放進牌組。
  const pool = SAMPLE_CARDS.filter((card) => card.kind !== 'heroEvolution').flatMap((card) => [card.id, card.id, card.id]);
  let rng = seed;
  for (let i = pool.length - 1; i > 0; i--) {
    const [value, next] = nextRandom(rng);
    rng = next;
    const j = Math.floor(value * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, DECK_SIZE);
}

function checkInvariants(state: GameState): void {
  const uids: number[] = [];
  for (const player of [0, 1] as const) {
    const p = state.players[player];
    const cards = [...p.hand, ...p.deck, ...p.discard];
    for (const creature of p.zones) {
      if (creature === null) continue;
      cards.push(...creature.cards);
      if (creature.item !== null) cards.push(creature.item);
      expect(currentHp(db, state, creature)).toBeGreaterThan(0);
    }
    if (p.field !== null) cards.push(p.field);
    if (p.heroEvolution !== null) cards.push(p.heroEvolution);
    expect(cards).toHaveLength(DECK_SIZE); // 卡片不會憑空出現或消失
    uids.push(...cards.map((card) => card.uid));
    expect(p.energy).toBeGreaterThanOrEqual(0);
    expect(p.zones).toHaveLength(5);
  }
  expect(new Set(uids).size).toBe(uids.length); // 同一張卡不會出現在兩個地方
  expect(state.phase === 'over').toBe(state.result !== null);
}

function playRandomGame(seed: number) {
  const config: GameConfig = {
    seed,
    players: [
      { heroId: 'prism-sage', deck: randomDeck(seed * 2 + 1) },
      { heroId: 'prism-sage', deck: randomDeck(seed * 2 + 2) },
    ],
  };
  const created = engine.createGame(config);
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  const actions: Action[] = [];
  let rng = seed;

  while (state.phase !== 'over' && actions.length < 3000) {
    const player = engine.actor(state);
    const legal = engine.legalActions(state, player);
    expect(legal.length).toBeGreaterThan(0); // 永遠至少能結束回合
    if (state.phase === 'main') expect(engine.legalActions(state, player === 0 ? 1 : 0)).toEqual([]); // 另一方這時不能動
    const [value, next] = nextRandom(rng);
    rng = next;
    const action = legal[Math.floor(value * legal.length)]!;
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`合法動作被拒絕：${JSON.stringify(action)} → ${result.error.message}`);
    state = result.state;
    actions.push(action);
    checkInvariants(state);
  }
  expect(state.phase).toBe('over');
  return { config, actions, final: state };
}

describe('隨機對戰', () => {
  let games: ReturnType<typeof playRandomGame>[] = [];
  beforeAll(() => {
    games = Array.from({ length: 25 }, (_, i) => playRandomGame(1000 + i));
  });

  it('每一局都能正常打完，每一步都維持不變量', () => {
    expect(games.every((game) => game.final.result !== null)).toBe(true);
  });

  it('同樣的種子與動作序列，重播出完全相同的一局', () => {
    for (const { config, actions, final } of games.slice(0, 5)) {
      const replayed = engine.replay(config, actions);
      if (!replayed.ok) throw new Error(replayed.error.message);
      expect(replayed.state).toEqual(final);
    }
  });

  it('玩家視角看不到對手的手牌、雙方的牌庫順序，以及亂數狀態', () => {
    const { final } = games[0]!;
    const view = engine.viewFor(final, 0);
    const json = JSON.stringify(view);
    const hidden = [...final.players[1].hand, ...final.players[0].deck, ...final.players[1].deck];
    for (const card of hidden) expect(json).not.toMatch(new RegExp(`"uid":${card.uid}[,}]`));
    expect(view.opponent).not.toHaveProperty('hand');
    expect(view.opponent.handCount).toBe(final.players[1].hand.length);
    expect(view.you.hand).toEqual(final.players[0].hand);
    expect(json).not.toContain('rng');
  });

  it('事件：對手抽到的牌只給張數，自己抽到的照給', () => {
    const { config, actions } = games[0]!;
    const created = engine.createGame(config);
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state;
    for (const action of actions) {
      const result = engine.apply(state, action);
      if (!result.ok) throw new Error(result.error.message);
      for (const event of eventsFor(result.events, 0)) {
        if (event.type !== 'drew') continue;
        if (event.player === 0) expect(event.cards.every((card) => card.cardId !== '')).toBe(true);
        else expect(event.cards.every((card) => card.cardId === '' && card.uid === 0)).toBe(true);
      }
      state = result.state;
    }
  });
});

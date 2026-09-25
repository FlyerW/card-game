import { describe, expect, it } from 'vitest';
import { chooseAction, evaluate, STYLES } from '../src/bot';
import { DEFAULT_RULES, deckPool, SAMPLE_CARDS, SAMPLE_HEROES, validateDeck, type Creature, type GameState, type PlayerId } from '@card-game/engine';
import { buildDeck, evolutionLines } from '../src/deck';
import { EXPERIMENTS, engine, gameConfig, mirrorDeck } from '../src/experiments';
import { playMatch } from '../src/match';

describe('模擬環境', () => {
  it('進化線照 3/2/1 帶：一階不會比基礎多、二階不會比一階多', () => {
    for (let seed = 0; seed < 50; seed++) {
      const deck = mirrorDeck(seed);
      const count = (id: string) => deck.filter((card) => card === id).length;
      for (const line of evolutionLines(SAMPLE_CARDS)) {
        const counts = line.map((card) => count(card.id));
        for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
      }
    }
  });

  it('用英雄自己的卡池組牌，組出來的都是正式規則下合法的牌組', () => {
    for (const hero of SAMPLE_HEROES) {
      for (const seed of [1, 2, 3]) {
        const deck = buildDeck(seed, hero.id, deckPool(engine.db, hero.id));
        expect(validateDeck(engine.db, DEFAULT_RULES, hero.id, deck), hero.name).toEqual([]);
      }
    }
  });

  it('9 費以上的卡最多帶 3 張', () => {
    for (const hero of SAMPLE_HEROES) {
      for (let seed = 0; seed < 30; seed++) {
        const deck = buildDeck(seed, hero.id, deckPool(engine.db, hero.id));
        expect(deck, hero.name).toHaveLength(40);
        expect(deck.filter((id) => engine.db.cards.get(id)!.cost >= 9).length, hero.name).toBeLessThanOrEqual(3);
      }
    }
  });

  it('同一個種子組出同一副牌，而且每種卡最多 3 張', () => {
    const deck = mirrorDeck(123);
    expect(mirrorDeck(123)).toEqual(deck);
    expect(deck).toHaveLength(40);
    const counts = new Map<string, number>();
    for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });

  it('每個實驗的第 i 局用同一副牌、同一個種子，只有規則不同', () => {
    const [first, second] = [gameConfig(EXPERIMENTS[0]!, 7), gameConfig(EXPERIMENTS[3]!, 7)];
    expect(first.seed).toBe(second.seed);
    expect(first.players[0].deck).toEqual(second.players[0].deck);
    expect(first.players[0].deck).toEqual(first.players[1].deck); // 鏡像
  });

  it('每個實驗的設定都是合法的對局', () => {
    for (const experiment of EXPERIMENTS) expect(engine.createGame(gameConfig(experiment, 0)).ok).toBe(true);
  });
});

/** 開一局、雙方保留起手，停在先攻玩家的第 1 回合。 */
function opening(): GameState {
  const created = engine.createGame(gameConfig(EXPERIMENTS[3]!, 3));
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  for (const player of [0, 1] as const) {
    const kept = engine.apply(state, { type: 'mulligan', player, cards: [] });
    if (!kept.ok) throw new Error(kept.error.message);
    state = kept.state;
  }
  return state;
}

function put(state: GameState, player: PlayerId, zone: number, cardId: string, damage = 0): void {
  const uid = state.nextUid++;
  const creature: Creature = {
    uid, owner: player, cards: [{ uid, cardId }], damage, attackCounters: 0, hpCounters: 0, item: null,
    summonedTurn: 0, evolvedTurn: null, skillUsedTurn: null, tauntUntilTurn: null,
    poison: 0, burn: 0, paralyzedUntilTurn: null, asleepUntilTurn: null,
  };
  state.players[player].zones[zone] = creature;
}

describe('機器人', () => {
  it('等待回應時會用瞬發牌：先把攻擊者打倒，攻擊就不會打出來', () => {
    const state = opening();
    const a = state.activePlayer;
    const b: PlayerId = a === 0 ? 1 : 0;
    put(state, a, 0, 'wandering-mercenary', 4); // HP 8，剩 4
    state.players[a].energy = 5;
    state.players[b].energy = 2;
    state.players[b].hand.push({ uid: state.nextUid++, cardId: 'ice-shard' });
    const attacked = engine.apply(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: { kind: 'hero', player: b } });
    if (!attacked.ok) throw new Error(attacked.error.message);
    expect(attacked.state.window).toBe(b);
    const pick = chooseAction(engine, attacked.state, b, STYLES.balanced);
    expect(pick.action).toMatchObject({ type: 'castSpell', target: { kind: 'creature', player: a, zone: 0 } });

  });

  it('分出勝負時評分是極值', () => {
    const { outcome, state } = (() => {
      const created = engine.createGame(gameConfig(EXPERIMENTS[0]!, 0));
      if (!created.ok) throw new Error(created.error.message);
      const over = engine.apply(created.state, { type: 'concede', player: 1 });
      if (!over.ok) throw new Error(over.error.message);
      return { outcome: over.state.result, state: over.state };
    })();
    expect(outcome?.winner).toBe(0);
    expect(evaluate(engine.db, state, 0, STYLES.balanced)).toBe(1e6);
    expect(evaluate(engine.db, state, 1, STYLES.balanced)).toBe(-1e6);
  });

  it('每種打法都能把一局打完，而且是靠打倒英雄分出勝負', () => {
    for (const style of Object.values(STYLES)) {
      const outcome = playMatch(engine, gameConfig({ ...EXPERIMENTS[3]!, style }, 1), style);
      expect(outcome.result.reason).toBe('heroDefeated');
      expect(outcome.turns).toBeGreaterThan(2);
    }
  });
});

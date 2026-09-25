import { describe, expect, it } from 'vitest';
import { evaluate, STYLES } from '../src/bot';
import { EXPERIMENTS, engine, gameConfig, mirrorDeck } from '../src/experiments';
import { playMatch } from '../src/match';

describe('模擬環境', () => {
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

describe('機器人', () => {
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

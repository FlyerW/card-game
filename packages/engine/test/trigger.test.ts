import { describe, expect, it } from 'vitest';
import { describeCard } from '../src/describe';
import { act, at, db, endTurn, give, place, start } from './helpers';

// 持續效果：生物在場上時，每當條件成立就發動；沉默中不發動。

describe('持續效果', () => {
  it('回合結束時抽牌，只在自己的回合結束', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'stargazer');
    const hand = state.players[a].hand.length;
    state = endTurn(state);
    expect(state.players[a].hand.length).toBe(hand + 1);
    // 對手的回合結束不發動（a 只在自己的回合開始時抽 1 張）。
    state = endTurn(state);
    expect(state.players[a].hand.length).toBe(hand + 2);
    expect(state.activePlayer).toBe(a);
    void b;
  });

  it('回合結束時範圍傷害', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'ember');
    place(state, b, 0, 'wolf');
    place(state, b, 3, 'wolf');
    state = endTurn(state);
    expect(at(state, b, 0)!.damage).toBe(1);
    expect(at(state, b, 3)!.damage).toBe(1);
  });

  it('每當英雄回復，自身 +1/+1；回合開始的回復也算', () => {
    let { state, a } = start();
    place(state, a, 0, 'idol');
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'bloom') });
    expect(at(state, a, 0)!.attackCounters).toBe(1);
    place(state, a, 1, 'spring');
    state = endTurn(endTurn(state));
    expect(at(state, a, 0)!.attackCounters).toBe(2);
    expect(state.players[a].heroDamage).toBe(-6);
  });

  it('沉默中不發動', () => {
    let { state, a } = start();
    place(state, a, 0, 'stargazer', { silencedUntilTurn: 99 });
    const hand = state.players[a].hand.length;
    state = endTurn(state);
    expect(state.players[a].hand.length).toBe(hand);
  });

  it('卡面寫出持續效果', () => {
    expect(describeCard(db.cards.get('stargazer')!)).toContain('**回合結束** gaze：抽 1 張牌');
  });
});

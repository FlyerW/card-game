import { describe, expect, it } from 'vitest';
import { describeCard } from '../src/describe';
import { attackPower } from '../src/queries';
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

describe('種族相關', () => {
  it('同族加成：我方每有另一隻野獸 ⚔ +1，不算自己，也不算對手的', () => {
    const { state, a, b } = start();
    const alpha = place(state, a, 0, 'alpha');
    expect(attackPower(db, state, alpha)).toBe(2);
    place(state, a, 1, 'pouncer');
    place(state, a, 2, 'pouncer');
    place(state, b, 0, 'pouncer');
    expect(attackPower(db, state, alpha)).toBe(4);
    alpha.silencedUntilTurn = 99;
    expect(attackPower(db, state, alpha)).toBe(2);
  });

  it('每當召喚亡靈就抽牌：衍生物也算，別的種族不算', () => {
    let { state, a } = start();
    state.players[a].energy = 5;
    place(state, a, 0, 'keeper');
    const hand = state.players[a].hand.length;
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'ghoul'), zone: 1 });
    expect(state.players[a].hand.length).toBe(hand + 1);
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'footman'), zone: 2 });
    expect(state.players[a].hand.length).toBe(hand + 2 - 1);
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'raise') });
    expect(state.players[a].hand.length).toBe(hand + 1 + 2);
  });

  it('卡面寫出同族加成與每當召喚', () => {
    expect(describeCard(db.cards.get('alpha')!)).toContain('我方每有另一隻野獸，牠 ⚔ +1');
    expect(describeCard(db.cards.get('keeper')!)).toContain('**每當召喚**亡靈 toll：抽 1 張牌');
  });
});

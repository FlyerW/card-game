import { describe, expect, it } from 'vitest';
import { deckPool, validateDeck } from '../src/deck';
import { describeCard } from '../src/describe';
import { DEFAULT_RULES } from '../src/rules';
import { act, at, creatureAt, db, endTurn, give, hero, place, reject, start } from './helpers';

// 衍生物：由效果召喚，不能放進牌組，離場就消失。

describe('衍生物', () => {
  it('召喚在自己最左邊的空格，召喚當回合不能攻擊', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'wolf');
    place(state, a, 2, 'wolf');
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'spawn') });
    expect(at(state, a, 1)?.cards[0]?.cardId).toBe('imp-token');
    expect(at(state, a, 3)?.cards[0]?.cardId).toBe('imp-token');
    expect(reject(state, { type: 'attack', player: a, zone: 1, target: hero(b) })).toBe('SUMMONED_THIS_TURN');
    state = endTurn(endTurn(state));
    act(state, { type: 'attack', player: a, zone: 1, target: hero(b) });
  });

  it('格子滿了就少召喚幾隻', () => {
    let { state, a } = start();
    for (const zone of [0, 1, 2, 3]) place(state, a, zone, 'wolf');
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'spawn') });
    expect(at(state, a, 4)?.cards[0]?.cardId).toBe('imp-token');
    expect(state.players[a].zones.every((zone) => zone !== null)).toBe(true);
  });

  it('被擊倒或退場都不會進棄牌區', () => {
    let { state, a, b } = start();
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'spawn') });
    const discard = state.players[a].discard.length;
    state = act(state, { type: 'dismiss', player: a, zone: 0 });
    expect(state.players[a].discard.length).toBe(discard);
    place(state, b, 0, 'brute');
    state = endTurn(state);
    state = act(state, { type: 'attack', player: b, zone: 0, target: creatureAt(a, 1) });
    expect(at(state, a, 1)).toBeNull();
    expect(state.players[a].discard.map((card) => card.cardId)).not.toContain('imp-token');
  });

  it('不能放進牌組，組牌的卡池也沒有', () => {
    const rules = { ...DEFAULT_RULES, deckSize: 2, maxCopies: 2 };
    expect(validateDeck(db, rules, 'blank', ['imp-token', 'wolf'])).toContain('imp-token 是衍生物，不能放進牌組');
    expect(deckPool(db, 'blank').some((card) => card.id === 'imp-token')).toBe(false);
  });

  it('卡面寫出召喚誰', () => {
    const names = (id: string) => db.cards.get(id)?.name ?? id;
    expect(describeCard(db.cards.get('spawn')!, names)).toEqual(['spawn　R・無色・法術｜能量 1', '召喚 2 隻imp-token']);
  });
});

import { describe, expect, it } from 'vitest';
import { act, engine, give, reject, start } from './helpers';

// 看牌庫頂 4 張、選 2 張加入手牌，其餘放回牌庫底。選的時候對局停下來等這位玩家。

function cast() {
  const { state, a, b } = start({ deckSize: 40 });
  const hand = state.players[a].hand.length;
  const top = state.players[a].deck.slice(0, 4).map((card) => card.uid);
  const after = act(state, { type: 'castSpell', player: a, card: give(state, a, 'peek') });
  return { state: after, a, b, hand, top };
}

describe('看牌庫頂選牌', () => {
  it('翻開 4 張等著選：只有選的人能動，而且只能選牌', () => {
    const { state, a, b, hand, top } = cast();
    expect(state.choice?.cards.map((card) => card.uid)).toEqual(top);
    expect(state.players[a].hand).toHaveLength(hand);
    expect(engine.actor(state)).toBe(a);
    expect(reject(state, { type: 'endTurn', player: a })).toBe('CHOICE_PENDING');
    expect(reject(state, { type: 'choose', player: b, cards: top.slice(0, 2) })).toBe('CHOICE_PENDING');
    const options = engine.legalActions(state, a);
    expect(options).toHaveLength(6); // 4 選 2
    expect(options.every((action) => action.type === 'choose')).toBe(true);
    expect(engine.legalActions(state, b)).toEqual([]);
  });

  it('選的加入手牌，其餘照原本的順序放回牌庫底', () => {
    const { state, a, hand, top } = cast();
    const deck = state.players[a].deck.length;
    const after = act(state, { type: 'choose', player: a, cards: [top[1]!, top[3]!] });
    expect(after.choice).toBeNull();
    expect(after.players[a].hand.map((card) => card.uid).slice(-2)).toEqual([top[1], top[3]]);
    expect(after.players[a].hand).toHaveLength(hand + 2);
    expect(after.players[a].deck.slice(-2).map((card) => card.uid)).toEqual([top[0], top[2]]);
    expect(after.players[a].deck).toHaveLength(deck + 2);
    act(after, { type: 'endTurn', player: a });
  });

  it('張數要剛好、只能選翻開的牌', () => {
    const { state, a, top } = cast();
    expect(reject(state, { type: 'choose', player: a, cards: [top[0]!] })).toBe('INVALID_CHOICE');
    expect(reject(state, { type: 'choose', player: a, cards: [top[0]!, top[0]!] })).toBe('INVALID_CHOICE');
    expect(reject(state, { type: 'choose', player: a, cards: [top[0]!, state.players[a].deck[0]!.uid] })).toBe('INVALID_CHOICE');
  });

  it('沒有要選的牌時不能選', () => {
    const { state, a } = start();
    expect(reject(state, { type: 'choose', player: a, cards: [] })).toBe('NO_CHOICE');
  });

  it('牌庫剩的不夠選，全部加入手牌，不用等', () => {
    const { state, a } = start();
    state.players[a].deck = state.players[a].deck.slice(0, 2);
    const hand = state.players[a].hand.length;
    const after = act(state, { type: 'castSpell', player: a, card: give(state, a, 'peek') });
    expect(after.choice).toBeNull();
    expect(after.players[a].hand).toHaveLength(hand + 2);
    expect(after.players[a].deck).toHaveLength(0);
  });

  it('翻開的牌只有選的人看得到', () => {
    const { state, a, b, top } = cast();
    expect(engine.viewFor(state, a).choice?.cards.map((card) => card.uid)).toEqual(top);
    expect(engine.viewFor(state, b).choice).toBeNull();
    expect(engine.viewFor(state, b).opponentChoosing).toBe(true);
  });
});

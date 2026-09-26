import { describe, expect, it } from 'vitest';
import { describeCard } from '../src/describe';
import { act, at, creatureAt, db, engine, give, place, start } from './helpers';

// 遺言：生物死掉時（被打倒或被消滅）發動，不選目標；沉默中死掉不發動，亡靈的不死留下 1 HP 不算死。

describe('遺言', () => {
  it('被打倒時召喚衍生物，第一隻放回牠原本的格子', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, b, 1, 'martyr');
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 1) });
    expect(at(state, b, 1)?.cards[0]?.cardId).toBe('imp-token');
    expect(at(state, b, 0)?.cards[0]?.cardId).toBe('imp-token');
  });

  it('英雄回血（可以超過起始 HP）、抽牌', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, b, 0, 'mourner');
    const hand = state.players[b].hand.length;
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(state.players[b].heroDamage).toBe(-5);
    expect(state.players[b].hand.length).toBe(hand + 1);
  });

  it('範圍傷害打死的生物也會發動牠們的遺言', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, a, 1, 'martyr');
    place(state, b, 0, 'bomber');
    const result = engine.apply(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
    // 炸彈客的遺言打死殉道者，殉道者再召喚 2 隻衍生物（第一隻在牠原本的格子）。
    expect(at(state, a, 1)?.cards[0]?.cardId).toBe('imp-token');
    expect(at(state, a, 2)?.cards[0]?.cardId).toBe('imp-token');
    // 攻擊的那隻：反擊 1 加上遺言 2。
    expect(at(state, a, 0)?.damage).toBe(3);
    const triggered = result.events.flatMap((event) => (event.type === 'deathTriggered' ? [event.name] : []));
    expect(triggered).toEqual(['boom', 'rise']);
  });

  it('沉默中死掉不發動', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, b, 0, 'martyr', { silencedUntilTurn: 99 });
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(state.players[b].zones.every((zone) => zone === null)).toBe(true);
  });

  it('亡靈第一次倒下留 1 HP，不發動；第二次才發動', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, a, 1, 'brute');
    place(state, b, 0, 'bone-ghoul');
    const hand = state.players[b].hand.length;
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)).not.toBeNull();
    expect(state.players[b].hand.length).toBe(hand);
    state = act(state, { type: 'attack', player: a, zone: 1, target: creatureAt(b, 0) });
    expect(at(state, b, 0)).toBeNull();
    expect(state.players[b].hand.length).toBe(hand + 1);
  });

  it('被消滅也會發動', () => {
    let { state, a, b } = start();
    place(state, b, 2, 'martyr');
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'doom'), target: creatureAt(b, 2) });
    expect(at(state, b, 2)?.cards[0]?.cardId).toBe('imp-token');
  });

  it('卡面寫出遺言', () => {
    const names = (id: string) => db.cards.get(id)?.name ?? id;
    expect(describeCard(db.cards.get('mourner')!, names)).toContain('**遺言** farewell：我方英雄回復 5♥，抽 1 張牌');
  });
});

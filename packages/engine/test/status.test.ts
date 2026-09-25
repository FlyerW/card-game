import { describe, expect, it } from 'vitest';
import { ownersTurn } from '../src/queries';
import { act, at, creatureAt, endTurn, engine, give, hero, place, reject, start } from './helpers';

// 異常狀態：只作用在生物身上，進化會解除全部。

describe('中毒', () => {
  it('擁有者的回合開始時失去 N HP；減傷擋不住；再中一次數字相加', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'venom');
    const target = place(state, b, 0, 'hitter', { item: { uid: 900, cardId: 'armor' } });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.poison).toBe(2);
    expect(at(state, b, 0)!.damage).toBe(0); // 施加當下不扣

    state = endTurn(state); // b 的回合開始：失去 2（鐵甲減 2 也擋不住）
    expect(at(state, b, 0)!.damage).toBe(2);
    expect(target.uid).toBe(at(state, b, 0)!.uid);

    state = endTurn(state);
    state.players[a].energy = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.poison).toBe(4);
    state = endTurn(state);
    expect(at(state, b, 0)!.damage).toBe(6);
  });

  it('扣到 0 就被擊倒', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'wolf', { damage: 5, poison: 2 });
    state = endTurn(state);
    expect(state.activePlayer).toBe(b);
    expect(at(state, b, 0)).toBeNull();
    expect(state.players[a].zones.every((z) => z === null)).toBe(true);
  });

  it('打到英雄沒有效果，同一個法術的傷害照樣結算', () => {
    let { state, a, b } = start();
    const dart = give(state, a, 'dart');
    state = act(state, { type: 'castSpell', player: a, card: dart, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(1);
  });
});

describe('灼燒', () => {
  it('擁有者的回合結束時受到 N 傷害；減傷擋得住；再中一次取大的', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'venom');
    place(state, b, 0, 'hitter', { item: { uid: 900, cardId: 'armor' } });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.burn).toBe(3);

    state = endTurn(state); // a 的回合結束：灼燒的是 b 的生物，不發作
    expect(at(state, b, 0)!.damage).toBe(0);
    state = endTurn(state); // b 的回合結束：3 − 鐵甲 2 = 1
    expect(at(state, b, 0)!.damage).toBe(1);

    at(state, b, 0)!.burn = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.burn).toBe(5);
  });
});

describe('麻痺', () => {
  it('到擁有者的下一個回合結束前不能發動技能', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'mesmer');
    place(state, b, 0, 'hitter');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });

    state = endTurn(state); // b 的回合：麻痺中
    expect(reject(state, { type: 'useSkill', player: b, zone: 0, skill: 0, target: hero(a) })).toBe('PARALYZED');
    expect(engine.viewFor(state, a).opponent.zones[0]!.paralyzed).toBe(true);

    state = endTurn(state);
    state = endTurn(state); // b 的下一個回合：解除
    act(state, { type: 'useSkill', player: b, zone: 0, skill: 0, target: hero(a) });
  });

  it('持續時間照擁有者的回合算：現在是他的回合，下一個是 turn + 2', () => {
    const { state, a, b } = start(); // 第 1 回合，a 的回合
    expect(ownersTurn(state, a, 1)).toBe(3);
    expect(ownersTurn(state, b, 1)).toBe(2);
    expect(ownersTurn(state, b, 2)).toBe(4);
  });
});

describe('沉睡', () => {
  it('不能發動技能，受到傷害就醒來', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'mesmer');
    place(state, a, 1, 'hitter');
    place(state, b, 0, 'taunter');
    state.players[a].energy = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: creatureAt(b, 0) });

    state = endTurn(state);
    expect(reject(state, { type: 'useSkill', player: b, zone: 0, skill: 0 })).toBe('ASLEEP');

    state = endTurn(state);
    state = act(state, { type: 'useSkill', player: a, zone: 1, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.asleepUntilTurn).toBeNull();
    state = endTurn(state);
    act(state, { type: 'useSkill', player: b, zone: 0, skill: 0 });
  });

  it('沒被打的話，最多持續擁有者的 2 個回合', () => {
    let { state, a, b } = start({ deckSize: 60 });
    place(state, a, 0, 'mesmer');
    place(state, b, 0, 'taunter');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: creatureAt(b, 0) });
    state = endTurn(state); // b 第 1 個回合
    expect(reject(state, { type: 'useSkill', player: b, zone: 0, skill: 0 })).toBe('ASLEEP');
    state = endTurn(endTurn(state)); // b 第 2 個回合
    expect(reject(state, { type: 'useSkill', player: b, zone: 0, skill: 0 })).toBe('ASLEEP');
    state = endTurn(endTurn(state)); // b 第 3 個回合：醒了
    act(state, { type: 'useSkill', player: b, zone: 0, skill: 0 });
  });

  it('失去 HP 不算受到傷害，中毒不會叫醒牠', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'taunter', { poison: 1, asleepUntilTurn: 10 });
    state = endTurn(state);
    expect(at(state, b, 0)!.damage).toBe(1);
    expect(at(state, b, 0)!.asleepUntilTurn).toBe(10);
    expect(a).not.toBe(b);
  });
});

describe('對手每隻生物', () => {
  it('不用選目標，對手每隻生物都中；自己的生物不受影響', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'hitter');
    place(state, b, 0, 'hitter');
    place(state, b, 3, 'wolf');
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'miasma') });
    for (const zone of [0, 3]) expect(at(state, b, zone)).toMatchObject({ poison: 1, paralyzedUntilTurn: 2 });
    expect(at(state, a, 0)).toMatchObject({ poison: 0, paralyzedUntilTurn: null });
  });
});

describe('進化', () => {
  it('解除全部異常狀態，已受的傷害保留', () => {
    let { state, a } = start();
    place(state, a, 0, 'pup', { damage: 2, poison: 3, burn: 2, paralyzedUntilTurn: 9, asleepUntilTurn: 9 });
    const card = give(state, a, 'hound');
    state.players[a].energy = 5;
    const result = engine.apply(state, { type: 'evolve', player: a, card, zone: 0 });
    if (!result.ok) throw new Error(result.error.message);
    const evolved = at(result.state, a, 0)!;
    expect(evolved).toMatchObject({ damage: 2, poison: 0, burn: 0, paralyzedUntilTurn: null, asleepUntilTurn: null });
    expect(result.events).toContainEqual({ type: 'statusesCleared', player: a, zone: 0 });
  });
});

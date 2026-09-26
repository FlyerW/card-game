import { describe, expect, it } from 'vitest';
import { currentHp, maxHp, ownersTurn } from '../src/queries';
import { act, at, creatureAt, endTurn, engine, give, hero, place, reject, start } from './helpers';

// 異常狀態：只作用在生物身上，進化會解除全部。

describe('中毒', () => {
  it('施放者的回合結束時失去 N HP；減傷擋不住；再中一次數字相加', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'venom');
    place(state, b, 0, 'hitter', { item: { uid: 900, cardId: 'armor' } });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.poison).toBe(2);
    expect(at(state, b, 0)!.damage).toBe(0); // 施加當下不扣

    state = endTurn(state); // a（施放者）的回合結束：失去 2，鐵甲減 2 也擋不住
    expect(at(state, b, 0)!.damage).toBe(2);
    state = endTurn(state); // b 的回合結束：不發作
    expect(at(state, b, 0)!.damage).toBe(2);

    state.players[a].energy = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.poison).toBe(4);
    state = endTurn(state);
    expect(at(state, b, 0)!.damage).toBe(6);
  });

  it('跟一般的傷害一樣，回復補得回來', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'pup', { poison: 2 });
    state = endTurn(state); // a 的回合結束：b 的生物中毒發作
    expect(at(state, b, 0)).toMatchObject({ damage: 2 });
    state.players[b].energy = 5;
    state = act(state, { type: 'castSpell', player: b, card: give(state, b, 'bloom') });
    expect(at(state, b, 0)!.damage).toBe(0);
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
  it('施放者的回合結束時受到 N 傷害；減傷擋得住；再中一次取大的', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'venom');
    place(state, b, 0, 'hitter', { item: { uid: 900, cardId: 'armor' } });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.burn).toBe(3);

    state = endTurn(state); // a（施放者）的回合結束：3 − 鐵甲 2 = 1
    expect(at(state, b, 0)!.damage).toBe(1);
    state = endTurn(state); // b 的回合結束：不發作
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

describe('沉默', () => {
  it('不能發動技能，攻擊照常；到擁有者的下一個回合結束', () => {
    let { state, a, b } = start({ deckSize: 60 });
    place(state, a, 4, 'mesmer'); // 放在對面生物打不到的格子，攻擊才打得到英雄
    place(state, b, 0, 'taunter');
    state = act(state, { type: 'useSkill', player: a, zone: 4, skill: 1, target: creatureAt(b, 0) });
    state = endTurn(state); // b 的回合
    expect(reject(state, { type: 'useSkill', player: b, zone: 0, skill: 0 })).toBe('SILENCED');
    act(state, { type: 'attack', player: b, zone: 0, target: hero(a) });
    state = endTurn(endTurn(state)); // b 的下一個回合：解除
    act(state, { type: 'useSkill', player: b, zone: 0, skill: 0 });
  });

  it('身上的增益與挑釁直接消失，不會回來；拿掉 HP 增益不會讓牠死掉', () => {
    let { state, a, b } = start({ deckSize: 60 });
    place(state, a, 0, 'mesmer');
    // bruiser 10 HP，增益 +3/+3 之後受了 11 傷害：剩 2。拿掉增益後上限 10，剩的 2 不變。
    place(state, b, 0, 'bruiser', { attackCounters: 3, hpCounters: 3, damage: 11, tauntUntilTurn: 9 });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: creatureAt(b, 0) });
    const bruiser = at(state, b, 0)!;
    expect(bruiser).toMatchObject({ attackCounters: 0, hpCounters: 0, tauntUntilTurn: null });
    expect(currentHp(engine.db, state, bruiser)).toBe(2);
    expect(maxHp(engine.db, state, bruiser)).toBe(10);
    // 沒受傷的：HP 跟著上限降回去
    place(state, b, 1, 'bruiser', { hpCounters: 3 });
    state.players[a].zones[0]!.skillUsedTurn = null;
    state.players[a].energy += 1;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: creatureAt(b, 1) });
    expect(currentHp(engine.db, state, at(state, b, 1)!)).toBe(10);
  });

  it('卡上的吸血與再生在沉默時失效，沉默結束就恢復', () => {
    let { state, a, b } = start({ deckSize: 60 });
    place(state, a, 4, 'mesmer');
    place(state, b, 0, 'leech');
    place(state, b, 1, 'moss', { damage: 4 });
    state.players[b].heroDamage = 10;
    state = act(state, { type: 'useSkill', player: a, zone: 4, skill: 1, target: creatureAt(b, 0) });
    state.players[a].zones[4]!.skillUsedTurn = null;
    state.players[a].energy += 1;
    state = act(state, { type: 'useSkill', player: a, zone: 4, skill: 1, target: creatureAt(b, 1) });
    state = endTurn(state); // b 的回合：苔蘚沒有再生
    expect(at(state, b, 1)!.damage).toBe(4);
    state = act(state, { type: 'attack', player: b, zone: 0, target: hero(a) });
    expect(state.players[b].heroDamage).toBe(10); // 沒有吸血
    state = endTurn(endTurn(state)); // b 的再下一個回合：沉默結束，恢復再生
    expect(at(state, b, 1)!.damage).toBe(2);
  });
});

describe('虛弱', () => {
  it('不能攻擊，被攻擊時也不會反擊；技能照常', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'mesmer');
    place(state, a, 1, 'hitter');
    place(state, b, 0, 'brute'); // 攻擊 5
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 2, target: creatureAt(b, 0) });
    expect(engine.viewFor(state, a).opponent.zones[0]!.weakened).toBe(true);
    state = act(state, { type: 'attack', player: a, zone: 1, target: creatureAt(b, 0) });
    expect(at(state, a, 1)!.damage).toBe(0); // 沒有反擊
    expect(at(state, b, 0)!.damage).toBe(2);
    state = endTurn(state);
    expect(reject(state, { type: 'attack', player: b, zone: 0, target: hero(a) })).toBe('WEAKENED');
    state = act(state, { type: 'useSkill', player: b, zone: 0, skill: 0, target: hero(a) });
    expect(state.players[a].heroDamage).toBe(4);
    state = endTurn(endTurn(state));
    state.players[a].zones = state.players[a].zones.map(() => null); // 清掉擋在前面的生物，攻擊才打得到英雄
    state = act(state, { type: 'attack', player: b, zone: 0, target: hero(a) });
    expect(state.players[a].heroDamage).toBe(4 + 5);
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
    place(state, a, 0, 'pup', { damage: 2, poison: 3, burn: 2, paralyzedUntilTurn: 9, silencedUntilTurn: 9, weakenedUntilTurn: 9 });
    const card = give(state, a, 'hound');
    state.players[a].energy = 5;
    const result = engine.apply(state, { type: 'evolve', player: a, card, zone: 0 });
    if (!result.ok) throw new Error(result.error.message);
    const evolved = at(result.state, a, 0)!;
    expect(evolved).toMatchObject({ damage: 2, poison: 0, burn: 0, paralyzedUntilTurn: null, silencedUntilTurn: null, weakenedUntilTurn: null });
    expect(result.events).toContainEqual({ type: 'statusesCleared', player: a, zone: 0 });
  });
});

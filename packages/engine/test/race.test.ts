import { describe, expect, it } from 'vitest';
import { attackPower, currentHp } from '../src/queries';
import { act, at, creatureAt, endTurn, engine, give, hero, place, reject, start } from './helpers';

// 種族特色：每個種族一個，沉默時跟卡上其他效果一樣失效。

describe('人類：同袍', () => {
  it('我方場上有其他人類時 ⚔ +1；只有自己一隻就沒有', () => {
    const { state, a } = start();
    const first = place(state, a, 0, 'footman');
    expect(attackPower(engine.db, state, first)).toBe(2);
    const second = place(state, a, 1, 'footman');
    expect(attackPower(engine.db, state, first)).toBe(3);
    expect(attackPower(engine.db, state, second)).toBe(3);
  });

  it('沉默時失效', () => {
    const { state, a } = start();
    const first = place(state, a, 0, 'footman', { silencedUntilTurn: 9 });
    place(state, a, 1, 'footman');
    expect(attackPower(engine.db, state, first)).toBe(2);
  });
});

describe('野獸：猛撲', () => {
  it('召喚當回合就能攻擊生物，但不能打英雄', () => {
    let { state, a, b } = start();
    state.players[a].energy = 5;
    place(state, b, 0, 'wolf');
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'pouncer'), zone: 0 });
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.damage).toBe(3);

    let other = start();
    other.state.players[other.a].energy = 5;
    other.state = act(other.state, { type: 'summon', player: other.a, card: give(other.state, other.a, 'pouncer'), zone: 0 });
    expect(reject(other.state, { type: 'attack', player: other.a, zone: 0, target: hero(other.b) })).toBe('POUNCE_CREATURES_ONLY');
    // 其他種族召喚當回合還是不能攻擊
    other.state = act(other.state, { type: 'summon', player: other.a, card: give(other.state, other.a, 'footman'), zone: 4 });
    place(other.state, other.b, 4, 'wolf');
    expect(reject(other.state, { type: 'attack', player: other.a, zone: 4, target: creatureAt(other.b, 4) })).toBe('SUMMONED_THIS_TURN');
  });
});

describe('亡靈：不死', () => {
  it('第一次被打倒時留下 1♥；第二次就真的倒下', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute'); // 攻擊 5
    place(state, b, 0, 'ghoul'); // HP 3
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    const ghoul = at(state, b, 0)!;
    expect(currentHp(engine.db, state, ghoul)).toBe(1);
    expect(ghoul.undyingUsed).toBe(true);
    state = endTurn(endTurn(state));
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)).toBeNull();
  });

  it('消滅不算被打倒，直接離場', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'ghoul');
    state.players[a].energy = 9;
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'doom'), target: creatureAt(b, 0) });
    expect(at(state, b, 0)).toBeNull();
  });
});

describe('元素：元素之力', () => {
  it('技能傷害 +1，攻擊不加', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'sprite');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(3);
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(3 + 2);
  });
});

describe('植物：扎根', () => {
  it('你的回合開始時回復 1♥', () => {
    let { state, a } = start();
    place(state, a, 0, 'sapling', { damage: 3 });
    state = endTurn(endTurn(state));
    expect(at(state, a, 0)!.damage).toBe(2);
  });
});

describe('龍：龍鱗', () => {
  it('不會中異常狀態；同一個技能的其他效果照樣結算', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'mesmer');
    place(state, b, 0, 'drake');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.paralyzedUntilTurn).toBeNull();
    const dart = give(state, a, 'dart');
    state.players[a].energy = 5;
    state = act(state, { type: 'castSpell', player: a, card: dart, target: creatureAt(b, 0) });
    expect(at(state, b, 0)).toMatchObject({ damage: 1, poison: 0 });
  });
});

describe('構造體：堅固', () => {
  it('受到的傷害 −1，攻擊與技能都是', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, b, 0, 'golem');
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.damage).toBe(4);
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)).toBeNull(); // 6 HP：4 + (4 − 1)
  });
});

describe('天使：光輝', () => {
  it('召喚時你的英雄回復 3♥', () => {
    let { state, a } = start();
    state.players[a].heroDamage = 10;
    state.players[a].energy = 5;
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'cherub'), zone: 2 });
    expect(state.players[a].heroDamage).toBe(7);
  });
});

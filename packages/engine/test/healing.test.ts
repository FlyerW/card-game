import { describe, expect, it } from 'vitest';
import { heroHp } from '../src/queries';
import { act, at, creatureAt, endTurn, engine, give, hero, place, reject, start } from './helpers';

// 吸血、再生、全體回復，以及直接消滅生物。

describe('吸血', () => {
  it('技能打到誰都一樣：造成多少傷害，自己的英雄就回復多少', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'leech');
    state.players[a].heroDamage = 10;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(4);
    expect(state.players[a].heroDamage).toBe(6);
  });

  it('打生物時算減傷後的傷害；範圍傷害把每一隻加起來', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'leech');
    place(state, b, 0, 'wolf', { item: { uid: 900, cardId: 'armor' } }); // 鐵甲減 2
    place(state, b, 1, 'wolf');
    state.players[a].heroDamage = 20;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1 });
    expect(state.players[a].heroDamage).toBe(20 - (1 + 3));
  });

  it('英雄的 HP 沒有上限：滿血時吸血也會回復到超過起始 HP', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'leech');
    const before = heroHp(engine.db, state, a);
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.players[a].heroDamage).toBe(-4);
    expect(heroHp(engine.db, state, a)).toBe(before + 4);
  });

  it('沒有吸血的生物不會回復英雄', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'hitter');
    state.players[a].heroDamage = 10;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.players[a].heroDamage).toBe(10);
  });
});

describe('再生', () => {
  it('擁有者的回合開始時回復，不超過上限；對手的回合不回復', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'moss', { damage: 3 });
    state = endTurn(state); // b 的回合開始
    expect(at(state, b, 0)!.damage).toBe(1);
    state = endTurn(state); // a 的回合：不回復
    expect(at(state, b, 0)!.damage).toBe(1);
    state = endTurn(state);
    expect(at(state, b, 0)!.damage).toBe(0);
  });

  it('中毒在施放者的回合結束扣，再生在擁有者的回合開始補', () => {
    let { state, b } = start();
    place(state, b, 0, 'moss', { damage: 4, poison: 2 }); // HP 10，剩 6
    state = endTurn(state); // a 的回合結束：b 的苔蘚中毒扣 2，剩 4；b 的回合開始：再生 2，剩 6
    expect(at(state, b, 0)!.damage).toBe(4);
  });

  it('英雄被動給的再生跟卡上的相加', () => {
    const created = engine.createGame({
      seed: 1,
      players: [
        { heroId: 'mender', deck: Array(30).fill('wolf') },
        { heroId: 'mender', deck: Array(30).fill('wolf') },
      ],
      rules: { deckSize: 30, maxCopies: 99 },
    });
    if (!created.ok) throw new Error(created.error.message);
    let state = act(act(created.state, { type: 'mulligan', player: 0, cards: [] }), { type: 'mulligan', player: 1, cards: [] });
    const b = state.activePlayer === 0 ? 1 : 0;
    place(state, b, 0, 'moss', { damage: 5 });
    place(state, b, 1, 'wolf', { damage: 3 });
    state = endTurn(state);
    expect(at(state, b, 0)!.damage).toBe(2);
    expect(at(state, b, 1)!.damage).toBe(2);
  });
});

describe('全體回復', () => {
  it('自己的英雄與每隻生物各回復，對手的不回復', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'wolf', { damage: 5 });
    place(state, a, 1, 'hitter', { damage: 2 });
    place(state, b, 0, 'wolf', { damage: 5 });
    state.players[a].heroDamage = 3;
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'bloom') });
    expect(state.players[a].heroDamage).toBe(-1); // 英雄回復 4，沒有上限
    expect(at(state, a, 0)!.damage).toBe(1);
    expect(at(state, a, 1)!.damage).toBe(0);
    expect(at(state, b, 0)!.damage).toBe(5);
  });
});

describe('消滅', () => {
  it('不管 HP 多少、有沒有減傷，直接送進棄牌區', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'taunter', { item: { uid: 900, cardId: 'armor' } });
    const discard = state.players[b].discard.length;
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'doom'), target: creatureAt(b, 0) });
    expect(at(state, b, 0)).toBeNull();
    expect(state.players[b].discard.length).toBe(discard + 2); // 生物與道具
  });

  it('只能指定對手的生物', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'wolf');
    expect(reject(state, { type: 'castSpell', player: a, card: give(state, a, 'doom'), target: hero(b) })).toBe('NO_LEGAL_TARGET');
  });
});

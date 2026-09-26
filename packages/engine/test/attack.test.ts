import { describe, expect, it } from 'vitest';
import { act, at, creatureAt, endTurn, engine, give, hero, place, reject, start } from './helpers';

// 大縮模實驗：生物每回合可以攻擊（不花能量，被打的生物會反擊）或發動一個技能（花能量，不會被反擊）。

describe('攻擊', () => {
  it('不花能量；打生物時雙方同時用攻擊力打對方', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute'); // 5/6
    place(state, b, 0, 'hitter'); // 2/10
    state.players[a].energy = 0;
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.damage).toBe(5);
    expect(at(state, a, 0)!.damage).toBe(2);
    expect(state.players[a].energy).toBe(0);
  });

  it('打英雄不會被反擊', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(5);
    expect(at(state, a, 0)!.damage).toBe(0);
  });

  it('雙方同時結算：同歸於盡時兩隻都被擊倒', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute', { damage: 4 }); // 剩 2
    place(state, b, 0, 'brute', { damage: 1 }); // 剩 5
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, a, 0)).toBeNull();
    expect(at(state, b, 0)).toBeNull();
  });

  it('攻擊和技能每回合合計一次，兩種順序都一樣', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, a, 1, 'brute');
    state.players[a].energy = 10;
    const attacked = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(reject(attacked, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) })).toBe('ALREADY_ACTED');
    expect(reject(attacked, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('ALREADY_ACTED');
    const skilled = act(state, { type: 'useSkill', player: a, zone: 1, skill: 0, target: hero(b) });
    expect(reject(skilled, { type: 'attack', player: a, zone: 1, target: hero(b) })).toBe('ALREADY_ACTED');
    state = endTurn(endTurn(attacked));
    act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
  });

  it('召喚當回合不能攻擊，速攻可以', () => {
    let { state, a, b } = start();
    state.players[a].energy = 10;
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'wolf'), zone: 0 });
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('SUMMONED_THIS_TURN');
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'rusher'), zone: 1 });
    act(state, { type: 'attack', player: a, zone: 1, target: hero(b) });
  });

  it('對手有挑釁的生物時，只能攻擊牠', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, b, 0, 'hitter');
    place(state, b, 1, 'taunter', { tauntUntilTurn: 99 });
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('MUST_TARGET_TAUNT');
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) })).toBe('MUST_TARGET_TAUNT');
    act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 1) });
  });

  it('不能攻擊自己的單位，也不能攻擊空格', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, a, 1, 'wolf');
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: creatureAt(a, 1) })).toBe('ILLEGAL_TARGET');
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(a) })).toBe('ILLEGAL_TARGET');
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 3) })).toBe('ILLEGAL_TARGET');
  });

  it('麻痺不能攻擊；攻擊力 0 的生物不能攻擊', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'brute', { paralyzedUntilTurn: 99 });
    place(state, a, 1, 'wall');
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('PARALYZED');
    expect(reject(state, { type: 'attack', player: a, zone: 1, target: hero(b) })).toBe('NO_ATTACK');
  });

  it('減傷擋得住攻擊與反擊；攻擊力 0 的生物反擊 0', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute', { item: { uid: 900, cardId: 'armor' } }); // 減 2
    place(state, b, 0, 'hitter');
    place(state, b, 1, 'wall');
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, a, 0)!.damage).toBe(0);
    state = endTurn(endTurn(state));
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 1) });
    expect(at(state, b, 1)!.damage).toBe(5);
  });

  it('吸血：攻擊與反擊造成的傷害都回復英雄', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'leech'); // 攻擊 2、吸血
    place(state, b, 0, 'hitter');
    state.players[a].heroDamage = 10;
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(state.players[a].heroDamage).toBe(8);
    state = endTurn(state);
    state = act(state, { type: 'attack', player: b, zone: 0, target: creatureAt(a, 0) });
    expect(state.players[a].heroDamage).toBe(6);
  });

  it('合法動作列出每隻能動的生物對每個目標的攻擊', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, b, 2, 'hitter');
    const attacks = engine.legalActions(state, a).filter((action) => action.type === 'attack');
    expect(attacks).toEqual([
      { type: 'attack', player: a, zone: 0, target: creatureAt(b, 2) },
      { type: 'attack', player: a, zone: 0, target: hero(b) },
    ]);
  });
});

describe('只在某一方回合生效的被動', () => {
  /** 開一局，先攻玩家 a 用 first 英雄、後攻玩家 b 用 second 英雄。 */
  function withHeroes(first: string, second: string) {
    const game = start();
    game.state.players[game.a].heroId = first;
    game.state.players[game.b].heroId = second;
    return game;
  }

  it('我方回合攻擊 +1：自己攻擊時有，對手回合反擊時沒有', () => {
    const game = withHeroes('duelist', 'duelist');
    let { state } = game;
    const { a, b } = game;
    place(state, a, 0, 'brute'); // 攻擊 5
    place(state, b, 0, 'hitter'); // 攻擊 2
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(6);
    state = act(endTurn(state), { type: 'attack', player: b, zone: 0, target: creatureAt(a, 0) });
    expect(at(state, a, 0)!.damage).toBe(3); // b 的回合：b 的生物 +1，a 的反擊不加
    expect(at(state, b, 0)!.damage).toBe(5);
  });

  it('對方回合 HP 上限 +2：先吸收傷害，回到自己的回合加成消失，不會因此被擊倒', () => {
    const game = withHeroes('duelist', 'warder');
    let { state } = game;
    const { a, b } = game;
    place(state, a, 0, 'brute'); // 攻擊 5，a 的回合 +1 = 6
    place(state, b, 0, 'wolf'); // HP 6，a 的回合是 b 的對方回合：8
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.damage).toBe(6); // 8 − 6，還剩 2
    state = endTurn(state); // b 的回合：加成消失，傷害少 2
    expect(at(state, b, 0)).not.toBeNull();
    expect(at(state, b, 0)!.damage).toBe(4);
  });
});

describe('有次數限制的天生技', () => {
  it('每局只能發動規定的次數；英雄進化換成新的天生技時重新算', () => {
    let { state, a, b } = start({ deckSize: 60 });
    state.players[a].heroId = 'thrifty';
    for (let i = 0; i < 2; i++) {
      state = act(state, { type: 'heroPower', player: a, target: hero(b) });
      state = endTurn(endTurn(state));
    }
    expect(state.players[a].heroPowerUses).toBe(2);
    expect(reject(state, { type: 'heroPower', player: a, target: hero(b) })).toBe('HERO_POWER_SPENT');
    expect(engine.legalActions(state, a).some((action) => action.type === 'heroPower')).toBe(false);

    state = act(state, { type: 'evolveHero', player: a, card: give(state, a, 'thrifty-plus') });
    expect(state.players[a].heroPowerUses).toBe(0);
    state = act(state, { type: 'heroPower', player: a, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(1 + 1 + 2);
  });
});

describe('道具給的技能', () => {
  it('排在生物自己的技能後面，一樣算這隻生物這回合的行動', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute', { item: { uid: 900, cardId: 'wand' } });
    state.players[a].energy = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(3);
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('ALREADY_ACTED');
  });

  it('道具被破壞就沒有這個技能了', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'brute');
    expect(reject(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: hero(b) })).toBe('INVALID_SKILL');
  });
});

describe('場地卡的回合開始效果', () => {
  it('多抽、英雄回復、對手每隻生物失去 HP', () => {
    let { state, a, b } = start({ deckSize: 60 });
    state.players[b].field = { uid: 901, cardId: 'library' };
    const hand = state.players[b].hand.length;
    state = endTurn(state);
    expect(state.players[b].hand.length).toBe(hand + 2);

    state.players[a].field = { uid: 902, cardId: 'chapel' };
    state.players[a].heroDamage = 5;
    state = endTurn(state);
    expect(state.players[a].heroDamage).toBe(3);

    state.players[b].field = { uid: 903, cardId: 'bog' };
    place(state, a, 0, 'wolf', { damage: 5 }); // 剩 1
    place(state, a, 1, 'hitter');
    state = endTurn(state);
    expect(at(state, a, 0)).toBeNull();
    expect(at(state, a, 1)!.damage).toBe(1);
  });

  it('吸血的場地：對手生物失去多少 HP，自己的英雄就回復多少', () => {
    let { state, a, b } = start();
    state.players[b].field = { uid: 901, cardId: 'leech-bog' };
    state.players[b].heroDamage = 10;
    place(state, a, 0, 'wolf', { damage: 5 }); // 剩 1
    place(state, a, 1, 'hitter');
    place(state, a, 2, 'brute');
    state = endTurn(state);
    expect(state.players[b].heroDamage).toBe(7);
  });
});

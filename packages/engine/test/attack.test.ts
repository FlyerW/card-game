import { describe, expect, it } from 'vitest';
import { describeAbility } from '../src/describe';
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

  it('攻擊與技能每回合各一次，分開算，順序不拘', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, a, 1, 'brute');
    state.players[a].energy = 10;
    const attacked = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(reject(attacked, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('ALREADY_ATTACKED');
    const both = act(attacked, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(both.players[b].heroDamage).toBe(5 + 4);
    expect(reject(both, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) })).toBe('SKILL_ALREADY_USED');

    const skilled = act(state, { type: 'useSkill', player: a, zone: 1, skill: 0, target: hero(b) });
    act(skilled, { type: 'attack', player: a, zone: 1, target: hero(b) });
    state = endTurn(endTurn(both));
    act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
  });

  it('【休息】技能不花能量，這回合攻擊過就不能用，用了就不能攻擊', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'guard');
    place(state, a, 1, 'guard');
    state.players[a].energy = 0;
    const attacked = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(reject(attacked, { type: 'useSkill', player: a, zone: 0, skill: 0 })).toBe('MUST_REST');
    state = act(state, { type: 'useSkill', player: a, zone: 1, skill: 0 });
    expect(at(state, a, 1)!.tauntUntilTurn).not.toBeNull();
    expect(reject(state, { type: 'attack', player: a, zone: 1, target: hero(b) })).toBe('ALREADY_ATTACKED');
  });

  it('召喚當回合不能攻擊，速攻可以', () => {
    let { state, a, b } = start();
    state.players[a].energy = 10;
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'wolf'), zone: 0 });
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('SUMMONED_THIS_TURN');
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'rusher'), zone: 1 });
    act(state, { type: 'attack', player: a, zone: 1, target: hero(b) });
  });

  it('打得到的範圍裡有挑釁的生物時，只能攻擊牠；挑釁的生物不在範圍內就不受影響', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, a, 4, 'brute');
    place(state, b, 0, 'hitter');
    place(state, b, 1, 'taunter', { tauntUntilTurn: 99 });
    place(state, b, 4, 'hitter');
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) })).toBe('MUST_TARGET_TAUNT');
    act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 1) });
    act(state, { type: 'attack', player: a, zone: 4, target: creatureAt(b, 4) }); // 4 號格打不到挑釁的 1 號格
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

  it('合法動作列出每隻能動的生物在範圍內的每個目標', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, a, 3, 'brute');
    place(state, b, 2, 'hitter');
    const attacks = engine.legalActions(state, a).filter((action) => action.type === 'attack');
    expect(attacks).toEqual([
      { type: 'attack', player: a, zone: 0, target: hero(b) }, // 0 號格打得到 0、1 號格，都空著
      { type: 'attack', player: a, zone: 3, target: creatureAt(b, 2) },
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
    place(state, b, 3, 'hitter'); // 攻擊 2，在 0 號格的攻擊範圍外
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(6);
    state = endTurn(state);
    place(state, b, 1, 'hitter');
    state = act(state, { type: 'attack', player: b, zone: 1, target: creatureAt(a, 0) });
    expect(at(state, a, 0)!.damage).toBe(3); // b 的回合：b 的生物 +1，a 的反擊不加
    expect(at(state, b, 1)!.damage).toBe(5);
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
  it('排在生物自己的技能後面，跟自己的技能合計每回合一次', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute', { item: { uid: 900, cardId: 'wand' } });
    state.players[a].energy = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(3);
    expect(reject(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) })).toBe('SKILL_ALREADY_USED');
    act(state, { type: 'attack', player: a, zone: 0, target: hero(b) }); // 攻擊另外算
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

describe('能量上限 −X 的費用', () => {
  it('發動時自己的能量上限 −X，這回合的能量壓到新的上限；之後照常每回合 +2', () => {
    let { state, a, b } = start();
    state = endTurn(endTurn(state)); // 過了雙方的第一個回合
    place(state, a, 0, 'burnout');
    place(state, b, 0, 'hitter');
    state.players[a].maxEnergy = 6;
    state.players[a].energy = 6;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.damage).toBe(4);
    expect(state.players[a]).toMatchObject({ maxEnergy: 4, energy: 4 });
    state = endTurn(endTurn(state));
    expect(state.players[a].maxEnergy).toBe(6);
  });

  it('能量已經花掉的話，這回合不會再少；能量上限不夠就不能發動', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'burnout');
    state.players[a].maxEnergy = 8;
    state.players[a].energy = 1;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.players[a]).toMatchObject({ maxEnergy: 6, energy: 1 });

    const poor = start();
    place(poor.state, poor.a, 0, 'burnout');
    poor.state.players[poor.a].maxEnergy = 1;
    expect(reject(poor.state, { type: 'useSkill', player: poor.a, zone: 0, skill: 0, target: hero(poor.b) })).toBe('NOT_ENOUGH_MAX_ENERGY');
  });

  it('卡面寫成「能量上限 −X」', () => {
    const burnout = engine.db.cards.get('burnout');
    if (burnout?.kind !== 'creature') throw new Error('burnout 應該是生物');
    expect(describeAbility(burnout.skills[0]!)).toBe('sacrifice（能量上限 −2）：〔任意目標〕造成 4 傷害');
  });
});

describe('輪流的天生技', () => {
  it('每發動一次就換成另一個：抽牌用完變成棄牌，再變回抽牌', () => {
    let { state, a, b } = start({ deckSize: 60 });
    state.players[a].heroId = 'twins';
    const hand = state.players[a].hand.length;
    state = act(state, { type: 'heroPower', player: a });
    expect(state.players[a].hand.length).toBe(hand + 1); // 抽 1 張
    state = endTurn(endTurn(state));
    const theirs = state.players[b].hand.length;
    state = act(state, { type: 'heroPower', player: a });
    expect(state.players[b].hand.length).toBe(theirs - 1); // 對手棄 1 張
    state = endTurn(endTurn(state));
    const mine = state.players[a].hand.length;
    state = act(state, { type: 'heroPower', player: a });
    expect(state.players[a].hand.length).toBe(mine + 1);
  });
});

describe('我方每隻生物增益', () => {
  it('每隻我方生物都放上指示物，對手的不受影響', () => {
    let { state, a, b } = start();
    state.players[a].heroId = 'prism';
    place(state, a, 0, 'wolf');
    place(state, a, 3, 'hitter');
    place(state, b, 0, 'wolf');
    state = act(state, { type: 'heroPower', player: a });
    for (const zone of [0, 3]) expect(at(state, a, zone)).toMatchObject({ attackCounters: 1, hpCounters: 1 });
    expect(at(state, b, 0)).toMatchObject({ attackCounters: 0, hpCounters: 0 });
  });
});

describe('攻擊範圍', () => {
  it('只打得到正前方與左右兩個斜對角；邊邊的格子只有兩格', () => {
    const { state, a, b } = start();
    place(state, a, 2, 'brute');
    place(state, a, 0, 'brute');
    for (const zone of [0, 1, 2, 3, 4]) place(state, b, zone, 'wall');
    const targets = (zone: number) =>
      engine.legalActions(state, a).flatMap((action) => (action.type === 'attack' && action.zone === zone ? [action.target] : []));
    expect(targets(2)).toEqual([creatureAt(b, 1), creatureAt(b, 2), creatureAt(b, 3)]);
    expect(targets(0)).toEqual([creatureAt(b, 0), creatureAt(b, 1)]);
    expect(reject(state, { type: 'attack', player: a, zone: 2, target: creatureAt(b, 4) })).toBe('OUT_OF_RANGE');
  });

  it('範圍裡有生物就打不到英雄；範圍裡都空著才打得到', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, b, 1, 'wall');
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('OUT_OF_RANGE');
    state.players[b].zones[1] = null;
    place(state, b, 2, 'wall'); // 2 號格不在 0 號格的範圍內
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(5);
  });
});

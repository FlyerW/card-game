import { describe, expect, it } from 'vitest';
import { attackBonus, creatureDef, currentHp, heroHp, heroMaxHp, maxHp } from '../src/queries';
import type { GameState, PlayerId, Target } from '../src/types';
import { act, at, creatureAt, db, endTurn, engine, give, hero, place, reject, start } from './helpers';

describe('傷害與擊倒', () => {
  it('生物 HP 歸零就被擊倒，連同進化堆疊與道具進棄牌區', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'hitter');
    place(state, b, 0, 'wolf', { damage: 3, item: { uid: 900, cardId: 'blade' } });
    state.players[a].energy = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)).toBeNull();
    expect(state.players[b].discard.map((card) => card.cardId)).toEqual(['wolf', 'blade']);
  });

  it('英雄 HP 歸零時對手獲勝，之後不能再行動', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'hitter');
    state.players[b].heroDamage = 45;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.result).toEqual({ winner: a, reason: 'heroDefeated' });
    expect(reject(state, { type: 'endTurn', player: a })).toBe('GAME_OVER');
  });

  it('道具：攻擊加成只加在攻擊上，技能傷害不變；減傷兩種都擋', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'hitter', { item: { uid: 900, cardId: 'blade' } });
    place(state, a, 1, 'hitter', { item: { uid: 901, cardId: 'blade' } });
    place(state, b, 0, 'taunter', { item: { uid: 902, cardId: 'armor' } });
    state.players[a].energy = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)?.damage).toBe(3); // 5 − 2，利爪不加技能傷害
    state = act(state, { type: 'attack', player: a, zone: 1, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(4); // 攻擊 2 + 利爪 2，英雄沒有減傷
  });

  it('減傷不會讓傷害變成負數', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'pup');
    place(state, b, 0, 'wolf', { item: { uid: 900, cardId: 'armor' } });
    const result = engine.apply(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    if (!result.ok) throw new Error(result.error.message);
    expect(at(result.state, b, 0)?.damage).toBe(0);
    expect(result.events).toContainEqual({ type: 'damaged', target: creatureAt(b, 0), amount: 0 });
  });
});

describe('增益指示物', () => {
  it('增益 3：攻擊與 HP 上限各 +3，目前 HP 一起增加', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'bruiser', { damage: 4 });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0 });
    const bruiser = at(state, a, 0)!;
    expect([maxHp(db, state, bruiser), currentHp(db, state, bruiser), attackBonus(db, state, bruiser)]).toEqual([13, 9, 3]);

    state = endTurn(endTurn(state));
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(5); // 攻擊 2 + 3
  });

  it('只加攻擊：HP 上限不變', () => {
    let { state, a } = start();
    place(state, a, 0, 'bruiser');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1 });
    const bruiser = at(state, a, 0)!;
    expect([attackBonus(db, state, bruiser), maxHp(db, state, bruiser)]).toEqual([2, 10]);
  });

  it('指示物可以疊加', () => {
    let { state, a } = start();
    place(state, a, 0, 'bruiser');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0 });
    state = endTurn(endTurn(state));
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0 });
    expect(at(state, a, 0)).toMatchObject({ attackCounters: 6, hpCounters: 6 });
  });

  it('攻擊加成不加在技能上，範圍技能也一樣', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'bruiser', { attackCounters: 2 });
    place(state, b, 0, 'taunter');
    place(state, b, 4, 'taunter');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 3 });
    expect([at(state, b, 0)?.damage, at(state, b, 4)?.damage]).toEqual([1, 1]);
  });
});

describe('HP 減半與回復', () => {
  it('剩餘 HP 減半、無條件捨去；減傷擋不住', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'witch');
    place(state, b, 0, 'taunter', { damage: 1, item: { uid: 900, cardId: 'armor' } }); // 剩 11
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(currentHp(db, state, at(state, b, 0)!)).toBe(5);
  });

  it('對手每隻生物都減半：只剩 1 HP 的會倒下，自己的不受影響', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'witch');
    place(state, a, 1, 'taunter');
    place(state, b, 0, 'taunter', { damage: 1 }); // 剩 11
    place(state, b, 2, 'wolf', { damage: 5 }); // 剩 1
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 2 });
    expect(currentHp(db, state, at(state, b, 0)!)).toBe(5);
    expect(at(state, b, 2)).toBeNull();
    expect(at(state, a, 1)?.damage).toBe(0);
  });

  it('回復不超過 HP 上限', () => {
    let { state, a } = start();
    place(state, a, 0, 'wolf', { damage: 2 });
    state.players[a].heroDamage = 1;
    state.players[a].energy = 5;
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'mend'), target: creatureAt(a, 0) });
    expect(at(state, a, 0)?.damage).toBe(0);
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'mend'), target: hero(a) });
    expect(state.players[a].heroDamage).toBe(0);
  });
});

describe('進化', () => {
  it('HP 上限與技能換成進化卡的，已受的傷害保留', () => {
    let { state, a } = start();
    place(state, a, 0, 'pup', { damage: 4 }); // 6 − 4 = 2
    state.players[a].energy = 10;
    state = act(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 0 });
    const hound = at(state, a, 0)!;
    expect(hound.cards.map((card) => card.cardId)).toEqual(['pup', 'hound']);
    expect([maxHp(db, state, hound), currentHp(db, state, hound)]).toEqual([10, 6]);
    expect(creatureDef(db, hound).skills.map((skill) => skill.name)).toEqual(['bite2', 'sniff']);
    expect(state.players[a].energy).toBe(8);
  });

  it('最多進化一次：進化過的生物不能再疊進化卡', () => {
    let { state, a } = start();
    place(state, a, 0, 'pup');
    state.players[a].energy = 10;
    state = act(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 0 });
    state = endTurn(endTurn(state));
    state.players[a].energy = 10;
    expect(reject(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 0 })).toBe('EVOLUTION_MISMATCH');
    expect(at(state, a, 0)?.cards.map((card) => card.cardId)).toEqual(['pup', 'hound']);
  });

  it('進化卡要對上正確的進化來源', () => {
    const { state, a } = start();
    place(state, a, 0, 'pup');
    place(state, a, 1, 'wolf');
    state.players[a].energy = 10;
    expect(reject(state, { type: 'evolve', player: a, card: give(state, a, 'sprout'), zone: 0 })).toBe('EVOLUTION_MISMATCH');
    expect(reject(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 1 })).toBe('EVOLUTION_MISMATCH');
  });

  it('進化卡都算有速攻：召喚當回合就能進化，進化後馬上可以攻擊與發動技能', () => {
    let { state, a, b } = start();
    state.players[a].energy = 10;
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'pup'), zone: 0 });
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('SUMMONED_THIS_TURN');
    state = act(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 0 });
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
  });

  it('已經攻擊過的生物進化，這回合不會多一次攻擊', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'pup');
    state.players[a].energy = 10;
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    state = act(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 0 });
    expect(reject(state, { type: 'attack', player: a, zone: 0, target: hero(b) })).toBe('ALREADY_ATTACKED');
  });

  it('進化當回合可以發動技能；已經發動過的話，進化不會多給一次', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'pup');
    place(state, a, 1, 'pup');
    state.players[a].energy = 10;

    state = act(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 0 });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });

    state = act(state, { type: 'useSkill', player: a, zone: 1, skill: 0, target: hero(b) });
    state = act(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 1 });
    expect(reject(state, { type: 'useSkill', player: a, zone: 1, skill: 0, target: hero(b) })).toBe('SKILL_ALREADY_USED');
  });

  it('指示物與道具在進化後保留', () => {
    let { state, a } = start();
    place(state, a, 0, 'pup', { attackCounters: 2, item: { uid: 900, cardId: 'blade' } });
    state.players[a].energy = 10;
    state = act(state, { type: 'evolve', player: a, card: give(state, a, 'hound'), zone: 0 });
    const hound = at(state, a, 0)!;
    expect(attackBonus(db, state, hound)).toBe(4);
    expect(hound.item?.cardId).toBe('blade');
  });

  it('基礎卡不能拿來進化', () => {
    const { state, a } = start();
    place(state, a, 0, 'pup');
    expect(reject(state, { type: 'evolve', player: a, card: give(state, a, 'wolf'), zone: 0 })).toBe('WRONG_CARD_KIND');
  });
});

describe('進場效果', () => {
  const summonAt = (state: GameState, player: PlayerId, cardId: string, zone: number, target?: Target): GameState => {
    state.players[player].energy = 10;
    const card = give(state, player, cardId);
    return act(state, target === undefined ? { type: 'summon', player, card, zone } : { type: 'summon', player, card, zone, target });
  };

  it('召喚時發動，不另外花能量', () => {
    let { state, a, b } = start();
    state = summonAt(state, a, 'sparker', 0, hero(b));
    expect(state.players[b].heroDamage).toBe(2);
    expect(state.players[a].energy).toBe(9); // 只付了召喚費用 1
  });

  it('有多個目標時必須指定；只有一個時可以省略', () => {
    const { state, a, b } = start();
    place(state, b, 3, 'wolf');
    state.players[a].energy = 10;
    expect(reject(state, { type: 'summon', player: a, card: give(state, a, 'sparker'), zone: 0 })).toBe('TARGET_REQUIRED');
    const next = summonAt(state, a, 'biter', 0); // 只打生物，唯一的目標是 ④ 的狼
    expect(at(next, b, 3)?.damage).toBe(3);
  });

  it('場上沒有合法目標時照樣能召喚，只是效果不發動', () => {
    let { state, a } = start();
    state = summonAt(state, a, 'biter', 0);
    expect(at(state, a, 0)?.cards[0]?.cardId).toBe('biter');
  });

  it('可以用位置：正對面是空格就打到英雄', () => {
    let { state, a, b } = start();
    state = summonAt(state, a, 'charger', 2);
    expect(state.players[b].heroDamage).toBe(3);
    place(state, b, 4, 'taunter');
    state = summonAt(state, a, 'charger', 4);
    expect(at(state, b, 4)?.damage).toBe(3);
  });

  it('進場傷害一樣受挑釁限制', () => {
    const { state, a, b } = start();
    place(state, b, 0, 'wolf');
    place(state, b, 1, 'taunter', { tauntUntilTurn: 99 });
    state.players[a].energy = 10;
    expect(reject(state, { type: 'summon', player: a, card: give(state, a, 'sparker'), zone: 0, target: hero(b) })).toBe('MUST_TARGET_TAUNT');
  });

  it('進化成有進場效果的卡時也會發動', () => {
    let { state, a } = start();
    place(state, a, 0, 'egg');
    state.players[a].energy = 10;
    const handSize = state.players[a].hand.length;
    state = act(state, { type: 'evolve', player: a, card: give(state, a, 'chick'), zone: 0 });
    expect(state.players[a].hand).toHaveLength(handSize + 1); // 給了 chick（−1）、抽 1（+1），再加上 give 的那張
  });

  it('我方目標的進場效果可以選到自己', () => {
    let { state, a } = start();
    state = summonAt(state, a, 'rallier', 2); // 場上只有牠自己
    expect(at(state, a, 2)).toMatchObject({ attackCounters: 1, hpCounters: 1 });
  });

  it('沒有進場效果的生物不能指定目標', () => {
    const { state, a, b } = start();
    expect(reject(state, { type: 'summon', player: a, card: give(state, a, 'wolf'), zone: 0, target: hero(b) })).toBe('TARGET_NOT_ALLOWED');
  });

  it('合法動作會把每個可選的目標都列出來', () => {
    const { state, a, b } = start();
    place(state, b, 0, 'wolf');
    state.players[a].energy = 10;
    const uid = give(state, a, 'sparker');
    const summons = engine.legalActions(state, a).filter((x) => x.type === 'summon' && x.card === uid && x.zone === 2);
    expect(summons.map((x) => (x.type === 'summon' ? x.target : undefined))).toEqual([creatureAt(b, 0), hero(b)]);
  });
});

describe('從牌庫進化', () => {
  it('找進化卡：從牌庫把自己的進化卡加入手牌', () => {
    let { state, a } = start();
    place(state, a, 0, 'seed');
    state.players[a].deck.push({ uid: 900, cardId: 'sprout' });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0 });
    expect(state.players[a].hand).toContainEqual({ uid: 900, cardId: 'sprout' });
    expect(state.players[a].deck.some((card) => card.uid === 900)).toBe(false);
  });

  it('直接進化：用牌庫裡的進化卡進化，不另付進化費用，已受的傷害保留', () => {
    let { state, a } = start();
    place(state, a, 0, 'seed', { damage: 2 });
    state.players[a].deck.push({ uid: 900, cardId: 'sprout' });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1 });
    const sprout = at(state, a, 0)!;
    expect(sprout.cards.map((card) => card.cardId)).toEqual(['seed', 'sprout']);
    expect(currentHp(db, state, sprout)).toBe(10);
    expect(state.players[a].energy).toBe(0); // 只付了技能的 1 點，沒付進化費用 5
  });

  it('這回合已經進化過，或牌庫沒有對應的進化卡，就沒有效果', () => {
    let { state, a } = start();
    place(state, a, 0, 'seed', { evolvedTurn: 1 });
    state.players[a].deck.push({ uid: 900, cardId: 'sprout' });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1 });
    expect(at(state, a, 0)?.cards).toHaveLength(1);

    let other = start().state;
    const a2 = other.activePlayer;
    place(other, a2, 0, 'seed');
    other = act(other, { type: 'useSkill', player: a2, zone: 0, skill: 0 });
    expect(other.players[a2].hand.some((card) => card.cardId === 'sprout')).toBe(false);
  });
});

describe('手牌上限', () => {
  it('手牌滿 10 張時，抽到的牌直接進棄牌區', () => {
    let { state, a, b } = start();
    while (state.players[b].hand.length < 10) give(state, b, 'wolf');
    const top = state.players[b].deck[0]!;
    state = act(state, { type: 'endTurn', player: a });
    expect(state.players[b].hand).toHaveLength(10);
    expect(state.players[b].discard).toContainEqual(top);
  });
});

describe('退場', () => {
  it('讓自己的生物退場：連同道具進棄牌區，空出的格子可以再召喚', () => {
    let { state, a } = start();
    place(state, a, 0, 'hitter', { item: { uid: 900, cardId: 'armor' } });
    state = act(state, { type: 'dismiss', player: a, zone: 0 });
    expect(at(state, a, 0)).toBeNull();
    expect(state.players[a].discard.map((card) => card.cardId)).toEqual(['hitter', 'armor']);
    expect(state.players[a].energy).toBe(1); // 不花能量
    act(state, { type: 'summon', player: a, card: give(state, a, 'wolf'), zone: 0 });
  });

  it('只能在自己的回合讓自己的生物退場；空格不行', () => {
    const { state, a, b } = start();
    place(state, b, 0, 'hitter');
    expect(reject(state, { type: 'dismiss', player: b, zone: 0 })).toBe('NOT_YOUR_TURN');
    expect(reject(state, { type: 'dismiss', player: a, zone: 0 })).toBe('NO_CREATURE');
  });
});

describe('英雄進化', () => {
  function pingerGame() {
    const started = start();
    started.state.players[started.a].heroId = 'pinger';
    started.state.players[started.a].energy = 10;
    return started;
  }

  it('HP 上限增加、已受的傷害保留；天生技換成新的，被動額外多一個', () => {
    let { state, a, b } = pingerGame();
    state.players[a].heroDamage = 6; // 46 − 6 = 40
    place(state, a, 0, 'wolf');
    state = act(state, { type: 'evolveHero', player: a, card: give(state, a, 'pinger-plus') });
    expect([heroMaxHp(db, state, a), heroHp(db, state, a)]).toEqual([56, 50]);
    expect(state.players[a].energy).toBe(7);
    expect(attackBonus(db, state, at(state, a, 0)!)).toBe(1);
    state = act(state, { type: 'heroPower', player: a, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(4);
  });

  it('進場效果：打出時發動，要選目標；沒有合法目標也能進化', () => {
    let { state, a, b } = pingerGame();
    place(state, b, 0, 'hitter');
    const card = give(state, a, 'pinger-flare');
    expect(reject(state, { type: 'evolveHero', player: a, card: give(state, a, 'pinger-flare'), target: hero(b) })).toBe('ILLEGAL_TARGET');
    const options = engine.legalActions(state, a).filter((action) => action.type === 'evolveHero' && action.card === card);
    expect(options).toEqual([{ type: 'evolveHero', player: a, card, target: creatureAt(b, 0) }]);
    state = act(state, options[0]!);
    expect(at(state, b, 0)!.damage).toBe(4);
    expect(heroMaxHp(db, state, a)).toBe(51);

    // 對手場上沒有生物：照樣進化，效果不發動
    let empty = pingerGame().state;
    const a2 = empty.activePlayer;
    empty = act(empty, { type: 'evolveHero', player: a2, card: give(empty, a2, 'pinger-flare') });
    expect(empty.players[a2].heroEvolution?.cardId).toBe('pinger-flare');
  });

  it('每局只能進化一次', () => {
    let { state, a } = pingerGame();
    state = act(state, { type: 'evolveHero', player: a, card: give(state, a, 'pinger-plus') });
    expect(reject(state, { type: 'evolveHero', player: a, card: give(state, a, 'pinger-plus') })).toBe('ALREADY_EVOLVED');
  });

  it('只有對應的英雄能用', () => {
    const { state, a } = start();
    state.players[a].energy = 10;
    expect(reject(state, { type: 'evolveHero', player: a, card: give(state, a, 'pinger-plus') })).toBe('EVOLUTION_MISMATCH');
  });

  it('這回合已經用過天生技，進化後不會多一次', () => {
    let { state, a } = pingerGame();
    state = act(state, { type: 'heroPower', player: a });
    state = act(state, { type: 'evolveHero', player: a, card: give(state, a, 'pinger-plus') });
    expect(reject(state, { type: 'heroPower', player: a })).toBe('HERO_POWER_USED');
  });

  it('電腦的合法動作裡列得出英雄進化', () => {
    const { state, a } = pingerGame();
    give(state, a, 'pinger-plus');
    expect(engine.legalActions(state, a).some((action) => action.type === 'evolveHero')).toBe(true);
  });
});

describe('英雄天生技', () => {
  it('花能量，每回合一次', () => {
    let { state, a, b } = start();
    state.players[a].heroId = 'pinger';
    state.players[a].energy = 5;
    state = act(state, { type: 'heroPower', player: a });
    expect(state.players[b].heroDamage).toBe(2);
    expect(state.players[a].energy).toBe(3);
    expect(reject(state, { type: 'heroPower', player: a })).toBe('HERO_POWER_USED');
  });

  it('沒有天生技的英雄不能發動', () => {
    const { state, a } = start();
    expect(reject(state, { type: 'heroPower', player: a })).toBe('NO_HERO_POWER');
  });
});

describe('法術、道具、場地', () => {
  it('法術結算後進棄牌區', () => {
    let { state, a, b } = start();
    const zap = give(state, a, 'zap');
    state = act(state, { type: 'castSpell', player: a, card: zap, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(3);
    expect(state.players[a].discard).toContainEqual({ uid: zap, cardId: 'zap' });
    expect(state.players[a].hand.some((card) => card.uid === zap)).toBe(false);
  });

  it('每隻生物只能掛一張道具，而且要掛在自己的生物上', () => {
    let { state, a } = start();
    place(state, a, 0, 'wolf');
    state.players[a].energy = 5;
    state = act(state, { type: 'attachItem', player: a, card: give(state, a, 'blade'), zone: 0 });
    expect(reject(state, { type: 'attachItem', player: a, card: give(state, a, 'armor'), zone: 0 })).toBe('ITEM_SLOT_TAKEN');
    expect(reject(state, { type: 'attachItem', player: a, card: give(state, a, 'armor'), zone: 1 })).toBe('NO_CREATURE');
  });

  it('道具提高 HP 上限時，目前 HP 一起增加', () => {
    let { state, a } = start();
    place(state, a, 0, 'wolf', { damage: 5 });
    state = act(state, { type: 'attachItem', player: a, card: give(state, a, 'amulet'), zone: 0 });
    expect(currentHp(db, state, at(state, a, 0)!)).toBe(4);
  });

  it('每人有自己的場地區：放新的只會取代自己的舊場地卡；每回合限放一張', () => {
    let { state, a, b } = start();
    state = act(state, { type: 'playField', player: a, card: give(state, a, 'altar') });
    state.players[a].energy = 5;
    expect(reject(state, { type: 'playField', player: a, card: give(state, a, 'shrine') })).toBe('FIELD_ALREADY_PLAYED');
    state = endTurn(state);
    state = act(state, { type: 'playField', player: b, card: give(state, b, 'shrine') });
    expect([state.players[a].field?.cardId, state.players[b].field?.cardId]).toEqual(['altar', 'shrine']);
    state = endTurn(state);
    state = act(state, { type: 'playField', player: a, card: give(state, a, 'shrine') });
    expect(state.players[a].field?.cardId).toBe('shrine');
    expect(state.players[a].discard.map((card) => card.cardId)).toContain('altar');
  });

  it('場地卡只強化自己的生物', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'wolf');
    place(state, b, 0, 'wolf');
    state = act(state, { type: 'playField', player: a, card: give(state, a, 'camp') });
    expect([maxHp(db, state, at(state, a, 0)!), attackBonus(db, state, at(state, a, 0)!)]).toEqual([8, 1]);
    expect([maxHp(db, state, at(state, b, 0)!), attackBonus(db, state, at(state, b, 0)!)]).toEqual([6, 0]);
  });

  it('英雄被動也只強化自己的生物', () => {
    let { state, a, b } = start();
    state.players[b].heroId = 'warden';
    place(state, a, 0, 'hitter');
    place(state, b, 0, 'taunter');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    expect(at(state, b, 0)?.damage).toBe(4); // 5 − 1
  });

  it('場地卡被拆掉，靠它撐著 HP 的生物會倒下', () => {
    let { state, a, b } = start();
    state.players[b].field = { uid: 900, cardId: 'camp' };
    place(state, b, 0, 'wolf', { damage: 7 }); // 6 + 2 − 7 = 1
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'shatter'), target: { kind: 'field', player: b } });
    expect(state.players[b].field).toBeNull();
    expect(at(state, b, 0)).toBeNull();
    expect(state.players[b].discard.map((card) => card.cardId)).toEqual(['camp', 'wolf']);
  });

  it('破壞：可以選對手的道具或對手的場地卡，不能選自己的', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'wolf', { item: { uid: 900, cardId: 'armor' } });
    place(state, b, 1, 'wolf');
    state.players[b].field = { uid: 901, cardId: 'altar' };
    state.players[a].field = { uid: 902, cardId: 'shrine' };
    const shatter = give(state, a, 'shatter');
    expect(engine.targetsFor(state, a, { kind: 'spell', card: shatter })).toEqual([
      creatureAt(b, 0),
      { kind: 'field', player: b },
    ]);
    state = act(state, { type: 'castSpell', player: a, card: shatter, target: creatureAt(b, 0) });
    expect(at(state, b, 0)?.item).toBeNull();
    expect(state.players[b].discard).toContainEqual({ uid: 900, cardId: 'armor' });
  });

  it('沒有道具也沒有場地卡時，破壞法術不能施放', () => {
    const { state, a } = start();
    expect(reject(state, { type: 'castSpell', player: a, card: give(state, a, 'shatter') })).toBe('NO_LEGAL_TARGET');
  });

  it('隨機棄牌棄的是對手的手牌', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'witch');
    const handSize = state.players[b].hand.length;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1 });
    expect(state.players[b].hand).toHaveLength(handSize - 1);
    expect(state.players[b].discard).toHaveLength(1);
  });
});

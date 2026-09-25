import { describe, expect, it } from 'vitest';
import type { GameConfig } from '../src/engine';
import { ceiling } from '../src/queries';
import { LEGACY_ENERGY_RULES } from '../src/rules';
import { act, at, db, endTurn, engine, give, hero, place, reject, start } from './helpers';

const config = (seed: number): GameConfig => {
  const deck = Array.from({ length: 30 }, () => 'wolf');
  return {
    seed,
    players: [
      { heroId: 'blank', deck },
      { heroId: 'blank', deck },
    ],
    rules: { deckSize: 30, maxCopies: 99 },
  };
};

const created = (seed: number) => {
  const result = engine.createGame(config(seed));
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};

describe('開局', () => {
  it('雙方各抽起手牌；同樣的種子得到同樣的局面', () => {
    const state = created(99);
    expect(state.phase).toBe('mulligan');
    expect(state.players[0].hand).toHaveLength(4);
    expect(state.players[1].hand).toHaveLength(4);
    expect(created(99)).toEqual(state);
  });

  it('重抽：洗回幾張就抽回幾張，而且只能一次', () => {
    let state = created(3);
    const two = state.players[0].hand.slice(0, 2).map((card) => card.uid);
    state = act(state, { type: 'mulligan', player: 0, cards: two });
    expect(state.players[0].hand).toHaveLength(4);
    expect(state.players[0].deck).toHaveLength(26);
    expect(reject(state, { type: 'mulligan', player: 0, cards: [] })).toBe('ALREADY_MULLIGANED');
    expect(state.phase).toBe('mulligan');
  });

  it('重抽階段不能做其他動作', () => {
    expect(reject(created(1), { type: 'endTurn', player: 0 })).toBe('WRONG_PHASE');
  });

  it('雙方都重抽完才進入第 1 回合：先攻玩家抽 1 張、獲得 1 能量', () => {
    const { state, a } = start();
    expect(state.phase).toBe('main');
    expect(state.turn).toBe(1);
    expect(state.players[a].hand).toHaveLength(5);
    expect(state.players[a]).toMatchObject({ energy: 1, maxEnergy: 1 });
  });
});

describe('能量', () => {
  it('先攻從 1 開始、後攻從 2 開始，之後雙方每回合 +2：每回合都比前一回合多 1', () => {
    let { state, a, b } = start({ deckSize: 60 });
    const seen: number[] = [state.players[a].maxEnergy];
    for (let i = 0; i < 7; i++) {
      state = endTurn(state);
      seen.push(state.players[state.activePlayer].maxEnergy);
    }
    // 先攻 1、後攻 2、先攻 3、後攻 4……
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(state.players[b].energy).toBe(8);
  });

  it('能量上限最高 12', () => {
    let { state, a, b } = start({ deckSize: 60 });
    for (let i = 0; i < 30; i++) state = endTurn(state);
    expect(state.activePlayer).toBe(a);
    expect(state.players[a]).toMatchObject({ maxEnergy: 12, energy: 12 });
    expect(state.players[b].maxEnergy).toBe(12);
  });

  it('舊制：從 1 開始每回合 +1、最高 10，後攻第一回合補 1 點', () => {
    const deck = Array.from({ length: 60 }, () => 'wolf');
    const created = engine.createGame({
      seed: 1,
      players: [
        { heroId: 'blank', deck },
        { heroId: 'blank', deck },
      ],
      rules: { deckSize: 60, maxCopies: 99, ...LEGACY_ENERGY_RULES },
    });
    if (!created.ok) throw new Error(created.error.message);
    let state = act(created.state, { type: 'mulligan', player: 0, cards: [] });
    state = act(state, { type: 'mulligan', player: 1, cards: [] });
    const a = state.activePlayer;
    const b = a === 0 ? 1 : 0;

    state = endTurn(state);
    expect(state.players[b]).toMatchObject({ maxEnergy: 1, energy: 2 });
    state = endTurn(state);
    expect(state.players[a]).toMatchObject({ maxEnergy: 2, energy: 2 });
    state = endTurn(state);
    expect(state.players[b]).toMatchObject({ maxEnergy: 2, energy: 2 });
    for (let i = 0; i < 30; i++) state = endTurn(state);
    expect(state.players[state.activePlayer].maxEnergy).toBe(10);
  });

  it('沒花完的能量留到對手的回合；自己的回合開始時才重置，不會累加', () => {
    let { state, a } = start();
    state = endTurn(state);
    expect(state.players[a].energy).toBe(1); // 對手回合時還留著，之後可用於對手回合的互動
    state = endTurn(state);
    expect(state.players[a].energy).toBe(3); // 重置成新的上限 3，不是 1 + 3
  });

  it('雙方看得到對手的英雄之後才決定要不要重抽', () => {
    const state = created(5);
    state.players[1].heroId = 'pinger';
    expect(state.phase).toBe('mulligan');
    expect(engine.viewFor(state, 0).opponent.heroId).toBe('pinger');
  });

  it('英雄被動可以提高最高上限', () => {
    let { state, a } = start({ deckSize: 60 });
    state.players[a].heroId = 'forester';
    for (let i = 0; i < 30; i++) state = endTurn(state);
    expect(state.players[a].maxEnergy).toBe(13);
  });

  it('加速型：能量上限 +1，當回合不補能量，也不超過最高上限', () => {
    let { state, a } = start();
    place(state, a, 0, 'grower');
    Object.assign(state.players[a], { energy: 5, maxEnergy: 3 });
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0 });
    expect(state.players[a]).toMatchObject({ maxEnergy: 4, energy: 4 });

    Object.assign(state.players[a], { energy: 5, maxEnergy: 12 });
    at(state, a, 0)!.actedTurn = null;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0 });
    expect(state.players[a].maxEnergy).toBe(12);
  });

  // 突破型目前先不出（維持上限 12），但引擎保留這個能力，所以繼續測。
  it('突破型：最高上限永久提高', () => {
    let { state, a } = start({ deckSize: 60 });
    place(state, a, 0, 'grower');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 1 });
    expect(ceiling(db, state, a)).toBe(14);
    for (let i = 0; i < 30; i++) state = endTurn(state);
    expect(state.players[a].maxEnergy).toBe(14);
  });

  it('場地卡只影響擁有者的最高上限；被破壞後，能量上限在下個回合開始時壓回', () => {
    let { state, a, b } = start({ deckSize: 60 });
    state = act(state, { type: 'playField', player: a, card: give(state, a, 'altar') });
    expect([ceiling(db, state, a), ceiling(db, state, b)]).toEqual([14, 12]);
    for (let i = 0; i < 30; i++) state = endTurn(state);
    expect(state.players[a].maxEnergy).toBe(14);

    state = endTurn(state);
    state = act(state, { type: 'castSpell', player: b, card: give(state, b, 'shatter'), target: { kind: 'field', player: a } });
    expect(state.players[a].field).toBeNull();
    expect(state.players[a].maxEnergy).toBe(14);
    state = endTurn(state);
    expect(state.players[a].maxEnergy).toBe(12);
  });
});

describe('回合', () => {
  it('只有輪到的玩家能行動', () => {
    const { state, b } = start();
    expect(reject(state, { type: 'endTurn', player: b })).toBe('NOT_YOUR_TURN');
  });

  it('發動技能不會結束回合，宣告結束才換人', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'wolf');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.activePlayer).toBe(a);
    expect(state.turn).toBe(1);
  });

  it('同一隻生物每回合只能發動一個技能，不同生物各自可以發動', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'hitter');
    place(state, a, 1, 'hitter');
    state.players[a].energy = 5;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(reject(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) })).toBe('ALREADY_ACTED');
    state = act(state, { type: 'useSkill', player: a, zone: 1, skill: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(10);

    state = endTurn(endTurn(state));
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(15);
  });

  it('召喚當回合不能發動技能；有突襲的可以', () => {
    let { state, a, b } = start();
    state.players[a].energy = 5;
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'wolf'), zone: 0 });
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'rusher'), zone: 1 });
    expect(reject(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) })).toBe('SUMMONED_THIS_TURN');
    state = act(state, { type: 'useSkill', player: a, zone: 1, skill: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(2);
  });

  it('回合開始時牌庫是空的就落敗', () => {
    let { state, a, b } = start();
    state.players[b].deck = [];
    state = endTurn(state);
    expect(state.result).toEqual({ winner: a, reason: 'deckOut' });
    expect(reject(state, { type: 'endTurn', player: b })).toBe('GAME_OVER');
  });

  it('效果抽牌抽到牌庫空為止，不會因此落敗', () => {
    let { state, a } = start();
    place(state, a, 0, 'scholar');
    state.players[a].deck = [];
    const handSize = state.players[a].hand.length;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0 });
    expect(state.players[a].hand).toHaveLength(handSize);
    expect(state.phase).toBe('main');
  });

  it('投降', () => {
    const { state, a, b } = start();
    expect(act(state, { type: 'concede', player: b }).result).toEqual({ winner: a, reason: 'concede' });
  });
});

describe('召喚', () => {
  it('付召喚費用、放進指定的格子', () => {
    let { state, a } = start();
    state.players[a].energy = 5;
    const uid = give(state, a, 'pricey');
    state = act(state, { type: 'summon', player: a, card: uid, zone: 3 });
    expect(at(state, a, 3)?.cards).toEqual([{ uid, cardId: 'pricey' }]);
    expect(state.players[a].energy).toBe(0);
    expect(state.players[a].hand.some((card) => card.uid === uid)).toBe(false);
  });

  it('能量不足不能召喚', () => {
    const { state, a } = start();
    expect(reject(state, { type: 'summon', player: a, card: give(state, a, 'pricey'), zone: 0 })).toBe('NOT_ENOUGH_ENERGY');
  });

  it('格子有生物就不能召喚；五格都滿時列不出任何召喚動作', () => {
    const { state, a } = start();
    for (let zone = 0; zone < 5; zone++) place(state, a, zone, 'wolf');
    const uid = give(state, a, 'wolf');
    expect(reject(state, { type: 'summon', player: a, card: uid, zone: 2 })).toBe('ZONE_OCCUPIED');
    expect(engine.legalActions(state, a).some((action) => action.type === 'summon')).toBe(false);
  });

  it('格子編號超出範圍', () => {
    const { state, a } = start();
    expect(reject(state, { type: 'summon', player: a, card: give(state, a, 'wolf'), zone: 5 })).toBe('INVALID_ZONE');
  });

  it('進化卡不能直接召喚', () => {
    const { state, a } = start();
    state.players[a].energy = 5;
    expect(reject(state, { type: 'summon', player: a, card: give(state, a, 'hound'), zone: 0 })).toBe('NOT_BASE_CREATURE');
  });
});

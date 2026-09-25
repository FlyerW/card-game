import { describe, expect, it } from 'vitest';
import { act, at, creatureAt, declare, endTurn, engine, give, hero, place, reject, start } from './helpers';

// 即時回應：宣告之後、結算之前，對手可以用存下來的能量回應；後打出的先結算。

/** 開局後讓後攻玩家有能量可以回應：先把回合交給他再交回來，他的能量會留著。 */
function withStoredEnergy() {
  const started = start({ deckSize: 60 });
  let { state } = started;
  state = endTurn(state); // b 的第 1 回合，2 點能量，不花
  state = endTurn(state); // 回到 a，b 的 2 點能量留著
  return { ...started, state };
}

describe('回應的時機', () => {
  it('對手有存能量：宣告後先等他決定，不回應才結算', () => {
    let { state, a, b } = withStoredEnergy();
    place(state, a, 0, 'hitter');
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.window).toBe(b);
    expect(state.chain).toHaveLength(1);
    expect(state.players[b].heroDamage).toBe(0);
    expect(engine.viewFor(state, b)).toMatchObject({ window: b, chain: [{ player: a, ability: 'any5' }] });

    state = declare(state, { type: 'pass', player: b });
    expect(state.window).toBeNull();
    expect(state.chain).toEqual([]);
    expect(state.players[b].heroDamage).toBe(5);
  });

  it('對手沒有存能量就不用等，直接結算', () => {
    let { state, a, b } = start();
    expect(state.players[b].energy).toBe(0);
    place(state, a, 0, 'hitter');
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.window).toBeNull();
    expect(state.players[b].heroDamage).toBe(5);
  });

  it('召喚、道具這類沒有效果要結算的動作之後，也會問對手要不要回應', () => {
    let { state, a, b } = withStoredEnergy();
    const wolf = give(state, a, 'wolf');
    state = declare(state, { type: 'summon', player: a, card: wolf, zone: 0 });
    expect(at(state, a, 0)).not.toBeNull(); // 生物已經在場上
    expect(state.window).toBe(b);
    expect(state.chain).toEqual([]);
  });

  it('等待回應時只有被問的一方能動，而且只能用瞬發法術或【瞬發】技能', () => {
    let { state, a, b } = withStoredEnergy();
    place(state, a, 0, 'hitter');
    place(state, b, 0, 'sentry');
    const zap = give(state, b, 'zap');
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(reject(state, { type: 'endTurn', player: a })).toBe('WAITING_FOR_RESPONSE');
    expect(reject(state, { type: 'castSpell', player: b, card: zap, target: hero(a) })).toBe('NOT_INSTANT');
    expect(reject(state, { type: 'useSkill', player: b, zone: 0, skill: 1, target: hero(a) })).toBe('NOT_INSTANT');
    expect(reject(state, { type: 'summon', player: b, card: give(state, b, 'wolf'), zone: 1 })).toBe('NOT_INSTANT');

    const options = engine.legalActions(state, b).map((action) => action.type);
    expect(options).toContain('pass');
    expect(options).toContain('useSkill');
    expect(options).not.toContain('castSpell'); // zap 不是瞬發
    expect(engine.legalActions(state, a)).toEqual([]);
    expect(engine.actor(state)).toBe(b);
  });

  it('沒有在等回應時不能不回應', () => {
    const { state, a } = start();
    expect(reject(state, { type: 'pass', player: a })).toBe('NOTHING_TO_RESPOND');
  });

  it('瞬發法術在自己的回合也可以當一般法術用', () => {
    let { state, a, b } = start();
    const snap = give(state, a, 'snap');
    state = act(state, { type: 'castSpell', player: a, card: snap, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(3);
  });
});

describe('連鎖', () => {
  it('後打出的先結算', () => {
    let { state, a, b } = withStoredEnergy();
    state.players[a].energy = 5;
    place(state, a, 0, 'hitter');
    place(state, b, 0, 'taunter'); // HP 12
    const snap = give(state, b, 'snap');
    const mend = give(state, a, 'quick-mend');

    // a 攻擊 → b 用 snap 打 a 的攻擊者 → a 用 quick-mend 回復攻擊者。
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 1, target: creatureAt(b, 0) });
    state = declare(state, { type: 'castSpell', player: b, card: snap, target: creatureAt(a, 0) });
    expect(state.window).toBe(a);
    state = declare(state, { type: 'castSpell', player: a, card: mend, target: creatureAt(a, 0) });
    expect(state.window).toBe(b);
    expect(state.chain.map((link) => link.ability.name)).toEqual(['creature6', 'snap', 'quick-mend']);

    const result = engine.apply(state, { type: 'pass', player: b });
    if (!result.ok) throw new Error(result.error.message);
    const order = result.events.filter((e) => e.type === 'resolving').map((e) => e.type === 'resolving' && e.ability);
    expect(order).toEqual(['quick-mend', 'snap', 'creature6']);
    // 回復先結算，攻擊者那時還沒受傷，所以回復 0；之後才吃到 snap 的 3。
    expect(at(result.state, a, 0)!.damage).toBe(3);
    expect(at(result.state, b, 0)!.damage).toBe(6);
    // 法術結算完進棄牌區。
    expect(result.state.players[a].discard.map((c) => c.cardId)).toContain('quick-mend');
    expect(result.state.players[b].discard.map((c) => c.cardId)).toContain('snap');
  });

  it('發動的生物在結算前被打倒，牠的技能就不發動', () => {
    let { state, a, b } = withStoredEnergy();
    place(state, a, 0, 'hitter', { damage: 8 }); // 剩 2 HP
    const snap = give(state, b, 'snap');
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    state = declare(state, { type: 'castSpell', player: b, card: snap, target: creatureAt(a, 0) });
    const result = engine.apply(state, { type: 'pass', player: a });
    if (!result.ok) throw new Error(result.error.message);
    expect(at(result.state, a, 0)).toBeNull();
    expect(result.state.players[b].heroDamage).toBe(0);
    expect(result.events).toContainEqual({ type: 'fizzled', player: a, cardId: 'hitter', ability: 'any5' });
  });

  it('目標在結算前離場了，針對它的效果不發動', () => {
    let { state, a, b } = withStoredEnergy();
    state.players[a].energy = 5;
    place(state, a, 0, 'hitter');
    place(state, b, 0, 'wolf'); // HP 6
    const snap = give(state, a, 'snap');
    const snap2 = give(state, b, 'snap');
    // a 用 any5 打 b 的狼 → b 回應打 a 的英雄 → a 再用 snap 把狼打死（6 − 3 還剩 3，所以先補傷害）
    at(state, b, 0)!.damage = 3;
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(b, 0) });
    state = declare(state, { type: 'castSpell', player: b, card: snap2, target: hero(a) });
    state = declare(state, { type: 'castSpell', player: a, card: snap, target: creatureAt(b, 0) });
    const result = engine.apply(state, { type: 'pass', player: b });
    if (!result.ok) throw new Error(result.error.message);
    expect(at(result.state, b, 0)).toBeNull();
    const damaged = result.events.filter((e) => e.type === 'damaged');
    expect(damaged).toHaveLength(2); // snap 打狼、snap 打英雄；any5 沒有目標了
    expect(result.state.players[a].heroDamage).toBe(3);
  });
});

describe('宣告回合結束', () => {
  it('對手最後一次回應；他的回應結算完還可以再用，不用了回合才結束', () => {
    let { state, a, b } = withStoredEnergy();
    const snap1 = give(state, b, 'snap');
    const snap2 = give(state, b, 'snap');
    const turn = state.turn;
    state.players[a].energy = 0;
    state.players[b].energy = 3;

    state = declare(state, { type: 'endTurn', player: a });
    expect(state).toMatchObject({ window: b, endingTurn: true, turn });
    state = declare(state, { type: 'castSpell', player: b, card: snap1, target: hero(a) });
    // a 沒有能量，不用等 a；結算完再問 b 一次。
    expect(state).toMatchObject({ window: b, endingTurn: true, turn });
    expect(state.players[a].heroDamage).toBe(3);
    state = declare(state, { type: 'castSpell', player: b, card: snap2, target: hero(a) });
    expect(state).toMatchObject({ window: b, turn }); // 還剩 1 點，再問一次
    state = declare(state, { type: 'pass', player: b });
    expect(state).toMatchObject({ window: null, endingTurn: false, turn: turn + 1, activePlayer: b });
    expect(state.players[a].heroDamage).toBe(6);
  });

  it('對手把能量用完，回應結算完就直接換回合', () => {
    let { state, a, b } = withStoredEnergy();
    state.players[a].energy = 0;
    state.players[b].energy = 1;
    const snap = give(state, b, 'snap');
    state = declare(state, { type: 'endTurn', player: a });
    state = declare(state, { type: 'castSpell', player: b, card: snap, target: hero(a) });
    expect(state).toMatchObject({ window: null, activePlayer: b });
  });

  it('對手沒有存能量，宣告結束就直接換回合', () => {
    let { state, b } = start();
    state = declare(state, { type: 'endTurn', player: state.activePlayer });
    expect(state).toMatchObject({ window: null, activePlayer: b });
  });
});

describe('【瞬發】技能', () => {
  it('對手的回合用過，不影響牠在自己回合的那一次', () => {
    let { state, a, b } = withStoredEnergy();
    place(state, a, 0, 'hitter');
    place(state, b, 0, 'sentry');
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    state = act(state, { type: 'useSkill', player: b, zone: 0, skill: 0, target: hero(a) });
    expect(state.players[a].heroDamage).toBe(2);
    state = endTurn(state);
    act(state, { type: 'useSkill', player: b, zone: 0, skill: 1, target: hero(a) });
  });

  it('在擁有者自己的回合被回應麻痺，要到他的下一個回合結束才解除', () => {
    let { state, a, b } = withStoredEnergy();
    place(state, a, 0, 'hitter');
    const freeze = give(state, b, 'freeze');
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    state = act(state, { type: 'castSpell', player: b, card: freeze, target: creatureAt(a, 0) });
    expect(state.players[b].heroDamage).toBe(5); // 已經宣告的技能照樣結算
    state = endTurn(endTurn(state)); // a 的下一個回合
    expect(reject(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) })).toBe('PARALYZED');
    state = endTurn(endTurn(state));
    act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
  });
});

describe('分出勝負', () => {
  it('連鎖中途分出勝負，剩下的效果不發動，法術卡照樣進棄牌區', () => {
    let { state, a, b } = withStoredEnergy();
    state.players[a].energy = 5;
    state.players[b].heroDamage = 47; // 剩 3
    place(state, a, 0, 'hitter');
    const snap = give(state, a, 'snap');
    const mend = give(state, b, 'quick-mend');
    // a 打英雄 → b 回應回復自己的英雄 → a 再用 snap 打英雄：snap 先結算，b 就倒了。
    state = declare(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    state = declare(state, { type: 'castSpell', player: b, card: mend, target: hero(b) });
    state = declare(state, { type: 'castSpell', player: a, card: snap, target: hero(b) });
    state = declare(state, { type: 'pass', player: b });
    expect(state.result).toEqual({ winner: a, reason: 'heroDefeated' });
    expect(state).toMatchObject({ chain: [], window: null });
    expect(state.players[b].heroDamage).toBe(50); // 回復與 any5 都沒有結算
    expect(state.players[a].discard.map((c) => c.cardId)).toContain('snap');
    expect(state.players[b].discard.map((c) => c.cardId)).toContain('quick-mend');
  });
});

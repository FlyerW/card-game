import { describe, expect, it } from 'vitest';
import { isTaunting } from '../src/queries';
import type { GameState, PlayerId } from '../src/types';
import { act, at, creatureAt, endTurn, engine, give, hero, place, reject, start } from './helpers';

const targetsOf = (state: GameState, player: PlayerId, zone: number, skill: number) =>
  engine.targetsFor(state, player, { kind: 'skill', zone, skill });

describe('目標類型', () => {
  it('任意目標：對手的生物與英雄都能選，自己的不行', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'hitter');
    place(state, a, 1, 'wolf');
    place(state, b, 2, 'wolf');
    expect(targetsOf(state, a, 0, 0)).toEqual([creatureAt(b, 2), hero(b)]);
  });

  it('只打生物：不能選英雄；對手沒有生物時不能發動', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'hitter');
    expect(reject(state, { type: 'useSkill', player: a, zone: 0, skill: 1 })).toBe('NO_LEGAL_TARGET');
    place(state, b, 4, 'wolf');
    expect(targetsOf(state, a, 0, 1)).toEqual([creatureAt(b, 4)]);
  });

  it('只打英雄：場上有生物也只能打英雄', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'burner');
    place(state, b, 0, 'wolf');
    expect(targetsOf(state, a, 0, 0)).toEqual([hero(b)]);
  });

  it('只有一個合法目標時可以不指定', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'burner');
    expect(act(state, { type: 'useSkill', player: a, zone: 0, skill: 0 }).players[b].heroDamage).toBe(6);
  });

  it('有多個合法目標時必須指定', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'hitter');
    place(state, b, 0, 'wolf');
    expect(reject(state, { type: 'useSkill', player: a, zone: 0, skill: 0 })).toBe('TARGET_REQUIRED');
  });

  it('不需要目標的技能不能指定目標', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'scholar');
    expect(reject(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) })).toBe('TARGET_NOT_ALLOWED');
  });
});

describe('位置技能', () => {
  it('正對面：打同一欄的對手生物', () => {
    const { state, a, b } = start();
    place(state, a, 2, 'lancer');
    place(state, b, 2, 'hitter');
    expect(targetsOf(state, a, 2, 0)).toEqual([creatureAt(b, 2)]);
    expect(at(act(state, { type: 'useSkill', player: a, zone: 2, skill: 0 }), b, 2)?.damage).toBe(7);
  });

  it('正對面是空格：打到對手英雄', () => {
    const { state, a, b } = start();
    place(state, a, 2, 'lancer');
    place(state, b, 1, 'wolf');
    expect(targetsOf(state, a, 2, 0)).toEqual([hero(b)]);
    expect(act(state, { type: 'useSkill', player: a, zone: 2, skill: 0 }).players[b].heroDamage).toBe(7);
  });

  it('斜對角：左右兩格擇一', () => {
    const { state, a, b } = start();
    place(state, a, 2, 'lancer');
    place(state, b, 1, 'wolf');
    place(state, b, 3, 'wolf');
    expect(targetsOf(state, a, 2, 1)).toEqual([creatureAt(b, 1), creatureAt(b, 3)]);
  });

  it('斜對角只有一格有生物，就只能打那一格，不能故意改打英雄', () => {
    const { state, a, b } = start();
    place(state, a, 2, 'lancer');
    place(state, b, 3, 'wolf');
    expect(targetsOf(state, a, 2, 1)).toEqual([creatureAt(b, 3)]);
    expect(reject(state, { type: 'useSkill', player: a, zone: 2, skill: 1, target: hero(b) })).toBe('ILLEGAL_TARGET');
  });

  it('斜對角兩格都空：打到英雄，即使別的格子有生物', () => {
    const { state, a, b } = start();
    place(state, a, 2, 'lancer');
    place(state, b, 2, 'wolf');
    expect(targetsOf(state, a, 2, 1)).toEqual([hero(b)]);
  });

  it('邊角的斜對角只有一格', () => {
    const { state, a, b } = start();
    place(state, a, 0, 'lancer');
    place(state, b, 1, 'wolf');
    place(state, b, 4, 'wolf');
    expect(targetsOf(state, a, 0, 1)).toEqual([creatureAt(b, 1)]);
  });
});

describe('挑釁', () => {
  /** 先攻玩家在 ③ 放挑釁者並發動挑釁、在 ① 放一隻狼，然後結束回合。停在後攻玩家的回合。 */
  function taunted() {
    let { state, a, b } = start();
    place(state, a, 2, 'taunter');
    place(state, a, 0, 'wolf');
    state = act(state, { type: 'useSkill', player: a, zone: 2, skill: 0 });
    state = endTurn(state);
    state.players[b].energy = 10;
    return { state, a, b };
  }

  it('任意目標的技能必須打挑釁生物', () => {
    const { state, a, b } = taunted();
    place(state, b, 4, 'hitter');
    expect(targetsOf(state, b, 4, 0)).toEqual([creatureAt(a, 2)]);
    expect(reject(state, { type: 'useSkill', player: b, zone: 4, skill: 0, target: hero(a) })).toBe('MUST_TARGET_TAUNT');
    expect(reject(state, { type: 'useSkill', player: b, zone: 4, skill: 0, target: creatureAt(a, 0) })).toBe('MUST_TARGET_TAUNT');
    const next = act(state, { type: 'useSkill', player: b, zone: 4, skill: 0, target: creatureAt(a, 2) });
    expect(at(next, a, 2)?.damage).toBe(5);
  });

  it('只打生物的技能也必須打挑釁生物', () => {
    const { state, a, b } = taunted();
    place(state, b, 4, 'hitter');
    expect(targetsOf(state, b, 4, 1)).toEqual([creatureAt(a, 2)]);
  });

  it('只打英雄的技能選不到挑釁生物，所以不受影響', () => {
    const { state, a, b } = taunted();
    place(state, b, 4, 'burner');
    expect(targetsOf(state, b, 4, 0)).toEqual([hero(a)]);
  });

  it('位置技能：挑釁生物不在射程內就不受影響', () => {
    const { state, a, b } = taunted();
    place(state, b, 0, 'lancer');
    expect(targetsOf(state, b, 0, 0)).toEqual([creatureAt(a, 0)]); // 正對面是狼
    expect(targetsOf(state, b, 0, 1)).toEqual([hero(a)]); // 斜對角 ② 是空的
  });

  it('位置技能：挑釁生物在射程內就必須打牠', () => {
    const { state, a, b } = taunted();
    place(state, b, 1, 'lancer'); // 斜對角是 ① 的狼和 ③ 的挑釁者
    expect(targetsOf(state, b, 1, 1)).toEqual([creatureAt(a, 2)]);
  });

  it('法術和天生技也受挑釁限制', () => {
    const { state, a, b } = taunted();
    const zap = give(state, b, 'zap');
    expect(engine.targetsFor(state, b, { kind: 'spell', card: zap })).toEqual([creatureAt(a, 2)]);
    state.players[b].heroId = 'pinger';
    expect(engine.targetsFor(state, b, { kind: 'heroPower' })).toEqual([creatureAt(a, 2)]);
  });

  it('HP 減半不算傷害，不受挑釁限制', () => {
    const { state, a, b } = taunted();
    place(state, b, 4, 'witch');
    expect(targetsOf(state, b, 4, 0)).toEqual([creatureAt(a, 0), creatureAt(a, 2)]);
  });

  it('範圍傷害照樣打到每一隻', () => {
    const { state, a, b } = taunted();
    place(state, b, 4, 'burner');
    const next = act(state, { type: 'useSkill', player: b, zone: 4, skill: 1 });
    expect([at(next, a, 0)?.damage, at(next, a, 2)?.damage]).toEqual([2, 2]);
  });

  it('挑釁持續到對手的回合結束', () => {
    const { state, a } = taunted();
    expect(isTaunting(state, at(state, a, 2)!)).toBe(true);
    const back = endTurn(state);
    expect(isTaunting(back, at(back, a, 2)!)).toBe(false);
  });

  it('挑釁生物被擊倒後，限制立刻解除', () => {
    const { state, a, b } = taunted();
    at(state, a, 2)!.damage = 11;
    place(state, b, 3, 'hitter');
    place(state, b, 4, 'hitter');
    const next = act(state, { type: 'useSkill', player: b, zone: 3, skill: 0, target: creatureAt(a, 2) });
    expect(at(next, a, 2)).toBeNull();
    expect(targetsOf(next, b, 4, 0)).toEqual([creatureAt(a, 0), hero(a)]);
  });
});

import { describe, expect, it } from 'vitest';
import { describeHero, describePassive } from '../src/describe';
import { BOSS_HEROES } from '../src/cards/bosses';
import { sampleDb } from '../src/cards/sample';
import { act, at, db, endTurn, give, hero, place, start } from './helpers';

/** 開一局，後攻玩家 b 換成 BOSS。 */
function withBoss() {
  const game = start();
  game.state.players[game.b].heroId = 'overlord';
  return game;
}

describe('BOSS 專屬的被動', () => {
  it('英雄減傷：生物攻擊、法術打到 BOSS 都少扣，扣到 0 為止', () => {
    const game = withBoss();
    let { state } = game;
    const { a, b } = game;
    place(state, a, 0, 'brute'); // 攻擊 5
    state = act(state, { type: 'attack', player: a, zone: 0, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(3);
    const zap = give(state, a, 'zap'); // 3 點傷害
    state = act(state, { type: 'castSpell', player: a, card: zap, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(4);
  });

  it('回合開始時發動：BOSS 每個回合開始召喚一隻衍生物，對手的回合不會', () => {
    const game = withBoss();
    let { state } = game;
    const { a, b } = game;
    state = endTurn(state); // 輪到 BOSS
    const imps = () => state.players[b].zones.filter((creature) => creature?.cards.at(-1)?.cardId === 'imp-token').length;
    expect(imps()).toBe(1);
    state = endTurn(state);
    expect(imps()).toBe(1);
    expect(state.players[a].zones.every((creature) => creature === null)).toBe(true);
    state = endTurn(state);
    expect(imps()).toBe(2);
    expect(at(state, b, 0)).not.toBeNull();
  });

  it('說明文字寫出減傷與回合開始的效果，標成 BOSS 而不是稀有度', () => {
    expect(describeHero(db.heroes.get('overlord')!)[0]).toContain('BOSS・');
    const text = describePassive(db.heroes.get('overlord')!.passive!);
    expect(text).toContain('2');
    expect(text).toContain('回合開始');
  });
});

describe('冒險模式的 BOSS 資料', () => {
  const full = sampleDb();
  it('每個 BOSS 都標成 boss，惡夢版本比一般版本 HP 高，並且有專屬的被動', () => {
    for (const boss of BOSS_HEROES) expect(boss.boss).toBe(true);
    for (const nightmare of BOSS_HEROES.filter((boss) => boss.id.endsWith('-nightmare'))) {
      const normal = full.heroes.get(nightmare.id.replace(/-nightmare$/, ''))!;
      expect(normal).toBeDefined();
      expect(nightmare.hp).toBeGreaterThan(normal.hp);
      expect(nightmare.passive).toBeDefined();
    }
  });
});

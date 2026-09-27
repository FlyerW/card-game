import { describe, expect, it } from 'vitest';
import { describeCard } from '../src/describe';
import type { DeckCardDef } from '../src/types';
import { act, at, creatureAt, db, endTurn, engine, give, hero, place, reject, start } from './helpers';

describe('聖盾', () => {
  it('第一次受到傷害變成 0、聖盾消失；第二次照常受傷', () => {
    let { state, a, b } = start();
    const guardian = give(state, a, 'guardian');
    state = act(state, { type: 'summon', player: a, card: guardian, zone: 0 });
    expect(at(state, a, 0)!.shield).toBe(true);
    state = endTurn(state);
    const zap = give(state, b, 'zap');
    state = act(state, { type: 'castSpell', player: b, card: zap, target: creatureAt(a, 0) });
    expect(at(state, a, 0)).toMatchObject({ shield: false, damage: 0 });
    const zap2 = give(state, b, 'zap');
    state.players[b].energy = 5;
    state = act(state, { type: 'castSpell', player: b, card: zap2, target: creatureAt(a, 0) });
    expect(at(state, a, 0)!.damage).toBe(3);
  });

  it('攻擊與反擊也擋；打生物時攻擊方的聖盾也會被反擊打掉', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'brute');
    place(state, b, 0, 'wolf');
    at(state, a, 0)!.shield = true;
    at(state, b, 0)!.shield = true;
    state = act(state, { type: 'attack', player: a, zone: 0, target: creatureAt(b, 0) });
    expect(at(state, a, 0)).toMatchObject({ shield: false, damage: 0 });
    expect(at(state, b, 0)).toMatchObject({ shield: false, damage: 0 });
  });

  it('擋不住中毒；沉默會拿掉聖盾', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'guardian');
    at(state, b, 0)!.shield = true;
    at(state, b, 0)!.poison = 2;
    state = endTurn(endTurn(state)); // a 的回合結束時中毒發作
    expect(at(state, b, 0)).toMatchObject({ shield: true, damage: 2 });
    const hush = give(state, a, 'hush');
    state = act(state, { type: 'castSpell', player: a, card: hush, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.shield).toBe(false);
  });

  it('效果可以給聖盾：目標、我方每隻生物；已經有的不會疊', () => {
    let { state, a } = start();
    place(state, a, 0, 'shield-giver');
    place(state, a, 1, 'wolf');
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: creatureAt(a, 1) });
    expect(at(state, a, 1)!.shield).toBe(true);
    const aegis = give(state, a, 'aegis');
    state.players[a].energy = 5;
    state = act(state, { type: 'castSpell', player: a, card: aegis });
    expect([at(state, a, 0)!.shield, at(state, a, 1)!.shield]).toEqual([true, true]);
  });

  it('場上顯示有聖盾；卡面寫成關鍵字', () => {
    let { state, a } = start();
    place(state, a, 0, 'guardian');
    at(state, a, 0)!.shield = true;
    expect(engine.viewFor(state, a).you.zones[0]!.shield).toBe(true);
    expect(describeCard(db.cards.get('guardian')! as DeckCardDef).join('\n')).toContain('**聖盾**');
  });
});

describe('連擊', () => {
  it('這回合還沒打出別的牌：只有本來的效果；打出過之後多一段', () => {
    let { state, a, b } = start();
    state.players[a].energy = 10;
    const first = give(state, a, 'combo-bolt');
    state = act(state, { type: 'castSpell', player: a, card: first, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(1);
    const second = give(state, a, 'combo-bolt');
    state = act(state, { type: 'castSpell', player: a, card: second, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(1 + 3);
    expect(engine.viewFor(state, a).you.playedThisTurn).toBe(2);
  });

  it('回合開始歸零；天生技與技能不算打出牌', () => {
    let { state, a, b } = start();
    state.players[a].energy = 10;
    const bolt = give(state, a, 'combo-bolt');
    state = act(state, { type: 'castSpell', player: a, card: bolt, target: hero(b) });
    state = endTurn(endTurn(state));
    expect(state.players[a].playedThisTurn).toBe(0);
    state.players[a].heroId = 'combo-hero';
    state.players[a].energy = 10;
    state = act(state, { type: 'heroPower', player: a, target: hero(b) });
    const next = give(state, a, 'combo-bolt');
    state = act(state, { type: 'castSpell', player: a, card: next, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(1 + 1 + 1); // 天生技沒讓連擊成立
  });

  it('天生技也能有連擊', () => {
    let { state, a, b } = start();
    state.players[a].heroId = 'combo-hero';
    state.players[a].energy = 10;
    const wolf = give(state, a, 'wolf');
    state = act(state, { type: 'summon', player: a, card: wolf, zone: 0 });
    state = act(state, { type: 'heroPower', player: a, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(2);
  });

  it('只有連擊才有效果的進場：沒連擊時不發動也不選目標；連擊時照常選目標', () => {
    let { state, a, b } = start();
    state.players[a].energy = 10;
    place(state, b, 0, 'wolf');
    const quiet = give(state, a, 'ambusher');
    expect(reject(state, { type: 'summon', player: a, card: quiet, zone: 0, target: creatureAt(b, 0) })).toBe('TARGET_NOT_ALLOWED');
    state = act(state, { type: 'summon', player: a, card: quiet, zone: 0 });
    expect(at(state, b, 0)!.damage).toBe(0);
    const loud = give(state, a, 'ambusher');
    state = act(state, { type: 'summon', player: a, card: loud, zone: 1, target: creatureAt(b, 0) });
    expect(at(state, b, 0)!.damage).toBe(3);
    expect(describeCard(db.cards.get('ambusher')! as DeckCardDef).join('\n')).toContain('**連擊**時');
  });
});

import { describe, expect, it } from 'vitest';
import { conditionMet, deckTraits } from '../src/conditions';
import { buildCardDb } from '../src/db';
import { describeCard, describeHero } from '../src/describe';
import { viewFor } from '../src/view';
import type { DeckCardDef, HeroDef } from '../src/types';
import { act, at, creatureAt, db, endTurn, give, hero, place, start } from './helpers';

const traits = { costs: 1, odd: false, even: false, singleton: false };

describe('構築條件', () => {
  it('牌組的樣子：幾種費用、全奇數、全偶數、沒有同名卡；開局時記下來', () => {
    expect(deckTraits(db, ['wolf', 'wolf', 'zap'])).toEqual({ costs: 1, odd: true, even: false, singleton: false });
    expect(deckTraits(db, ['wolf', 'imp-token'])).toEqual({ costs: 2, odd: false, even: false, singleton: true });
    expect(deckTraits(db, ['imp-token'])).toMatchObject({ even: true, odd: false });
    const { state, a } = start(); // 牌組 30 張狼（1 費）
    expect(state.players[a].deckTraits).toEqual({ costs: 1, odd: true, even: false, singleton: false });
  });

  it('奇數牌組成立才多一段；不成立只有本來的效果', () => {
    let { state, a, b } = start();
    state.players[a].energy = 5;
    state.players[a].deckTraits = { ...traits, odd: true };
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'odd-bolt'), target: hero(b) });
    expect(state.players[b].heroDamage).toBe(4);
    state.players[a].deckTraits = traits;
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'odd-bolt'), target: hero(b) });
    expect(state.players[b].heroDamage).toBe(5);
  });

  it('階梯看不同費用的種類；獨一看有沒有同名卡（天生技、生物技能也可以有條件）', () => {
    let { state, a, b } = start();
    state.players[a].heroId = 'climber';
    state.players[a].deckTraits = { ...traits, costs: 3, singleton: true };
    state.players[a].energy = 5;
    state = act(state, { type: 'heroPower', player: a, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(3);
    place(state, a, 0, 'lone-knight');
    const hand = state.players[a].hand.length;
    state = act(state, { type: 'useSkill', player: a, zone: 0, skill: 0, target: hero(b) });
    expect(state.players[a].hand.length).toBe(hand + 1);
  });
});

describe('累積條件', () => {
  it('軍勢：召喚與衍生物都算，包括這一隻；只有條件才有效果的進場，不成立就不發動', () => {
    let { state, a } = start();
    state.players[a].energy = 10;
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'marshal'), zone: 0 });
    expect(state.players[a].summonedTotal).toBe(1);
    expect(at(state, a, 0)!.attackCounters).toBe(0);
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'spawn') }); // 兩隻衍生物
    expect(state.players[a].summonedTotal).toBe(3);
    state = act(state, { type: 'summon', player: a, card: give(state, a, 'marshal'), zone: 3 });
    expect(state.players[a].summonedTotal).toBe(4);
    // 第二隻召喚時軍勢 3 成立：我方每隻生物增益 1
    expect(at(state, a, 3)!.attackCounters).toBe(1);
    expect(at(state, a, 0)!.attackCounters).toBe(1);
  });

  it('詠唱：包括這一個法術', () => {
    let { state, a, b } = start();
    state.players[a].energy = 10;
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'chant-bolt'), target: hero(b) });
    expect(state.players[b].heroDamage).toBe(1);
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'chant-bolt'), target: hero(b) });
    expect(state.players[b].heroDamage).toBe(4);
    expect(state.players[a].spellsTotal).toBe(2);
  });

  it('亡魂：我方倒下的生物（衍生物也算）', () => {
    let { state, a, b } = start();
    place(state, a, 0, 'imp-token');
    place(state, a, 1, 'wolf', { damage: 5 });
    state = endTurn(state);
    state.players[b].energy = 10;
    state = act(state, { type: 'castSpell', player: b, card: give(state, b, 'zap'), target: creatureAt(a, 0) });
    state = act(state, { type: 'castSpell', player: b, card: give(state, b, 'zap'), target: creatureAt(a, 1) });
    expect(state.players[a].fallenTotal).toBe(2);
    expect(conditionMet(state, a, { kind: 'fallen', count: 2 })).toBe(true);
    state = endTurn(state);
    state = act(state, { type: 'castSpell', player: a, card: give(state, a, 'grave-call') });
    expect(state.players[a].zones.filter((z) => z?.cards.at(-1)?.cardId === 'imp-token')).toHaveLength(2);
  });

  it('手牌上要標示「打出去會成立」時，把這一張算進去', () => {
    const { state, a } = start();
    state.players[a].spellsTotal = 1;
    expect(conditionMet(state, a, { kind: 'spells', count: 2 })).toBe(false);
    expect(conditionMet(state, a, { kind: 'spells', count: 2 }, { spells: 1 })).toBe(true);
  });
});

describe('畫面與說明', () => {
  it('累積的數字雙方都看得到；牌組的樣子只有自己看得到', () => {
    const { state, a, b } = start();
    state.players[a].summonedTotal = 4;
    const mine = viewFor(db, state, a);
    const theirs = viewFor(db, state, b);
    expect(mine.you.deckTraits).toEqual(state.players[a].deckTraits);
    expect(theirs.opponent.summonedTotal).toBe(4);
    expect(theirs.opponent).not.toHaveProperty('deckTraits');
  });

  it('卡面寫出條件那一段', () => {
    const card = (id: string) => db.cards.get(id) as DeckCardDef;
    expect(describeCard(card('odd-bolt')).join('\n')).toContain('；**奇數牌組**：再造成 3 傷害');
    expect(describeCard(card('marshal')).join('\n')).toContain('**進場** muster：**軍勢 3**時我方每隻生物**增益 1**');
    expect(describeCard(card('grave-call')).join('\n')).toContain('**亡魂 2**：再召喚 2 隻');
    expect(describeHero(db.heroes.get('climber') as HeroDef).join('\n')).toContain('**階梯 3**：再造成 2 傷害');
  });

  it('條件的數字要是正整數、要有效果', () => {
    const bad: DeckCardDef = { kind: 'spell', id: 'bad', name: 'bad', rarity: 'R', colors: [], cost: 1, target: { kind: 'none' }, effects: [{ type: 'draw', count: 1 }], condition: { when: { kind: 'spells', count: 0 }, effects: [] } };
    expect(() => buildCardDb([bad], [])).toThrow(/條件的數字必須是正整數/);
    expect(() => buildCardDb([bad], [])).toThrow(/條件沒有效果/);
  });
});

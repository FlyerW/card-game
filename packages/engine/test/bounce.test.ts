import { describe, expect, it } from 'vitest';
import { describeCard } from '../src/describe';
import type { DeckCardDef } from '../src/types';
import { act, at, creatureAt, db, give, hero, place, start } from './helpers';

describe('回到手牌', () => {
  it('對手的生物連同進化堆疊回到他的手牌；道具進棄牌區；傷害與狀態都不見了', () => {
    let { state, a, b } = start();
    const wolf = place(state, b, 0, 'pup', { damage: 3, poison: 2 });
    wolf.cards.push({ uid: state.nextUid++, cardId: 'hound' });
    wolf.item = { uid: state.nextUid++, cardId: 'wand' };
    const handBefore = state.players[b].hand.length;
    const rebound = give(state, a, 'rebound');
    state = act(state, { type: 'castSpell', player: a, card: rebound, target: creatureAt(b, 0) });
    expect(at(state, b, 0)).toBeNull();
    expect(state.players[b].hand.map((card) => card.cardId).slice(handBefore)).toEqual(['pup', 'hound']);
    expect(state.players[b].discard.map((card) => card.cardId)).toContain('wand');
  });

  it('衍生物直接消失；對手每隻生物一起回去；手牌滿了的進棄牌區', () => {
    let { state, a, b } = start();
    place(state, b, 0, 'imp-token');
    place(state, b, 1, 'wolf');
    state.players[b].hand = Array.from({ length: 10 }, (_, i) => ({ uid: 900 + i, cardId: 'wolf' }));
    const tide = give(state, a, 'tide-all');
    state = act(state, { type: 'castSpell', player: a, card: tide });
    expect(state.players[b].zones.every((zone) => zone === null)).toBe(true);
    expect(state.players[b].hand).toHaveLength(10);
    expect(state.players[b].discard.map((card) => card.cardId)).toEqual(['wolf']);
  });
});

describe('手牌傷害', () => {
  it('造成等同施放者手牌張數的傷害（法術自己已經不在手上）', () => {
    let { state, a, b } = start();
    state.players[a].hand = Array.from({ length: 4 }, (_, i) => ({ uid: 800 + i, cardId: 'wolf' }));
    const blade = give(state, a, 'mind-blade');
    state = act(state, { type: 'castSpell', player: a, card: blade, target: hero(b) });
    expect(state.players[b].heroDamage).toBe(4);
    expect(describeCard(db.cards.get('mind-blade')! as DeckCardDef).join('\n')).toContain('造成等同你手牌張數的傷害');
  });
});

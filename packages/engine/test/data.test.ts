import { describe, expect, it } from 'vitest';
import { sampleDb } from '../src/cards/sample';
import { buildCardDb, CardDataError } from '../src/db';
import { validateDeck } from '../src/deck';
import { describeCard } from '../src/describe';
import { DEFAULT_RULES } from '../src/rules';
import type { Ability, DeckCardDef, HeroDef } from '../src/types';
import { db } from './helpers';

const skill = (name: string): Ability => ({
  name,
  cost: 1,
  target: { kind: 'enemy', allow: 'any' },
  effects: [{ type: 'damage', amount: 1 }],
});
const creature = (patch: Partial<Extract<DeckCardDef, { kind: 'creature' }>>): DeckCardDef => ({
  kind: 'creature',
  id: 'c',
  name: 'c',
  rarity: 'R',
  colors: [],
  stage: 0,
  cost: 1,
  hp: 5,
  skills: [skill('a'), skill('b')],
  ...patch,
});

/** 建資料庫，回傳錯誤訊息；沒有錯誤回傳空字串。 */
function problems(cards: DeckCardDef[], heroes: HeroDef[] = []): string {
  try {
    buildCardDb(cards, heroes);
    return '';
  } catch (error) {
    if (error instanceof CardDataError) return error.message;
    throw error;
  }
}

describe('範例卡牌', () => {
  it('全部通過資料驗證', () => {
    expect(() => sampleDb()).not.toThrow();
  });

  it('有 N → R → SR 與 R → SR → UR 兩種進化線', () => {
    const sample = sampleDb();
    const rarities = (ids: string[]) => ids.map((id) => sample.cards.get(id)?.rarity);
    expect(rarities(['ember-fox', 'ember-fox-king', 'nine-tailed-fox'])).toEqual(['N', 'R', 'SR']);
    expect(rarities(['grove-bear', 'grove-bear-king', 'ancient-bear-god'])).toEqual(['R', 'SR', 'UR']);
  });
});

describe('卡面文字', () => {
  it('由資料產生', () => {
    const hound = db.cards.get('hound')!;
    expect(describeCard(hound, (id) => db.cards.get(id)!.name)).toEqual([
      'hound　R・無色・一階，由pup進化｜進化 2｜HP 10',
      'bite2（1）：〔任意目標〕造成 2 傷害',
      'sniff（1）：抽 1 張牌',
    ]);
  });
});

describe('資料驗證', () => {
  it('N 生物可以只有一個技能，其他稀有度至少兩個', () => {
    expect(problems([creature({ rarity: 'N', skills: [skill('a')] })])).toBe('');
    expect(problems([creature({ rarity: 'R', skills: [skill('a')] })])).toContain('R 生物至少要有 2 個技能');
  });

  it('每次進化稀有度升一級：N → R → SR、R → SR → UR 都可以', () => {
    const chain = (rarities: DeckCardDef['rarity'][]) =>
      rarities.map((rarity, stage) =>
        creature({
          id: `s${stage}`,
          rarity,
          stage: stage as 0 | 1 | 2,
          ...(stage > 0 ? { evolvesFrom: `s${stage - 1}` } : {}),
        }),
      );
    expect(problems(chain(['N', 'R', 'SR']))).toBe('');
    expect(problems(chain(['R', 'SR', 'UR']))).toBe('');
    expect(problems(chain(['N', 'SR']))).toContain('進化後稀有度要升一級');
    expect(problems(chain(['UR', 'UR']))).toContain('進化後稀有度要升一級');
  });

  it('進化來源必須存在，而且是低一階的生物', () => {
    expect(problems([creature({ stage: 1, evolvesFrom: 'nope' })])).toContain('找不到進化來源');
    expect(
      problems([creature({ id: 'x' }), creature({ id: 'y', stage: 2, rarity: 'SR', evolvesFrom: 'x' })]),
    ).toContain('低一階');
  });

  it('位置技能只能用在生物身上', () => {
    const spell: DeckCardDef = {
      kind: 'spell', id: 's', name: 's', rarity: 'N', colors: [], cost: 1,
      target: { kind: 'lane', lane: 'opposite' }, effects: [{ type: 'damage', amount: 1 }],
    };
    expect(problems([spell])).toContain('位置技能只能用在生物身上');
  });

  it('效果和目標類型要對得上', () => {
    const bad = (target: Ability['target'], effects: Ability['effects']) =>
      problems([creature({ skills: [{ name: 'x', cost: 1, target, effects }, skill('b')] })]);
    expect(bad({ kind: 'none' }, [{ type: 'damage', amount: 1 }])).toContain('效果需要目標');
    expect(bad({ kind: 'enemy', allow: 'any' }, [{ type: 'draw', count: 1 }])).toContain('沒有效果用到它');
    expect(bad({ kind: 'enemy', allow: 'any' }, [{ type: 'heal', amount: 1 }])).toContain('回復只能指定我方目標');
    expect(bad({ kind: 'enemy', allow: 'any' }, [{ type: 'halveHp' }])).toContain('HP 減半只能指定對手的生物');
  });

  it('id 不能重複；一次列出所有問題', () => {
    const message = problems([creature({}), creature({ rarity: 'R', skills: [skill('a')] })]);
    expect(message).toContain('重複的 id：c');
    expect(message.split('\n').length).toBeGreaterThanOrEqual(2);
  });
});

describe('英雄進化卡的資料驗證', () => {
  const hero: HeroDef = { kind: 'hero', id: 'h', name: 'h', colors: ['red'], hp: 40 };
  const evolution = (patch: Partial<Extract<DeckCardDef, { kind: 'heroEvolution' }>>): DeckCardDef => ({
    kind: 'heroEvolution', id: 'e', name: 'e', rarity: 'SR', colors: ['red'], cost: 5, evolvesFrom: 'h', hpBonus: 10, ...patch,
  });
  it('要對得上一個存在的英雄，顏色也要跟那個英雄相同', () => {
    expect(problems([evolution({})], [hero])).toBe('');
    expect(problems([evolution({ evolvesFrom: 'nope' })], [hero])).toContain('找不到要進化的英雄');
    expect(problems([evolution({ colors: ['red', 'green'] })], [hero])).toContain('顏色必須跟 h 相同');
  });
});

describe('牌組驗證', () => {
  const rules = { ...DEFAULT_RULES, deckSize: 4, maxCopies: 2 };

  it('合法的牌組沒有問題', () => {
    expect(validateDeck(db, rules, 'blank', ['wolf', 'wolf', 'hitter', 'hitter'])).toEqual([]);
  });

  it('張數必須剛好', () => {
    expect(validateDeck(db, rules, 'blank', ['wolf', 'wolf', 'hitter'])).toContain('牌組必須是 4 張，目前 3 張');
  });

  it('同名卡有上限', () => {
    expect(validateDeck(db, rules, 'blank', ['wolf', 'wolf', 'wolf', 'hitter'])).toContain('wolf 最多 2 張，目前 3 張');
  });

  it('卡的顏色必須在英雄的顏色內；多色卡要英雄具備每一個顏色', () => {
    expect(validateDeck(db, rules, 'pinger', ['red-imp', 'red-imp', 'wolf', 'wolf'])).toEqual([]);
    expect(validateDeck(db, rules, 'pinger', ['gold-griffin', 'wolf', 'wolf', 'hitter'])).toContain(
      'gold-griffin 需要英雄具有顏色：綠',
    );
    expect(validateDeck(db, rules, 'red-green', ['gold-griffin', 'wolf', 'wolf', 'hitter'])).toEqual([]);
  });

  it('不能放別的英雄的進化卡', () => {
    expect(validateDeck(db, rules, 'pinger', ['pinger-plus', 'wolf', 'wolf', 'hitter'])).toEqual([]);
    expect(validateDeck(db, rules, 'red-green', ['pinger-plus', 'wolf', 'wolf', 'hitter'])).toContain(
      'pinger-plus 是pinger的進化卡，不能放進red-green的牌組',
    );
  });

  it('英雄不能放進牌組，也不能放不存在的卡', () => {
    expect(validateDeck(db, rules, 'blank', ['pinger', 'wolf', 'wolf', 'nope'])).toEqual([
      '英雄不能放進牌組：pinger',
      '找不到卡牌：nope',
    ]);
  });
});

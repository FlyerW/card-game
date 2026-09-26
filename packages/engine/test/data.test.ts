import { describe, expect, it } from 'vitest';
import { SAMPLE_HEROES, sampleDb } from '../src/cards/sample';
import { buildCardDb, CardDataError } from '../src/db';
import { copyLimit, deckPool, validateDeck } from '../src/deck';
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
  attack: 1,
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

describe('範例英雄', () => {
  it('五個基礎英雄各是一種顏色；雙色以上的英雄都是 UR', () => {
    const base = SAMPLE_HEROES.filter((hero) => hero.rarity === undefined);
    expect(base.map((hero) => hero.colors).flat().sort()).toEqual(['black', 'blue', 'green', 'red', 'white']);
    for (const hero of SAMPLE_HEROES) expect(hero.rarity === 'UR', hero.name).toBe(hero.colors.length > 1);
  });
});

describe('種族', () => {
  it('每隻範例生物都有種族，進化線上的卡同一個種族', () => {
    const sample = sampleDb();
    for (const card of sample.cards.values()) {
      if (card.kind !== 'creature') continue;
      expect(card.race, card.name).toBeDefined();
      if (card.evolvesFrom) {
        const base = sample.cards.get(card.evolvesFrom)!;
        expect(base.kind === 'creature' && base.race, card.name).toBe(card.race);
      }
    }
  });
});

describe('範例卡池', () => {
  const sample = sampleDb();
  const colors = ['white', 'blue', 'black', 'red', 'green'] as const;

  it('每個顏色至少 12 張、無色至少 8 張（英雄進化卡另計）', () => {
    const regular = [...sample.cards.values()].filter((card) => card.kind !== 'heroEvolution');
    for (const color of colors) {
      expect(regular.filter((card) => card.colors.length === 1 && card.colors[0] === color).length, color).toBeGreaterThanOrEqual(12);
    }
    expect(regular.filter((card) => card.colors.length === 0).length).toBeGreaterThanOrEqual(8);
  });

  it('每個英雄能用的卡都夠組一副正式的牌組', () => {
    for (const hero of SAMPLE_HEROES) {
      const most = deckPool(sample, hero.id).reduce((sum, card) => sum + copyLimit(DEFAULT_RULES, card), 0);
      expect(most, hero.name).toBeGreaterThanOrEqual(DEFAULT_RULES.deckSize);
    }
  });

  it('9–12 費每一種費用都有卡；每個顏色都有 2 張 9 費以上的卡，每個英雄都拿得到', () => {
    const regular = [...sample.cards.values()].filter((card) => card.kind !== 'heroEvolution');
    for (const cost of [9, 10, 11, 12]) {
      expect(regular.filter((card) => card.cost === cost).length, `${cost} 費`).toBeGreaterThanOrEqual(2);
    }
    for (const color of colors) {
      expect(regular.filter((card) => card.cost >= 9 && card.colors.length === 1 && card.colors[0] === color).length, color).toBe(2);
    }
    for (const hero of SAMPLE_HEROES) {
      expect(deckPool(sample, hero.id).some((card) => card.cost >= 9 && card.colors.length > 0), hero.name).toBe(true);
    }
  });

  it('技能數照稀有度：N 沒有、R 與 SR 一個、UR 兩個', () => {
    const expected = { N: 0, R: 1, SR: 1, UR: 2 } as const;
    for (const card of sample.cards.values()) {
      if (card.kind === 'creature') expect(card.skills.length, card.name).toBe(expected[card.rarity]);
    }
  });

  it('無色生物比同費用、同稀有度的有色生物弱一點', () => {
    const stats = (card: DeckCardDef) => (card.kind === 'creature' ? card.attack + card.hp : 0);
    // 有進場效果、關鍵字或再生的生物，數值本來就扣過，不拿來比。
    const creatures = [...sample.cards.values()].filter(
      (card) => card.kind === 'creature' && card.stage === 0 && !card.entry && !card.keywords && !card.regenerate,
    );
    for (const plain of creatures.filter((card) => card.colors.length === 0)) {
      const rivals = creatures.filter((card) => card.colors.length > 0 && card.cost === plain.cost && card.rarity === plain.rarity);
      for (const rival of rivals) expect(stats(plain), `${plain.name} 對 ${rival.name}`).toBeLessThanOrEqual(stats(rival));
    }
  });

  it('每個顏色都有一條進化線', () => {
    const cards = [...sample.cards.values()];
    for (const color of colors) {
      const own = cards.filter((card) => card.colors.includes(color));
      expect(own.some((card) => card.kind === 'creature' && card.stage > 0), `${color} 進化線`).toBe(true);
    }
  });
});

describe('卡面文字', () => {
  it('由資料產生', () => {
    const hound = db.cards.get('hound')!;
    expect(describeCard(hound, (id) => db.cards.get(id)!.name)).toEqual([
      'hound　R・無色・由pup進化｜能量 2｜⚔ 2｜♥ 10',
      '速攻（進化卡都有）：召喚當回合也能進化，進化完馬上能攻擊或發動技能',
      'bite2（能量 1）：〔任意目標〕造成 2 傷害',
      'sniff（能量 1）：抽 1 張牌',
    ]);
  });

  it('費用一律寫成「能量 N」，法術不重複寫名字', () => {
    expect(describeCard(db.cards.get('dart')!)).toEqual(['dart　N・無色・法術｜能量 1', '〔任意目標〕造成 1 傷害，中毒 2（你的每個回合結束時，牠失去 2♥）']);
  });
});

describe('資料驗證', () => {
  it('攻擊力不能是負數', () => {
    expect(problems([creature({ attack: -1 })])).toContain('攻擊力必須是非負整數');
    expect(problems([creature({ attack: 0 })])).toBe('');
  });

  it('進化稀有度升一級：N → R、R → SR 都可以；最多進化一次', () => {
    const chain = (rarities: DeckCardDef['rarity'][]) =>
      rarities.map((rarity, stage) =>
        creature({
          id: `s${stage}`,
          rarity,
          stage: stage as 0 | 1,
          ...(stage > 0 ? { evolvesFrom: `s${stage - 1}` } : {}),
        }),
      );
    expect(problems(chain(['N', 'R']))).toBe('');
    expect(problems(chain(['R', 'SR']))).toBe('');
    expect(problems(chain(['N', 'SR']))).toContain('進化後稀有度要升一級');
    expect(problems(chain(['UR', 'UR']))).toContain('進化後稀有度要升一級');
    expect(problems(chain(['N', 'R', 'SR']))).toContain('最多進化一次');
  });

  it('進化來源必須存在，而且是基礎生物', () => {
    expect(problems([creature({ stage: 1, evolvesFrom: 'nope' })])).toContain('找不到進化來源');
    const spell: DeckCardDef = {
      kind: 'spell', id: 'x', name: 'x', rarity: 'N', colors: [], cost: 1, target: { kind: 'none' }, effects: [{ type: 'draw', count: 1 }],
    };
    expect(problems([spell, creature({ id: 'y', stage: 1, evolvesFrom: 'x' })])).toContain('低一階');
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
    expect(bad({ kind: 'enemy', allow: 'hero' }, [{ type: 'poison', amount: 1 }])).toContain('異常狀態只能指定對手的生物');
    expect(bad({ kind: 'lane', lane: 'opposite' }, [{ type: 'silence' }])).toBe('');
  });

  it('id 不能重複；一次列出所有問題', () => {
    const message = problems([creature({}), creature({ hp: 0 })]);
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

  it('同名卡有上限，UR 更少', () => {
    expect(validateDeck(db, rules, 'blank', ['wolf', 'wolf', 'wolf', 'hitter'])).toContain('wolf 最多 2 張，目前 3 張');
    expect(validateDeck(db, rules, 'blank', ['relic', 'relic', 'wolf', 'hitter'])).toContain('relic 最多 1 張（UR），目前 2 張');
    expect(validateDeck(db, rules, 'blank', ['relic', 'wolf', 'wolf', 'hitter'])).toEqual([]);
  });

  it('預設規則：30 張、同名最多 2 張、UR 最多 1 張', () => {
    expect([DEFAULT_RULES.deckSize, DEFAULT_RULES.maxCopies, DEFAULT_RULES.maxUrCopies]).toEqual([30, 2, 1]);
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

  it('卡池：英雄顏色內的卡加上無色卡；英雄進化卡只給對應的英雄', () => {
    const ids = (heroId: string) => deckPool(db, heroId).map((card) => card.id);
    expect(ids('warden')).not.toContain('red-imp');
    expect(ids('pinger')).toContain('red-imp');
    expect(ids('pinger')).not.toContain('gold-griffin');
    expect(ids('pinger')).toContain('pinger-plus');
    expect(ids('blank')).not.toContain('pinger-plus');
    expect(deckPool(db, 'nope')).toEqual([]);
  });

  it('英雄不能放進牌組，也不能放不存在的卡', () => {
    expect(validateDeck(db, rules, 'blank', ['pinger', 'wolf', 'wolf', 'nope'])).toEqual([
      '英雄不能放進牌組：pinger',
      '找不到卡牌：nope',
    ]);
  });
});

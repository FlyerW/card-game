import { describe, expect, it } from 'vitest';
import { sampleDb } from '../src/cards/sample';
import { decodeDeckCode, encodeDeckCode } from '../src/deck';

// 牌組代碼：複製給朋友，貼上就有一樣的牌組。

const db = sampleDb();

describe('牌組代碼', () => {
  it('編成代碼再讀回來，一樣的英雄、一樣的卡（順序不重要）', () => {
    const cards = ['squire', 'squire', 'paladin', 'healing-light', 'shield-knight'];
    const code = encodeDeckCode('nameless-swordsman', cards);
    expect(code).toMatch(/^CG1-[A-Za-z0-9_-]+$/);
    const decoded = decodeDeckCode(db, code);
    expect(decoded?.heroId).toBe('nameless-swordsman');
    expect([...decoded!.cards].sort()).toEqual([...cards].sort());
    expect(encodeDeckCode('nameless-swordsman', [...cards].reverse())).toBe(code);
  });

  it('看不懂、英雄或卡不存在、衍生物都讀不回來', () => {
    expect(decodeDeckCode(db, 'hello')).toBeNull();
    expect(decodeDeckCode(db, 'CG1-%%%')).toBeNull();
    expect(decodeDeckCode(db, encodeDeckCode('nobody', ['squire']))).toBeNull();
    expect(decodeDeckCode(db, encodeDeckCode('nameless-swordsman', ['no-such-card']))).toBeNull();
    expect(decodeDeckCode(db, encodeDeckCode('nameless-swordsman', ['soldier-token']))).toBeNull();
    // 前後有空白（複製時常多帶）照樣讀得到
    expect(decodeDeckCode(db, `  ${encodeDeckCode('deep-seer', ['ice-shard'])}\n`)?.cards).toEqual(['ice-shard']);
  });
});

import { describe, expect, it } from 'vitest';
import { applyRankedResult, expectedScore, newRank, rankLabel, rolloverSeason, seasonOf, START_MMR, type RankState } from '../src';

const at = (patch: Partial<RankState>): RankState => ({ ...newRank('2026-09'), ...patch });

describe('牌位', () => {
  it('贏 +1 星、輸 −1 星；滿 5 顆星升一段', () => {
    expect(applyRankedResult(at({ tier: 2, stars: 2 }), true, START_MMR).rank).toMatchObject({ tier: 2, stars: 3 });
    expect(applyRankedResult(at({ tier: 2, stars: 2 }), false, START_MMR).rank).toMatchObject({ tier: 2, stars: 1 });
    const up = applyRankedResult(at({ tier: 2, stars: 4 }), true, START_MMR);
    expect(up.rank).toMatchObject({ tier: 3, stars: 0 });
    expect(up.promoted).toBe(true);
  });

  it('星星 0 再輸就掉一段；銅牌、銀牌不會掉段', () => {
    const down = applyRankedResult(at({ tier: 3, stars: 0 }), false, START_MMR);
    expect(down.rank).toMatchObject({ tier: 2, stars: 4 });
    expect(down.demoted).toBe(true);
    expect(applyRankedResult(at({ tier: 1, stars: 0 }), false, START_MMR).rank).toMatchObject({ tier: 1, stars: 0 });
    expect(applyRankedResult(at({ tier: 0, stars: 0 }), false, START_MMR).rank).toMatchObject({ tier: 0, stars: 0 });
  });

  it('鑽石以下連勝 3 場以上多 +1 星；鑽石沒有', () => {
    expect(applyRankedResult(at({ tier: 1, stars: 0, streak: 2 }), true, START_MMR).rank).toMatchObject({ stars: 2, streak: 3 });
    expect(applyRankedResult(at({ tier: 4, stars: 0, streak: 2 }), true, START_MMR).rank).toMatchObject({ stars: 1 });
  });

  it('鑽石滿星升大師；大師不算星星，輸了也不掉', () => {
    expect(applyRankedResult(at({ tier: 4, stars: 4 }), true, START_MMR).rank).toMatchObject({ tier: 5, stars: 0 });
    expect(applyRankedResult(at({ tier: 5, stars: 0 }), false, START_MMR).rank.tier).toBe(5);
    expect(rankLabel(at({ tier: 5, mmr: 1234.4 }))).toBe('大師 1234 分');
    expect(rankLabel(at({ tier: 2, stars: 3 }))).toBe('金牌 ★★★☆☆');
  });

  it('隱藏分數照 Elo：贏強的人加比較多，分數一樣時加減 16', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(applyRankedResult(at({}), true, 1000).rank.mmr).toBe(1016);
    expect(applyRankedResult(at({}), false, 1000).rank.mmr).toBe(984);
    const upset = applyRankedResult(at({}), true, 1400).rank.mmr - START_MMR;
    expect(upset).toBeGreaterThan(28);
  });

  it('換季：照這季最高段位發金幣，段位減半、分數拉回一半；沒打過就沒有獎勵', () => {
    const rolled = rolloverSeason(at({ tier: 4, stars: 3, best: 4, mmr: 1300, wins: 20, losses: 10 }), '2026-10')!;
    expect(rolled.gold).toBe(500);
    expect(rolled.rank).toMatchObject({ season: '2026-10', tier: 2, stars: 0, mmr: 1150, wins: 0, losses: 0 });
    expect(rolloverSeason(at({}), '2026-10')!.gold).toBe(0);
    expect(rolloverSeason(at({}), '2026-09')).toBeNull();
    expect(seasonOf('2026-09-26')).toBe('2026-09');
  });
});

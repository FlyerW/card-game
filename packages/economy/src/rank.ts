// 排位：牌位（給玩家看的段位與星星）加上隱藏分數（Elo，用來配對）。全部是純函式。
//
// - 段位：銅牌、銀牌、金牌、白金、鑽石各 5 顆星，最上面是大師（不再算星星，看分數）。
// - 贏 +1 星，鑽石以下連勝 2 場以上再多 +1；輸 −1 星，星星扣到 0 再輸就掉一段。
//   銅牌、銀牌不會掉段，保護新手。大師整季不會掉。
// - 隱藏分數從 1000 開始，照 Elo 算（K = 32），配對時找分數接近的人。
// - 賽季一個月一季（YYYY-MM）。換季時照這季最高的段位發金幣，段位往下重置、分數往 1000 拉回一半。

export const TIERS = ['銅牌', '銀牌', '金牌', '白金', '鑽石', '大師'] as const;
export const MASTER = TIERS.length - 1;
export const STARS_PER_TIER = 5;
/** 這個段位以下（不含）輸了不會掉段：銅牌、銀牌。 */
const PROTECTED_BELOW = 2;
/** 這個段位以下（不含）有連勝加星：鑽石以下。 */
const STREAK_BELOW = 4;
/** 連勝幾場開始多 +1 星。 */
export const STREAK_BONUS_AT = 2;
const K = 32;
export const START_MMR = 1000;
/** 換季時照這季最高的段位發的金幣。 */
export const SEASON_REWARDS = [50, 100, 200, 300, 500, 800] as const;

export interface RankState {
  /** 賽季（YYYY-MM）。 */
  season: string;
  /** 段位：0 銅牌 … 5 大師。 */
  tier: number;
  stars: number;
  /** 隱藏分數。 */
  mmr: number;
  wins: number;
  losses: number;
  /** 目前連勝幾場（輸了歸零）。 */
  streak: number;
  /** 這季到過的最高段位，換季發獎勵看這個。 */
  best: number;
}

export const seasonOf = (day: string): string => day.slice(0, 7);

export const newRank = (season: string): RankState => ({ season, tier: 0, stars: 0, mmr: START_MMR, wins: 0, losses: 0, streak: 0, best: 0 });

/** 「金牌 ★★★☆☆」或「大師 1234 分」。 */
export function rankLabel(rank: RankState): string {
  if (rank.tier >= MASTER) return `${TIERS[MASTER]} ${Math.round(rank.mmr)} 分`;
  return `${TIERS[rank.tier]} ${'★'.repeat(rank.stars)}${'☆'.repeat(STARS_PER_TIER - rank.stars)}`;
}

/** Elo 的預期勝率。 */
export const expectedScore = (mine: number, theirs: number): number => 1 / (1 + 10 ** ((theirs - mine) / 400));

export interface RankedChange {
  rank: RankState;
  /** 星星增減（段位變化也換算成星星）；大師是 0。 */
  starsDelta: number;
  promoted: boolean;
  demoted: boolean;
}

/** 一場排位賽的結果。 */
export function applyRankedResult(before: RankState, won: boolean, opponentMmr: number): RankedChange {
  const rank = { ...before };
  rank.mmr = before.mmr + K * ((won ? 1 : 0) - expectedScore(before.mmr, opponentMmr));
  if (won) {
    rank.wins += 1;
    rank.streak += 1;
  } else {
    rank.losses += 1;
    rank.streak = 0;
  }
  const position = (r: RankState) => r.tier * STARS_PER_TIER + r.stars;
  if (before.tier < MASTER) {
    if (won) {
      rank.stars += 1 + (rank.streak >= STREAK_BONUS_AT && before.tier < STREAK_BELOW ? 1 : 0);
      while (rank.stars >= STARS_PER_TIER && rank.tier < MASTER) {
        rank.stars -= STARS_PER_TIER;
        rank.tier += 1;
      }
      if (rank.tier >= MASTER) rank.stars = 0;
    } else if (rank.stars > 0) {
      rank.stars -= 1;
    } else if (rank.tier >= PROTECTED_BELOW) {
      rank.tier -= 1;
      rank.stars = STARS_PER_TIER - 1;
    }
  }
  rank.best = Math.max(rank.best, rank.tier);
  return {
    rank,
    starsDelta: position(rank) - position(before),
    promoted: rank.tier > before.tier,
    demoted: rank.tier < before.tier,
  };
}

export interface SeasonRollover {
  rank: RankState;
  previousSeason: string;
  previousBest: number;
  gold: number;
}

/** 換季：發上一季的獎勵，段位減半（鑽石 → 金牌），分數往 1000 拉回一半。同一季就回傳 null。 */
export function rolloverSeason(rank: RankState, season: string): SeasonRollover | null {
  if (rank.season === season) return null;
  const played = rank.wins + rank.losses > 0;
  const tier = Math.floor(rank.tier / 2);
  return {
    rank: { season, tier, stars: 0, mmr: START_MMR + (rank.mmr - START_MMR) / 2, wins: 0, losses: 0, streak: 0, best: tier },
    previousSeason: rank.season,
    previousBest: rank.best,
    gold: played ? SEASON_REWARDS[rank.best]! : 0,
  };
}

/** 讀回存檔：格式不對就回傳 null。 */
export function parseRank(value: unknown): RankState | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Partial<RankState>;
  const numbers = [r.tier, r.stars, r.mmr, r.wins, r.losses, r.streak, r.best];
  if (typeof r.season !== 'string' || !numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return r as RankState;
}

import type { MatchOutcome } from './match';

// ─── 一局要打多久 ────────────────────────────────────────────────────────────
//
// 機器人沒有「時間」，只能用它做了多少事來推算真人要花多久。以下是兩個真人線上對戰的粗估，
// 數字放在這裡，之後有試玩的實測數據再改。

export const PACE = {
  /** 每個回合的固定時間：抽牌、看場面、按結束回合，秒。 */
  turn: 10,
  /** 每個動作：選牌或技能、選目標、看動畫，秒。 */
  play: 6,
  /** 手上有能用的瞬發牌時，決定要不要回應，秒。 */
  decision: 4,
  /** 有存能量、但沒有能用的瞬發牌：按一下不回應（或選了這回合都不回應），秒。 */
  idle: 1,
} as const;

/** 一局的預估秒數。 */
export const estimateSeconds = (o: MatchOutcome): number =>
  o.turns * PACE.turn + o.plays * PACE.play + o.decisionWindows * PACE.decision + o.idleWindows * PACE.idle;

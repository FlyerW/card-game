import type { Rules } from './types';

/**
 * 目前的預設規則。建立對局時可以部分覆寫，例如測試用較小的牌組。
 *
 * 能量：先攻從 1 開始、後攻從 2 開始，之後雙方每回合 +2，最高 12。
 * 等於能量上限跟著全局回合數走，每位玩家的能量都比對手上一回合多 1。
 */
export const DEFAULT_RULES: Rules = {
  deckSize: 30,
  maxCopies: 2,
  maxUrCopies: 1,
  startingHand: 4,
  handLimit: 10,
  zones: 5,
  startingMaxEnergy: [1, 2],
  energyGrowth: 2,
  baseCeiling: 12,
  secondPlayerBonusEnergy: 0,
};

/** v0.3 的舊制：雙方從 1 開始每回合 +1，最高 10，後攻第一回合補 1 點。留著方便比較兩種規則。 */
export const LEGACY_ENERGY_RULES: Pick<
  Rules,
  'startingMaxEnergy' | 'energyGrowth' | 'baseCeiling' | 'secondPlayerBonusEnergy'
> = {
  startingMaxEnergy: [1, 1],
  energyGrowth: 1,
  baseCeiling: 10,
  secondPlayerBonusEnergy: 1,
};

import type { CardDb, Condition, DeckTraits, GameState, PlayerId } from './types';

// 第四彈的條件：構築條件看開局牌組（開局時算好存在 PlayerState.deckTraits），累積條件看本局的計數。

/** 一副牌組的樣子：幾種不同費用、是不是全奇數、全偶數、有沒有同名卡。組牌畫面與開局都用這個。 */
export function deckTraits(db: CardDb, deck: readonly string[]): DeckTraits {
  const costs = deck.map((id) => db.cards.get(id)?.cost ?? 0);
  return {
    costs: new Set(costs).size,
    odd: costs.length > 0 && costs.every((cost) => cost % 2 === 1),
    even: costs.length > 0 && costs.every((cost) => cost % 2 === 0),
    singleton: new Set(deck).size === deck.length,
  };
}

/** 構築條件在這副牌組成立嗎（累積條件在組牌時不算，回傳 null）。 */
export function deckConditionMet(traits: DeckTraits, when: Condition): boolean | null {
  switch (when.kind) {
    case 'odd':
      return traits.odd;
    case 'even':
      return traits.even;
    case 'costs':
      return traits.costs >= when.count;
    case 'singleton':
      return traits.singleton;
    default:
      return null;
  }
}

/**
 * 條件成立了沒。pending：還沒算進計數的「這一張」（正在打出的生物、正在施放的法術），
 * 手牌上標示「打出去會成立」時用。
 */
export function conditionMet(
  state: GameState,
  player: PlayerId,
  when: Condition,
  pending: { summoned?: number; spells?: number } = {},
): boolean {
  return conditionMetBy(state.players[player], when, pending);
}

/** 條件的計數：PlayerState 與畫面上的 view.you 都有這幾個欄位，網頁標示手牌時直接用 view。 */
export interface ConditionCounts {
  deckTraits?: DeckTraits | null | undefined;
  summonedTotal?: number | undefined;
  spellsTotal?: number | undefined;
  fallenTotal?: number | undefined;
}

export function conditionMetBy(p: ConditionCounts, when: Condition, pending: { summoned?: number; spells?: number } = {}): boolean {
  switch (when.kind) {
    case 'summoned':
      return (p.summonedTotal ?? 0) + (pending.summoned ?? 0) >= when.count;
    case 'spells':
      return (p.spellsTotal ?? 0) + (pending.spells ?? 0) >= when.count;
    case 'fallen':
      return (p.fallenTotal ?? 0) >= when.count;
    default:
      return p.deckTraits != null && deckConditionMet(p.deckTraits, when) === true;
  }
}

/** 構築條件（看牌組）還是累積條件（看本局）。 */
export const isDeckCondition = (when: Condition): boolean =>
  when.kind === 'odd' || when.kind === 'even' || when.kind === 'costs' || when.kind === 'singleton';

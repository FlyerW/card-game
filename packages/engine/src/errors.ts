export type ErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_PLAYER'
  | 'GAME_OVER'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'ALREADY_MULLIGANED'
  | 'DUPLICATE_CARD'
  | 'CARD_NOT_IN_HAND'
  | 'WRONG_CARD_KIND'
  | 'NOT_ENOUGH_ENERGY'
  | 'INVALID_ZONE'
  | 'ZONE_OCCUPIED'
  | 'NO_CREATURE'
  | 'NOT_BASE_CREATURE'
  | 'EVOLUTION_MISMATCH'
  | 'SUMMONED_THIS_TURN'
  | 'ALREADY_EVOLVED'
  | 'INVALID_SKILL'
  | 'ALREADY_ACTED'
  | 'NO_ATTACK'
  | 'PARALYZED'
  | 'SILENCED'
  | 'DISARMED'
  | 'NO_HERO_POWER'
  | 'HERO_POWER_USED'
  | 'HERO_POWER_SPENT'
  | 'TARGET_REQUIRED'
  | 'TARGET_NOT_ALLOWED'
  | 'NO_LEGAL_TARGET'
  | 'ILLEGAL_TARGET'
  | 'MUST_TARGET_TAUNT'
  | 'ITEM_SLOT_TAKEN'
  | 'FIELD_ALREADY_PLAYED';

/** 玩家做了規則不允許的事。訊息是給玩家看的，錯誤碼給程式判斷。 */
export class RuleError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new RuleError(code, message);
}

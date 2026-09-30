export { createEngine } from './engine';
export { conditionMet, conditionMetBy, deckConditionMet, deckTraits, isDeckCondition, type ConditionCounts } from './conditions';
export type { AbilityRef, ApplyResult, Engine, GameConfig, PlayerConfig, Successor } from './engine';
export { buildCardDb, CardDataError } from './db';
export {
  currentHp,
  maxHp,
  attackBonus,
  heroHp,
  heroMaxHp,
  heroPower,
  heroEvolution,
  ceiling,
  creatureDef,
  cardDef,
  isSilenced,
  isWeakened,
  hasLifesteal,
  attackPower,
  creatureSkills,
  isParalyzed,
  isTaunting,
  other,
} from './queries';
export { copyLimit, decodeDeckCode, deckPool, encodeDeckCode, validateDeck } from './deck';
export { DEFAULT_RULES, LEGACY_ENERGY_RULES } from './rules';
export { RuleError } from './errors';
export type { ErrorCode } from './errors';
export * from './describe';
export { eventsFor } from './view';
/** 教學與工具用：做一隻剛進場的生物（直接放進格子，不經過召喚）。 */
export { newCreature } from './resolve';
export type { CreatureView, PlayerView, SideView } from './view';
export { ALL_CARDS, ALL_HEROES, SAMPLE_CARDS, SAMPLE_HEROES, sampleDb } from './cards/sample';
export { CARD_SETS, isReleased, setOf, type CardSet } from './cards/sets';
export { BOSS_HEROES } from './cards/bosses';
export * from './types';

import { isTaunting, other } from './queries';
import type { Ability, GameState, PlayerId, Target } from './types';

export type AbilitySource =
  | { kind: 'creature'; player: PlayerId; zone: number }
  | { kind: 'hero'; player: PlayerId }
  | { kind: 'spell'; player: PlayerId };

export function sameTarget(a: Target, b: Target): boolean {
  switch (a.kind) {
    case 'field':
      return b.kind === 'field';
    case 'hero':
      return b.kind === 'hero' && a.player === b.player;
    case 'creature':
      return b.kind === 'creature' && a.player === b.player && a.zone === b.zone;
  }
}

function creatureTargets(state: GameState, player: PlayerId, withItemOnly = false): Target[] {
  const targets: Target[] = [];
  state.players[player].zones.forEach((creature, zone) => {
    if (creature !== null && (!withItemOnly || creature.item !== null)) {
      targets.push({ kind: 'creature', player, zone });
    }
  });
  return targets;
}

/** 位置技能能打到的格子：正對面是同一欄，斜對角是左右兩欄。 */
export function laneZones(state: GameState, lane: 'opposite' | 'diagonal', zone: number): number[] {
  const zones = lane === 'opposite' ? [zone] : [zone - 1, zone + 1];
  return zones.filter((z) => z >= 0 && z < state.rules.zones);
}

/** 技能本來能選的目標，還沒套用挑釁。 */
export function baseTargets(state: GameState, ability: Ability, source: AbilitySource): Target[] {
  const me = source.player;
  const enemy = other(me);
  const spec = ability.target;
  switch (spec.kind) {
    case 'none':
      return [];
    case 'enemy': {
      const hero: Target = { kind: 'hero', player: enemy };
      if (spec.allow === 'hero') return [hero];
      const creatures = creatureTargets(state, enemy);
      return spec.allow === 'creature' ? creatures : [...creatures, hero];
    }
    case 'lane': {
      if (source.kind !== 'creature') return [];
      const occupied = laneZones(state, spec.lane, source.zone).filter(
        (zone) => state.players[enemy].zones[zone] != null,
      );
      // 目標格全空，傷害打到對手英雄；只要有一格有生物就必須打生物。
      if (occupied.length === 0) return [{ kind: 'hero', player: enemy }];
      return occupied.map((zone) => ({ kind: 'creature', player: enemy, zone }));
    }
    case 'ally': {
      const creatures = creatureTargets(state, me);
      return spec.allow === 'creature' ? creatures : [...creatures, { kind: 'hero', player: me }];
    }
    case 'enemyItem':
      return creatureTargets(state, enemy, true);
    case 'enemyItemOrField': {
      const targets = creatureTargets(state, enemy, true);
      return state.field === null ? targets : [...targets, { kind: 'field' }];
    }
  }
}

/**
 * 實際能選的目標。
 *
 * 挑釁：技能能選到挑釁中的對手生物，就必須選牠。
 * 所以「只打英雄」選不到生物、不受影響；位置技能只有挑釁生物剛好在它的格子上時才受影響。
 * 挑釁只管單體傷害，HP 減半、破壞道具這類效果照常選目標。
 */
export function legalTargets(state: GameState, ability: Ability, source: AbilitySource): Target[] {
  const targets = baseTargets(state, ability, source);
  if (!ability.effects.some((effect) => effect.type === 'damage')) return targets;
  const taunting = targets.filter((target) => {
    if (target.kind !== 'creature' || target.player === source.player) return false;
    const creature = state.players[target.player].zones[target.zone];
    return creature != null && isTaunting(state, creature);
  });
  return taunting.length > 0 ? taunting : targets;
}

import {
  attackBonus,
  creatureDef,
  currentHp,
  heroHp,
  isAsleep,
  isParalyzed,
  isTaunting,
  other,
  type CardDb,
  type Creature,
  type Engine,
  type GameState,
  type PlayerId,
  type Successor,
} from '@card-game/engine';

/**
 * 機器人的打法，也就是局面評分的權重。
 * 用不同打法各跑一次，才能確認結論是規則造成的，不是某一種打法造成的。
 */
export interface BotStyle {
  name: string;
  /** 對手英雄每少 1 點 HP，加幾分。 */
  enemyHero: number;
  /** 自己英雄每少 1 點 HP，扣幾分。 */
  ownHero: number;
  /** 生物每 1 點剩餘 HP 值幾分。 */
  creatureHp: number;
  /** 生物每 1 點最大輸出值幾分。 */
  creatureThreat: number;
  /** 每張手牌值幾分。 */
  hand: number;
  /** 每 1 點能量上限值幾分。 */
  maxEnergy: number;
  /** 挑釁中的生物額外值幾分。 */
  taunt: number;
}

export const STYLES: Record<'balanced' | 'aggro' | 'control', BotStyle> = {
  balanced: { name: '均衡', enemyHero: 1.5, ownHero: 1.0, creatureHp: 1.0, creatureThreat: 1.0, hand: 1.5, maxEnergy: 2, taunt: 3 },
  aggro: { name: '快攻', enemyHero: 3.0, ownHero: 0.5, creatureHp: 0.6, creatureThreat: 1.0, hand: 1.0, maxEnergy: 1.5, taunt: 1 },
  control: { name: '控場', enemyHero: 1.0, ownHero: 1.5, creatureHp: 1.5, creatureThreat: 1.5, hand: 2.0, maxEnergy: 2.5, taunt: 4 },
};

/** 一隻生物最強的一招能打多少：單體傷害或範圍傷害取大者，再加攻擊加成。純功能型生物算 2。 */
function threat(db: CardDb, state: GameState, creature: Creature): number {
  let best = 0;
  for (const skill of creatureDef(db, creature).skills) {
    const damage = skill.effects.reduce(
      (sum, effect) => sum + (effect.type === 'damage' || effect.type === 'damageEnemyCreatures' ? effect.amount : 0),
      0,
    );
    best = Math.max(best, damage);
  }
  return best === 0 ? 2 : best + attackBonus(db, state, creature);
}

function boardValue(db: CardDb, state: GameState, player: PlayerId, style: BotStyle): number {
  let value = 0;
  for (const creature of state.players[player].zones) {
    if (creature === null) continue;
    // 中毒、灼燒每回合都扣，粗估再撐兩回合；麻痺、沉睡的生物暫時打不了人。
    const hp = Math.max(1, currentHp(db, state, creature) - 2 * (creature.poison + creature.burn));
    const disabled = isParalyzed(state, creature) || isAsleep(state, creature);
    value += style.creatureHp * hp + style.creatureThreat * threat(db, state, creature) * (disabled ? 0.4 : 1);
    if (isTaunting(state, creature)) value += style.taunt;
  }
  return value;
}

/** 從 me 的角度替局面打分，越高越好。 */
export function evaluate(db: CardDb, state: GameState, me: PlayerId, style: BotStyle): number {
  if (state.result !== null) {
    if (state.result.winner === 'draw') return 0;
    return state.result.winner === me ? 1e6 : -1e6;
  }
  const you = other(me);
  const mine = state.players[me];
  const theirs = state.players[you];
  return (
    style.ownHero * heroHp(db, state, me) -
    style.enemyHero * heroHp(db, state, you) +
    boardValue(db, state, me, style) -
    boardValue(db, state, you, style) +
    style.hand * (mine.hand.length - theirs.hand.length) +
    style.maxEnergy * (mine.maxEnergy - theirs.maxEnergy)
  );
}

/**
 * 貪婪策略：把每個合法動作都試一遍，挑讓局面分數最高的那個；
 * 沒有任何動作能讓局面變好，就結束回合。只看一步，不預測對手下回合會怎麼打。
 */
export function chooseAction(engine: Engine, state: GameState, me: PlayerId, style: BotStyle): Successor {
  const options = engine.successors(state, me);
  const fallback = options.find((option) => option.action.type === 'endTurn');
  let best: Successor | undefined;
  // 必須比什麼都不做嚴格變好。
  let bestScore = evaluate(engine.db, state, me, style) + 1e-9;
  for (const option of options) {
    if (option === fallback) continue;
    const value = evaluate(engine.db, option.state, me, style);
    if (value > bestScore) {
      best = option;
      bestScore = value;
    }
  }
  return best ?? fallback ?? options[0]!;
}

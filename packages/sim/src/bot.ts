import {
  attackPower,
  creatureSkills,
  currentHp,
  heroHp,
  isWeakened,
  isParalyzed,
  isSilenced,
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

/** 一隻生物每回合最多能打多少：攻擊力，或技能的單體、範圍傷害，取大者。沉默或繳械的那一種不算。 */
function threat(db: CardDb, state: GameState, creature: Creature): number {
  let best = isWeakened(state, creature) ? 0 : attackPower(db, state, creature);
  if (!isSilenced(state, creature)) {
    for (const skill of creatureSkills(db, creature)) {
      const damage = skill.effects.reduce(
        (sum, effect) => sum + (effect.type === 'damage' || effect.type === 'damageEnemyCreatures' ? effect.amount : 0),
        0,
      );
      best = Math.max(best, damage);
    }
  }
  return Math.max(best, 1);
}

function boardValue(db: CardDb, state: GameState, player: PlayerId, style: BotStyle): number {
  let value = 0;
  for (const creature of state.players[player].zones) {
    if (creature === null) continue;
    // 中毒、灼燒每回合都扣，粗估再撐兩回合；麻痺的生物暫時打不了人。
    const hp = Math.max(1, currentHp(db, state, creature) - 2 * (creature.poison + creature.burn));
    const disabled = isParalyzed(state, creature);
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

// ─── 困難：規劃整個回合，並提防對手下回合 ──────────────────────────────────────

/** 對手下回合的攻擊能打到 player 的英雄多少：打得到英雄的生物（範圍內有空格、或對手英雄有突破）的攻擊力加總。 */
export function incomingDamage(engine: Engine, state: GameState, player: PlayerId): number {
  const { db } = engine;
  const enemy = other(player);
  const pierce = engine.pierces(state, enemy);
  let total = 0;
  state.players[enemy].zones.forEach((creature, zone) => {
    if (creature === null || isWeakened(state, creature) || isParalyzed(state, creature)) return;
    const lanes = [zone - 1, zone, zone + 1].filter((z) => z >= 0 && z < state.rules.zones);
    const open = pierce || lanes.some((z) => state.players[player].zones[z] === null);
    if (open) total += attackPower(db, state, creature);
  });
  return total;
}

/**
 * 回合結束時的局面分數：一般的評分，再扣掉對手下回合打得到英雄的傷害；
 * 那些傷害夠打死英雄的話，幾乎等於輸了。
 */
export function evaluateEndOfTurn(engine: Engine, state: GameState, me: PlayerId, style: BotStyle): number {
  const base = evaluate(engine.db, state, me, style);
  if (state.result !== null) return base;
  const incoming = incomingDamage(engine, state, me);
  const hp = heroHp(engine.db, state, me);
  if (incoming >= hp) return base - 1e5;
  // 我方下回合打得到對手英雄的傷害也算一點：鼓勵把路打開、準備斬殺。
  const outgoing = incomingDamage(engine, state, other(me));
  return base - style.ownHero * incoming * 0.5 + style.enemyHero * outgoing * 0.25;
}

/** 照貪婪策略把這個回合打完，回傳宣告結束回合之前的局面。 */
function playOutTurn(engine: Engine, state: GameState, me: PlayerId, style: BotStyle, maxSteps = 25): GameState {
  let current = state;
  for (let step = 0; step < maxSteps; step++) {
    if (current.result !== null || engine.actor(current) !== me) return current;
    const pick = chooseAction(engine, current, me, style);
    if (pick.action.type === 'endTurn') return current;
    current = pick.state;
  }
  return current;
}

/**
 * 模擬對手下回合怎麼回應：結束回合，把對手的手牌拿掉（看不到，不偷看），讓他只用場上的生物與天生技
 * 照貪婪策略打一回合。回傳對手打完、準備結束回合時的局面。
 */
function opponentReply(engine: Engine, state: GameState, me: PlayerId, style: BotStyle): GameState {
  const ended = engine.apply(state, { type: 'endTurn', player: me });
  if (!ended.ok) return state;
  if (ended.state.result !== null) return ended.state;
  const blind = ended.state;
  blind.players[other(me)].hand = [];
  return playOutTurn(engine, blind, other(me), style);
}

/** 回合結束的局面分數：模擬對手用場上的東西回應之後再評分，再加上提防與進攻的估計。 */
function scoreAfterReply(engine: Engine, state: GameState, me: PlayerId, style: BotStyle): number {
  if (state.result !== null) return evaluate(engine.db, state, me, style);
  const reply = opponentReply(engine, state, me, style);
  return evaluate(engine.db, reply, me, style) * 0.6 + evaluateEndOfTurn(engine, state, me, style) * 0.4;
}

/**
 * 困難的電腦：挑一步看起來最好的幾個候選，每個都把這回合剩下的部分打完，
 * 再模擬對手下回合用場上的生物回應，比最後的局面。比貪婪策略慢，但會卡位置、會找連續技、會留生物擋。
 */
export function chooseActionSmart(engine: Engine, state: GameState, me: PlayerId, style: BotStyle, breadth = 8): Successor {
  const options = engine.successors(state, me);
  const endTurn = options.find((option) => option.action.type === 'endTurn');
  // 選牌（看牌庫頂）這種不是一般動作的決定，照貪婪策略。
  if (!endTurn) return chooseAction(engine, state, me, style);
  const ranked = options
    .filter((option) => option !== endTurn)
    .map((option) => ({ option, quick: evaluate(engine.db, option.state, me, style) }))
    .sort((x, y) => y.quick - x.quick)
    .slice(0, breadth);
  let best: Successor = endTurn;
  let bestScore = scoreAfterReply(engine, state, me, style) + 1e-9;
  for (const { option } of ranked) {
    const final = option.state.result !== null ? option.state : playOutTurn(engine, option.state, me, style);
    const score = scoreAfterReply(engine, final, me, style);
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }
  return best;
}

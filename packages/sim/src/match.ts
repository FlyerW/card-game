import type { Engine, GameConfig, GameResult, PlayerId } from '@card-game/engine';
import { chooseAction, type BotStyle } from './bot';

export interface MatchOutcome {
  firstPlayer: PlayerId;
  result: GameResult;
  /** 全局回合數：先攻第 1 回合是 1、後攻第 1 回合是 2。 */
  turns: number;
  /** 勝方英雄剩下的 HP，看勝負有多懸殊。平手時為 null。 */
  winnerHeroHp: number | null;
  /** 雙方出牌、發動技能、天生技等動作的次數，不含攻擊與結束回合。 */
  plays: number;
  /** 雙方生物攻擊的次數。 */
  attacks: number;
}

/** 兩個機器人打一局。雙方都保留起手牌不重抽。 */
export function playMatch(engine: Engine, config: GameConfig, style: BotStyle, maxActions = 5000): MatchOutcome {
  const created = engine.createGame(config);
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  for (const player of [0, 1] as const) {
    const kept = engine.apply(state, { type: 'mulligan', player, cards: [] });
    if (!kept.ok) throw new Error(kept.error.message);
    state = kept.state;
  }

  let plays = 0;
  let attacks = 0;
  for (let i = 0; i < maxActions && state.phase !== 'over'; i++) {
    const pick = chooseAction(engine, state, engine.actor(state), style);
    if (pick.action.type === 'attack') attacks++;
    else if (pick.action.type !== 'endTurn') plays++;
    state = pick.state;
  }
  if (state.result === null) throw new Error(`超過 ${maxActions} 個動作仍未分出勝負`);

  const { winner } = state.result;
  const view = winner === 'draw' ? null : engine.viewFor(state, winner);
  return {
    firstPlayer: state.firstPlayer,
    result: state.result,
    turns: state.turn,
    winnerHeroHp: view === null ? null : view.you.heroHp,
    plays,
    attacks,
  };
}

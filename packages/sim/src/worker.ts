import { parentPort } from 'node:worker_threads';
import { EXPERIMENTS, engine, gameConfig } from './experiments';
import { playMatch, type MatchOutcome } from './match';

export interface Task {
  experiment: number;
  from: number;
  to: number;
}

export interface TaskResult {
  experiment: number;
  outcomes: MatchOutcome[];
}

parentPort!.on('message', (task: Task) => {
  const experiment = EXPERIMENTS[task.experiment]!;
  const outcomes: MatchOutcome[] = [];
  for (let game = task.from; game < task.to; game++) {
    outcomes.push(playMatch(engine, gameConfig(experiment, game), experiment.style));
  }
  parentPort!.postMessage({ experiment: task.experiment, outcomes } satisfies TaskResult);
});

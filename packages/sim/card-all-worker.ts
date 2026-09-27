// card-all.ts 的 worker：打一批英雄對戰，回傳雙方的牌組與勝負。
import { parentPort } from 'node:worker_threads';
import { deckPool } from '@card-game/engine';
import { buildDeck } from './src/deck';
import { EXPERIMENTS, engine } from './src/experiments';
import { playMatch } from './src/match';

const style = EXPERIMENTS.find((e) => e.id.startsWith('hero/'))!.style;
parentPort!.on('message', (task: { a: string; b: string; from: number; to: number }) => {
  const rows: { hero: string; deck: string[]; won: boolean }[] = [];
  for (let game = task.from; game < task.to; game++) {
    const seed = game * 104729 + 3;
    const deckA = buildDeck(seed, task.a, deckPool(engine.db, task.a));
    const deckB = buildDeck(seed + 1, task.b, deckPool(engine.db, task.b));
    const outcome = playMatch(engine, { seed: game + 11, players: [{ heroId: task.a, deck: deckA }, { heroId: task.b, deck: deckB }] }, style);
    if (outcome.result.winner === 'draw') continue;
    rows.push({ hero: task.a, deck: deckA, won: outcome.result.winner === 0 });
    rows.push({ hero: task.b, deck: deckB, won: outcome.result.winner === 1 });
  }
  parentPort!.postMessage(rows);
});

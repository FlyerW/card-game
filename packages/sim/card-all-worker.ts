// card-all.ts 的 worker：打一批英雄對戰，回傳雙方的牌組與勝負。
import { parentPort } from 'node:worker_threads';
import { deckPool } from '@card-game/engine';
import { botDeck } from './src/deck';
import { EXPERIMENTS, engine } from './src/experiments';
import { playMatch } from './src/match';

const style = EXPERIMENTS.find((e) => e.id.startsWith('hero/'))!.style;
parentPort!.on('message', (task: { a: string; b: string; from: number; to: number }) => {
  const rows: { hero: string; deck: string[]; won: boolean }[] = [];
  for (let game = task.from; game < task.to; game++) {
    const seed = game * 104729 + 3;
    // 卡池裡有奇數、偶數、獨一這類構築條件的卡時，一部分牌組會組成那種牌組（見 botDeck）。
    const deckA = botDeck(seed, engine.db.heroes.get(task.a)!, deckPool(engine.db, task.a));
    const deckB = botDeck(seed + 1, engine.db.heroes.get(task.b)!, deckPool(engine.db, task.b));
    // 單雙局輪流先攻：先攻勝率約 53%–54%，固定讓英雄清單前面的先攻會把他們算高、後面的算低。
    const aFirst = game % 2 === 0;
    const a = { heroId: task.a, deck: deckA };
    const b = { heroId: task.b, deck: deckB };
    const outcome = playMatch(engine, { seed: game + 11, players: aFirst ? [a, b] : [b, a] }, style);
    if (outcome.result.winner === 'draw') continue;
    const aWon = outcome.result.winner === (aFirst ? 0 : 1);
    rows.push({ hero: task.a, deck: deckA, won: aWon });
    rows.push({ hero: task.b, deck: deckB, won: !aWon });
  }
  parentPort!.postMessage(rows);
});

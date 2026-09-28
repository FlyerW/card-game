// 對照實驗：某個英雄只用第一彈的卡 vs. 可以用新卡，對上其他英雄（都用全部的卡），看勝率差多少。
// 用法：CARD_PREVIEW=1 BOT=hard npx tsx packages/sim/pool-probe.ts <英雄> <core|all> <每個對手幾局> <第幾片> <共幾片>
import { ALL_HEROES, createEngine, deckPool, DEFAULT_RULES, sampleDb } from '@card-game/engine';
import { buildDeck } from './src/deck';
import { playMatch } from './src/match';
import { STYLES } from './src/bot';

const [heroId, variant, per, slice, slices] = [process.argv[2]!, process.argv[3]!, Number(process.argv[4] ?? 20), Number(process.argv[5] ?? 0), Number(process.argv[6] ?? 1)];
const db = sampleDb(true);
const engine = createEngine(db);
const pool = deckPool(db, heroId).filter((card) => variant === 'all' || (card.set ?? 'core') === 'core');
const rivals = ALL_HEROES.filter((hero) => hero.id !== heroId).filter((_, i) => i % slices === slice);
let wins = 0;
let games = 0;
for (const rival of rivals) {
  for (let g = 0; g < per; g++) {
    const seed = 7000 + g * 31 + rival.hp;
    const mine = buildDeck(seed, heroId, pool);
    const theirs = buildDeck(seed + 1, rival.id, deckPool(db, rival.id));
    const first = g % 2 === 0;
    const players = first
      ? [{ heroId, deck: mine }, { heroId: rival.id, deck: theirs }]
      : [{ heroId: rival.id, deck: theirs }, { heroId, deck: mine }];
    const outcome = playMatch(engine, { seed, players: players as never, rules: DEFAULT_RULES }, STYLES.balanced);
    if (outcome.result.winner === 'draw') continue;
    games++;
    if (outcome.result.winner === (first ? 0 : 1)) wins++;
  }
}
console.log(JSON.stringify({ heroId, variant, slice, wins, games }));

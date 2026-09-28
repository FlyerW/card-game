// 起始牌組互打：兩個基礎英雄都用固定的起始牌組，輪流先攻，看誰贏得多（新手選哪個顏色都不該差太多）。
// 用法：BOT=hard npx tsx packages/sim/starter-probe.ts <英雄 A> <英雄 B> <局數>，印一行 JSON。
import { createEngine, DEFAULT_RULES, sampleDb } from '@card-game/engine';
import { starterDeck } from '@card-game/economy';
import { STYLES } from './src/bot';
import { playMatch } from './src/match';

const [a, b, games] = [process.argv[2]!, process.argv[3]!, Number(process.argv[4] ?? 40)];
const engine = createEngine(sampleDb(false));
let winsA = 0;
let played = 0;
for (let g = 0; g < games; g++) {
  const aFirst = g % 2 === 0;
  const pa = { heroId: a, deck: starterDeck(a)! };
  const pb = { heroId: b, deck: starterDeck(b)! };
  const outcome = playMatch(engine, { seed: 5000 + g, players: aFirst ? [pa, pb] : [pb, pa], rules: DEFAULT_RULES }, STYLES.balanced);
  if (outcome.result.winner === 'draw') continue;
  played++;
  if (outcome.result.winner === (aFirst ? 0 : 1)) winsA++;
}
console.log(JSON.stringify({ a, b, winsA, games: played }));

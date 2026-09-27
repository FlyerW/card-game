// 從對局紀錄（data/games.jsonl）算真人對局的數據：英雄與卡牌勝率、先後攻、對局長度。
// 用法：npm run game-stats [-- 檔案] [--mode bot|friendly|ranked] [--min 20]
import { fileURLToPath } from 'node:url';
import { sampleDb } from '@card-game/engine';
import { GameLog } from '../src/gamelog';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const file = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? fileURLToPath(new URL('../../../data/games.jsonl', import.meta.url));
const mode = option('mode');
const min = Number(option('min') ?? 20);
const db = sampleDb();

const all = await GameLog.read(file);
const games = all.filter((game) => game.winner !== 'draw' && (!mode || game.mode === mode));
if (games.length === 0) {
  console.log(`${file} 裡沒有${mode ? ` ${mode} 的` : ''}對局紀錄。`);
  process.exit(0);
}

const pct = (won: number, n: number) => `${((won / n) * 100).toFixed(1)}%`;
const name = (id: string) => db.heroes.get(id)?.name ?? db.cards.get(id)?.name ?? id;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

// 每一邊當成一筆：哪個英雄、哪些卡、有沒有贏。只算真人那一邊，除非兩邊都是真人。
const sides = games.flatMap((game) =>
  ([0, 1] as const).filter((seat) => game.players[seat].bot === null).map((seat) => ({ game, player: game.players[seat], won: game.winner === seat })),
);

const byMode = new Map<string, number>();
for (const game of all) byMode.set(game.mode, (byMode.get(game.mode) ?? 0) + 1);
console.log(`對局 ${all.length} 局（${[...byMode].map(([m, n]) => `${m} ${n}`).join('、')}），分出勝負的 ${games.length} 局${mode ? `（只看 ${mode}）` : ''}`);
console.log(`先攻勝率 ${pct(games.filter((game) => game.winner === game.firstPlayer).length, games.length)}`);
console.log(`回合數中位數 ${median(games.map((game) => game.turns))}，時間中位數 ${(median(games.map((game) => game.seconds)) / 60).toFixed(1)} 分`);
const reasons = new Map<string, number>();
for (const game of games) reasons.set(game.reason, (reasons.get(game.reason) ?? 0) + 1);
console.log(`結束方式：${[...reasons].map(([reason, n]) => `${reason} ${n}`).join('、')}`);

const tally = (key: (side: (typeof sides)[number]) => string[]) => {
  const map = new Map<string, { won: number; n: number }>();
  for (const side of sides) {
    for (const id of new Set(key(side))) {
      const row = map.get(id) ?? { won: 0, n: 0 };
      row.n += 1;
      if (side.won) row.won += 1;
      map.set(id, row);
    }
  }
  return [...map].sort((x, y) => y[1].won / y[1].n - x[1].won / x[1].n);
};

console.log('\n英雄（真人那一邊）');
for (const [id, row] of tally((side) => [side.player.hero])) console.log(`  ${name(id)}\t${pct(row.won, row.n)}\t${row.n} 局`);

console.log(`\n卡牌（帶了這張卡的牌組，至少 ${min} 局）`);
const cards = tally((side) => side.player.deck).filter(([, row]) => row.n >= min);
if (cards.length === 0) console.log('  局數還不夠');
for (const [id, row] of cards) console.log(`  ${name(id)}\t${pct(row.won, row.n)}\t${row.n} 局`);


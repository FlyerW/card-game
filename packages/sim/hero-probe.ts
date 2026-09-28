// 英雄的變體測試：把某個英雄的天生技改成指定的費用（HP=40 再改 HP，PASSIVE='{...}' 換被動效果），對上其他每個英雄（都用各自完整的卡池），看勝率。
// 用法：[HP=40] [PASSIVE='{"name":"劍士之道","creatures":{"attack":1}}'] BOT=hard npx tsx packages/sim/hero-probe.ts <英雄> <天生技費用> <core|preview> <每個對手幾局> <第幾片> <共幾片>
import { ALL_CARDS, ALL_HEROES, BOSS_HEROES, buildCardDb, createEngine, deckPool, DEFAULT_RULES, SAMPLE_CARDS, SAMPLE_HEROES } from '@card-game/engine';
import { STYLES } from './src/bot';
import { buildDeck } from './src/deck';
import { playMatch } from './src/match';

const [heroId, cost, env, per, slice, slices] = [
  process.argv[2]!, Number(process.argv[3]), process.argv[4]!, Number(process.argv[5] ?? 20), Number(process.argv[6] ?? 0), Number(process.argv[7] ?? 1),
];
const preview = env === 'preview';
const hp = process.env.HP ? Number(process.env.HP) : undefined;
const passive = process.env.PASSIVE ? JSON.parse(process.env.PASSIVE) : undefined;
const heroes = (preview ? ALL_HEROES : SAMPLE_HEROES).map((hero) =>
  hero.id !== heroId
    ? hero
    : { ...hero, hp: hp ?? hero.hp, ...(passive ? { passive } : {}), ...(hero.power ? { power: { ...hero.power, cost } } : {}) },
);
const db = buildCardDb(preview ? ALL_CARDS : SAMPLE_CARDS, [...heroes, ...BOSS_HEROES]);
const engine = createEngine(db);
const rivals = heroes.filter((hero) => hero.id !== heroId).filter((_, i) => i % slices === slice);
let wins = 0;
let games = 0;
for (const rival of rivals) {
  for (let g = 0; g < per; g++) {
    const seed = 9100 + g * 37 + rival.hp;
    const mine = buildDeck(seed, heroId, deckPool(db, heroId));
    const theirs = buildDeck(seed + 1, rival.id, deckPool(db, rival.id));
    const first = g % 2 === 0;
    const players = first ? [{ heroId, deck: mine }, { heroId: rival.id, deck: theirs }] : [{ heroId: rival.id, deck: theirs }, { heroId, deck: mine }];
    const outcome = playMatch(engine, { seed, players: players as never, rules: DEFAULT_RULES }, STYLES.balanced);
    if (outcome.result.winner === 'draw') continue;
    games++;
    if (outcome.result.winner === (first ? 0 : 1)) wins++;
  }
}
console.log(JSON.stringify({ heroId, cost, hp, passive: process.env.PASSIVE ? 'custom' : undefined, variant: process.env.VARIANT, env, slice, wins, games }));

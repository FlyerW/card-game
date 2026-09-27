// 冒險模式的 BOSS 強度：玩家這邊用困難的電腦代打（基礎五色英雄、自動組牌），對上每一關的 BOSS。
// 用法：npx tsx packages/sim/boss.ts [每個英雄幾局，預設 10] [只跑哪個難度：普通／困難／惡夢]
// 普通 = 一般 BOSS + 普通電腦；困難 = 一般 BOSS + 困難電腦；惡夢 = 惡夢 BOSS + 困難電腦（跟網頁一樣）。
import { BOSS_HEROES, createEngine, deckPool, DEFAULT_RULES, SAMPLE_HEROES, sampleDb, type Engine, type GameState } from '@card-game/engine';
import { chooseAction, chooseActionSmart, STYLES } from './src/bot';
import { buildDeck } from './src/deck';

const db = sampleDb();
const engine = createEngine(db);
const perHero = Number(process.argv[2] ?? 10);
const only = process.argv[3];
const players = SAMPLE_HEROES.filter((hero) => hero.rarity === undefined);
// 一般版的 BOSS，照關卡順序；惡夢版是同一個 id 加上 -nightmare。
const stages = BOSS_HEROES.filter((boss) => !boss.id.endsWith('-nightmare'));

function play(engine: Engine, seed: number, heroId: string, bossId: string, bossThink: typeof chooseAction): boolean {
  const created = engine.createGame({
    seed,
    players: [
      { heroId, deck: buildDeck(seed, heroId, deckPool(db, heroId)) },
      { heroId: bossId, deck: buildDeck(seed + 1, bossId, deckPool(db, bossId)) },
    ],
    rules: DEFAULT_RULES,
  });
  if (!created.ok) throw new Error(created.error.message);
  let state: GameState = created.state;
  for (const player of [0, 1] as const) {
    const kept = engine.apply(state, { type: 'mulligan', player, cards: [] });
    if (kept.ok) state = kept.state;
  }
  for (let i = 0; i < 5000 && state.phase !== 'over'; i++) {
    const me = engine.actor(state);
    state = (me === 0 ? chooseActionSmart : bossThink)(engine, state, me, STYLES.balanced).state;
  }
  return state.result?.winner === 0;
}

stages.forEach((stage, index) => {
  const modes = [
    { name: '普通', boss: stage.id, think: chooseAction },
    { name: '困難', boss: stage.id, think: chooseActionSmart },
    { name: '惡夢', boss: `${stage.id}-nightmare`, think: chooseActionSmart },
  ].filter((mode) => !only || mode.name === only);
  for (const mode of modes) {
    let wins = 0;
    for (const hero of players) {
      for (let game = 0; game < perHero; game++) if (play(engine, index * 1000 + game * 7 + hero.hp, hero.id, mode.boss, mode.think)) wins++;
    }
    const total = players.length * perHero;
    console.log(`第 ${index + 1} 關 ${stage.name}\t${mode.name}\t玩家勝率 ${((100 * wins) / total).toFixed(0)}%\t(${total} 局)`);
  }
});

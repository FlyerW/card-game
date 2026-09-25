// 平衡模擬：讓機器人在每個實驗設定下打大量鏡像對局，統計先後手勝率與對局長度。
// 用法：npm run sim -- [--games 2000] [--workers 16]
// 結果寫到 docs/balance-results.md。

import { DEFAULT_RULES, SAMPLE_CARDS, SAMPLE_HEROES } from '@card-game/engine';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { BASE_HP, EXPERIMENTS, type Experiment } from './experiments';
import type { MatchOutcome } from './match';
import { estimateSeconds, PACE } from './pace';
import type { Task, TaskResult } from './worker';

const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};
const GAMES = arg('games', 2000);
const WORKERS = arg('workers', Math.max(1, Math.min(16, availableParallelism() - 4)));
const CHUNK = 100;
/** 每組實驗打幾局：英雄對戰只打一半，組數多，而且只要看出明顯的強弱。 */
const gamesFor = (experiment: Experiment) => Math.round(GAMES * (experiment.share ?? 1));

/** Wilson 信賴區間：比直接用 p ± 1.96·√(p(1−p)/n) 在樣本不大時更準。 */
function wilson(successes: number, n: number, z = 1.96): [number, number] {
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [center - half, center + half];
}

const percentile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

interface Summary {
  experiment: Experiment;
  games: number;
  firstWinRate: number;
  ci: [number, number];
  /** 英雄對戰：列在前面那個英雄（玩家 0）的勝率。 */
  heroWinRate: number;
  heroCi: [number, number];
  draws: number;
  deckOuts: number;
  meanTurns: number;
  medianTurns: number;
  p10Turns: number;
  p90Turns: number;
  meanWinnerHp: number;
  /** 預估的對局分鐘數：中位數與 10–90%。 */
  medianMinutes: number;
  p10Minutes: number;
  p90Minutes: number;
  /** 預估落在 5–10 分鐘的比例。 */
  inTarget: number;
  meanPlays: number;
  meanAttacks: number;
}

function summarize(experiment: Experiment, outcomes: MatchOutcome[]): Summary {
  const decisive = outcomes.filter((o) => o.result.winner !== 'draw');
  const firstWins = decisive.filter((o) => o.result.winner === o.firstPlayer).length;
  const heroWins = decisive.filter((o) => o.result.winner === 0).length;
  const turns = outcomes.map((o) => o.turns).sort((x, y) => x - y);
  const winnerHps = decisive.map((o) => o.winnerHeroHp!);
  return {
    experiment,
    games: outcomes.length,
    firstWinRate: firstWins / decisive.length,
    ci: wilson(firstWins, decisive.length),
    heroWinRate: heroWins / decisive.length,
    heroCi: wilson(heroWins, decisive.length),
    draws: outcomes.length - decisive.length,
    deckOuts: outcomes.filter((o) => o.result.reason === 'deckOut').length,
    meanTurns: turns.reduce((sum, t) => sum + t, 0) / turns.length,
    medianTurns: percentile(turns, 0.5),
    p10Turns: percentile(turns, 0.1),
    p90Turns: percentile(turns, 0.9),
    meanWinnerHp: winnerHps.reduce((sum, hp) => sum + hp, 0) / winnerHps.length,
    ...minutes(outcomes),
    meanPlays: outcomes.reduce((sum, o) => sum + o.plays, 0) / outcomes.length,
    meanAttacks: outcomes.reduce((sum, o) => sum + o.attacks, 0) / outcomes.length,
  };
}

function minutes(outcomes: MatchOutcome[]) {
  const sorted = outcomes.map((o) => estimateSeconds(o) / 60).sort((x, y) => x - y);
  return {
    medianMinutes: percentile(sorted, 0.5),
    p10Minutes: percentile(sorted, 0.1),
    p90Minutes: percentile(sorted, 0.9),
    inTarget: sorted.filter((m) => m >= 5 && m <= 10).length / sorted.length,
  };
}

async function run(): Promise<MatchOutcome[][]> {
  const tasks: Task[] = [];
  EXPERIMENTS.forEach((each, experiment) => {
    const games = gamesFor(each);
    for (let from = 0; from < games; from += CHUNK) tasks.push({ experiment, from, to: Math.min(games, from + CHUNK) });
  });
  const total = EXPERIMENTS.reduce((sum, each) => sum + gamesFor(each), 0);
  const results: MatchOutcome[][] = EXPERIMENTS.map(() => []);
  let done = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: WORKERS }, () => {
      const worker = new Worker(new URL('./worker-entry.mjs', import.meta.url));
      return new Promise<void>((resolve, reject) => {
        const next = () => {
          const task = tasks.shift();
          if (task === undefined) {
            void worker.terminate().then(() => resolve());
            return;
          }
          worker.postMessage(task);
        };
        worker.on('message', (result: TaskResult) => {
          results[result.experiment]!.push(...result.outcomes);
          done += result.outcomes.length;
          process.stderr.write(`\r${done}/${total} 局（${((Date.now() - started) / 1000).toFixed(0)} 秒）`);
          next();
        });
        worker.on('error', reject);
        next();
      });
    }),
  );
  process.stderr.write('\n');
  return results;
}

function report(summaries: Summary[], seconds: number): string {
  // 信賴區間包含 50% 才算看不出差距；整個區間都在 50% 以上或以下，才說哪一方有利。
  const verdict = (s: Summary) => (s.ci[0] > 0.5 ? '先攻有利' : s.ci[1] < 0.5 ? '後攻有利' : '看不出差距');
  const time = (s: Summary) => `${s.medianMinutes.toFixed(1)} 分 | ${s.p10Minutes.toFixed(1)}–${s.p90Minutes.toFixed(1)} | ${pct(s.inTarget)}`;
  const row = (s: Summary) =>
    `| ${s.experiment.label} | ${s.experiment.style.name} | ${s.experiment.heroHp} | **${pct(s.firstWinRate)}** | ` +
    `${pct(s.ci[0])} – ${pct(s.ci[1])} | ${verdict(s)} | ${s.meanTurns.toFixed(1)} | ${s.p10Turns}–${s.p90Turns} | ${time(s)} |`;
  const header =
    '| 能量制度 | 打法 | 英雄 HP | 先攻勝率 | 95% 信賴區間 | 判讀 | 平均回合數 | 回合數 10–90% | 預估時間 | 時間 10–90% | 5–10 分鐘 |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|';
  const heroRow = (s: Summary) =>
    `| ${s.experiment.label} | ${s.experiment.heroHp} | **${pct(s.firstWinRate)}** | ${pct(s.ci[0])} – ${pct(s.ci[1])} | ${verdict(s)} | ` +
    `${s.meanTurns.toFixed(1)} | ${s.meanPlays.toFixed(1)} | ${s.meanAttacks.toFixed(1)} | ${time(s)} | ${s.meanWinnerHp.toFixed(1)} |`;
  const heroHeader =
    '| 英雄 | HP | 先攻勝率 | 95% 信賴區間 | 判讀 | 平均回合數 | 平均動作數 | 平均攻擊數 | 預估時間 | 時間 10–90% | 5–10 分鐘 | 勝方剩餘 HP |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const simHero = (s: Summary) => s.experiment.heroId === undefined;
  const matchup = (s: Summary) => s.experiment.opponentId !== undefined;
  const side = (s: Summary) => (s.heroCi[0] > 0.5 ? '前者有利' : s.heroCi[1] < 0.5 ? '後者有利' : '看不出差距');
  const matchupRow = (s: Summary) =>
    `| ${s.experiment.label} | **${pct(s.heroWinRate)}** | ${pct(s.heroCi[0])} – ${pct(s.heroCi[1])} | ${side(s)} | ` +
    `${s.meanTurns.toFixed(1)} | ${s.medianMinutes.toFixed(1)} 分 |`;
  const matchupHeader = '| 對戰 | 前者勝率 | 95% 信賴區間 | 判讀 | 平均回合數 | 預估時間 |\n|---|---|---|---|---|---|';
  const winRates = SAMPLE_HEROES.map((hero) => {
    const games = summaries.filter(matchup).flatMap((s) => {
      if (s.experiment.heroId === hero.id) return [{ rate: s.heroWinRate, n: s.games }];
      if (s.experiment.opponentId === hero.id) return [{ rate: 1 - s.heroWinRate, n: s.games }];
      return [];
    });
    const n = games.reduce((sum, g) => sum + g.n, 0);
    return { hero, rate: games.reduce((sum, g) => sum + g.rate * g.n, 0) / n };
  }).sort((x, y) => y.rate - x.rate);
  const energy = summaries.filter((s) => simHero(s) && s.experiment.heroHp === BASE_HP);
  const hp = summaries
    .filter((s) => simHero(s) && s.experiment.id.startsWith('new/balanced/'))
    .sort((x, y) => x.experiment.heroHp - y.experiment.heroHp);
  const heroes = summaries.filter((s) => !simHero(s) && !matchup(s));
  const draws = summaries.reduce((sum, s) => sum + s.draws, 0);
  const deckOuts = summaries.reduce((sum, s) => sum + s.deckOuts, 0);
  const total = summaries.reduce((sum, s) => sum + s.games, 0);

  return [
    '# 平衡模擬結果',
    '',
    `> 由 \`npm run sim\` 產生，請勿手動編輯。每組 ${GAMES} 局（英雄對戰每組 ${Math.round(GAMES / 2)} 局），共 ${total} 局，耗時 ${seconds.toFixed(0)} 秒。`,
    '',
    '## 環境',
    '',
    '- **鏡像對戰**：兩邊同一副牌、同一個英雄、同一種打法，唯一的差別是誰先手。先攻勝率偏離 50% 多少，就是先後手差距有多大。',
    `- **牌組**：前兩組實驗每局從整個範例卡池（${SAMPLE_CARDS.length} 張）組 ${DEFAULT_RULES.deckSize} 張，進化線照 2/2/1 帶，雙方用同一副。` +
      '最後一組用範例卡的英雄，牌組只從他自己能用的卡組。',
    '- **英雄**：前兩組是模擬專用的英雄，沒有任何效果、五色都能用，HP 依實驗設定，只測規則本身。',
    '- **共同隨機數**：第 i 局在每個實驗裡都用同一個種子、同一副牌，所以不同規則之間的差異不是抽到不同牌造成的。',
    '- **機器人**：貪婪策略。每一步把所有合法動作試一遍，挑讓局面評分最高的；沒有動作能讓局面變好就結束回合。' +
      '只看一步，不預測對手。',
    '- **打法**：均衡、快攻（重視打英雄）、控場（重視場面與手牌）三種評分權重，用來確認結論不是某種打法造成的。',
    '- 回合數是全局回合：先攻第 1 回合是 1、後攻第 1 回合是 2。雙方各打了約一半。',
    '',
    '## 對局時間怎麼估',
    '',
    '機器人沒有「時間」，只能用它做了多少事推算兩個真人線上對戰要多久（`packages/sim/src/pace.ts`）：',
    '',
    `- 每個回合 ${PACE.turn} 秒（抽牌、看場面、按結束回合）`,
    `- 每個動作 ${PACE.play} 秒（出牌、發動技能、選目標、看動畫）`,
    `- 每次攻擊 ${PACE.attack} 秒（點生物、點目標）`,
    '',
    '這些是粗估，有真人試玩的數據後要改。「5–10 分鐘」是預估時間落在 5 到 10 分鐘之間的對局比例。',
    '',
    `## 先後手平衡（英雄 ${BASE_HP} HP）`,
    '',
    header,
    ...energy.map(row),
    '',
    '「判讀」：信賴區間包含 50% 表示在這個樣本數下看不出先後手差距；整個區間都高於 50% 才算先攻有利。',
    '',
    '## 英雄血量與對局時間（新制、均衡打法）',
    '',
    header,
    ...hp.map(row),
    '',
    '## 範例卡的英雄（新制、均衡打法、各自的卡池）',
    '',
    heroHeader,
    ...heroes.map(heroRow),
    '',
    `## 英雄對戰（新制、均衡打法、各自的卡池，每組 ${Math.round(GAMES / 2)} 局）`,
    '',
    '兩個範例卡的英雄各用自己能用的卡組牌對打，先後手隨機。看哪個英雄、哪個顏色太強或太弱。',
    '',
    matchupHeader,
    ...summaries.filter(matchup).map(matchupRow),
    '',
    `對其他英雄的平均勝率：${winRates.map((w) => `${w.hero.name} ${pct(w.rate)}`).join('、')}。`,
    '',
    '## 其他',
    '',
    `- 平手（雙方英雄同時歸零）：${draws} 局；因牌庫抽完而結束：${deckOuts} 局，合計佔 ${pct((draws + deckOuts) / total)}。`,
    '',
    '## 限制',
    '',
    '- 機器人比人弱：只看一步，不會為下回合布局，也不會預判對手。人類玩家對「先手搶節奏」的利用更充分，實際的先攻優勢可能比這裡量到的大。',
    '- 機器人常常剩能量沒花完。它只在動作能讓評分變好時才出手，所以對雙方效果對稱的場地卡從來不放。鏡像對戰中兩邊一樣，不影響先後手比較。',
    '- 對局時間是用動作數推算的，不是實測；真人想得比較久的話，時間會更長。',
    `- 範例卡只有 ${SAMPLE_CARDS.length} 張，也還沒經過試玩調整；卡池改變後，結論要重跑確認。`,
    '',
  ].join('\n');
}

const started = Date.now();
const results = await run();
const summaries = EXPERIMENTS.map((experiment, i) => summarize(experiment, results[i]!));
const markdown = report(summaries, (Date.now() - started) / 1000);
writeFileSync(new URL('../../../docs/balance-results.md', import.meta.url), markdown);
console.log(markdown);

// 每張卡的強度：所有英雄兩兩對戰（困難電腦用 BOT=hard），算「帶了這張卡的牌組」的勝率，也印出每個英雄的勝率。
// 用法：BOT=hard npx tsx packages/sim/card-all.ts 100 [輸出 json]；CARD_PREVIEW=1 連還沒發布的卡包與英雄一起量。
import { writeFileSync } from 'node:fs';
import { ALL_HEROES, SAMPLE_HEROES, sampleDb } from '@card-game/engine';
import { Worker } from 'node:worker_threads';

const perPair = Number(process.argv[2] ?? 300);
const db = sampleDb(process.env.CARD_PREVIEW === '1');
// 預覽時連還沒發布的英雄一起打。
const HEROES = process.env.CARD_PREVIEW === '1' ? ALL_HEROES : SAMPLE_HEROES;
const ids = HEROES.map((h) => h.id);
const tasks = ids.flatMap((a, i) => ids.slice(i + 1).flatMap((b) => Array.from({ length: perPair / 50 }, (_, k) => ({ a, b, from: k * 50, to: k * 50 + 50 }))));
const rows: { hero: string; deck: string[]; won: boolean }[] = [];
await Promise.all(Array.from({ length: 16 }, () => {
  const w = new Worker(new URL('./card-all-entry.mjs', import.meta.url));
  return new Promise<void>((resolve) => {
    const next = () => { const t = tasks.shift(); if (!t) { void w.terminate().then(() => resolve()); return; } w.postMessage(t); };
    w.on('message', (r: typeof rows) => { rows.push(...r); next(); });
    next();
  });
}));
const stats = [...db.cards.values()].map((card) => {
  const withCard = rows.filter((r) => r.deck.includes(card.id));
  const wins = withCard.filter((r) => r.won).length;
  return { id: card.id, name: card.name, rarity: card.rarity, colors: card.colors.join('') || '無色', cost: card.cost, n: withCard.length, rate: withCard.length ? wins / withCard.length : NaN };
}).filter((s) => s.n > 0).sort((x, y) => y.rate - x.rate);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(stats));
const out = (s: (typeof stats)[number]) => `${(s.rate * 100).toFixed(1)}%\t${s.n}\t${s.name}（${s.rarity}・${s.colors}・${s.cost}）`;
console.log(`${rows.length / 2} 局；超出 45–55% 的卡：`);
for (const s of stats) if (s.rate > 0.55 || s.rate < 0.45) console.log(out(s));
console.log(`在範圍內：${stats.filter((s) => s.rate >= 0.45 && s.rate <= 0.55).length}/${stats.length}`);
const heroRate = HEROES.map((h) => { const r = rows.filter((x) => x.hero === h.id); return `${h.name} ${((r.filter((x) => x.won).length / r.length) * 100).toFixed(1)}%`; });
console.log(heroRate.join('、'));

// 給 art.py 用：每張卡（含英雄）的顏色與種類，輸出成 JSON。
import { SAMPLE_CARDS, SAMPLE_HEROES } from '@card-game/engine';

const manifest = Object.fromEntries([
  ...SAMPLE_CARDS.map((card) => [card.id, { name: card.name, colors: card.colors, kind: card.kind }]),
  ...SAMPLE_HEROES.map((hero) => [hero.id, { name: hero.name, colors: hero.colors, kind: 'hero' }]),
]);
console.log(JSON.stringify(manifest));

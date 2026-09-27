// 給 art.py 用：每張卡（含英雄）的顏色與種類，輸出成 JSON。
import { ALL_CARDS, ALL_HEROES, BOSS_HEROES } from '@card-game/engine';

const manifest = Object.fromEntries([
  ...ALL_CARDS.map((card) => [card.id, { name: card.name, colors: card.colors, kind: card.kind }]),
  ...[...ALL_HEROES, ...BOSS_HEROES].map((hero) => [hero.id, { name: hero.name, colors: hero.colors, kind: 'hero' }]),
]);
console.log(JSON.stringify(manifest));

// 從卡牌資料產生 docs/cards.md，讓文件裡的卡永遠跟程式碼一致。
// 用法：npm run cards

import { writeFileSync } from 'node:fs';
import { describeCard, describeColors, describeHero } from '../src/describe';
import { RARITIES, type CreatureDef, type DeckCardDef } from '../src/types';
import { SAMPLE_CARDS, SAMPLE_HEROES } from '../src/cards/sample';

const byId = new Map(SAMPLE_CARDS.map((card) => [card.id, card]));
const heroNames = new Map(SAMPLE_HEROES.map((hero) => [hero.id, hero.name]));
const nameOf = (id: string) => byId.get(id)?.name ?? heroNames.get(id) ?? id;
const rank = (card: DeckCardDef) => RARITIES.indexOf(card.rarity);

function section(title: string, cards: DeckCardDef[]): string[] {
  const sorted = [...cards].sort((x, y) => rank(x) - rank(y) || x.cost - y.cost);
  return [
    `## ${title}`,
    '',
    ...sorted.flatMap((card) => {
      const [head, ...body] = describeCard(card, nameOf);
      // 這份文件把召喚費用寫成「能量 N」，一看就知道要花多少能量；遊戲裡的卡面不變。
      return [`**${head!.replace('｜召喚 ', '｜能量 ')}**`, ...body.map((line) => `- ${line}`), ''];
    }),
  ];
}

/** 從最終形態往回找，列出每一條完整的進化線。 */
function evolutionLines(): string[] {
  const creatures = SAMPLE_CARDS.filter((card): card is CreatureDef => card.kind === 'creature');
  const evolvedInto = new Set(creatures.flatMap((card) => (card.evolvesFrom ? [card.evolvesFrom] : [])));
  return creatures
    .filter((card) => card.stage > 0 && !evolvedInto.has(card.id))
    .map((top) => {
      const chain: CreatureDef[] = [top];
      while (chain[0]!.evolvesFrom) chain.unshift(byId.get(chain[0]!.evolvesFrom) as CreatureDef);
      return `- ${chain.map((card) => `${card.name}（${card.rarity}）`).join(' → ')}`;
    });
}

const lines = [
  '# 範例卡牌',
  '',
  '> 這份文件由 `npm run cards` 從 [`packages/engine/src/cards/sample.ts`](../packages/engine/src/cards/sample.ts) 產生，',
  '> 請改程式碼裡的卡牌資料，不要直接改這份。名字與數值都是暫定。',
  '',
  '## 英雄',
  '',
  '| 英雄 | 顏色 | HP | 效果 |',
  '|---|---|---|---|',
  ...SAMPLE_HEROES.map((hero) => {
    const effects = describeHero(hero).slice(1).join('<br>');
    return `| **${hero.name}** | ${describeColors(hero.colors)} | ${hero.hp} | ${effects} |`;
  }),
  '',
  ...section('英雄進化', SAMPLE_CARDS.filter((card) => card.kind === 'heroEvolution')),
  '## 進化線',
  '',
  ...evolutionLines(),
  '',
  ...section('生物', SAMPLE_CARDS.filter((card) => card.kind === 'creature')),
  ...section('法術', SAMPLE_CARDS.filter((card) => card.kind === 'spell')),
  ...section('道具', SAMPLE_CARDS.filter((card) => card.kind === 'item')),
  ...section('場地', SAMPLE_CARDS.filter((card) => card.kind === 'field')),
];

writeFileSync(new URL('../../../docs/cards.md', import.meta.url), lines.join('\n'));
console.log(`docs/cards.md：${SAMPLE_HEROES.length} 名英雄、${SAMPLE_CARDS.length} 張卡`);

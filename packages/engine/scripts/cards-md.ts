// 從卡牌資料產生 docs/cards.md，讓文件裡的卡永遠跟程式碼一致。
// 用法：npm run cards

import { writeFileSync } from 'node:fs';
import { cardNames, describeCard, describeColors, describeHero, KEYWORDS } from '../src/describe';
import { RARITIES, type CreatureDef, type DeckCardDef } from '../src/types';
import { ALL_CARDS, SAMPLE_CARDS, SAMPLE_HEROES, sampleDb } from '../src/cards/sample';
import { CARD_SETS, setOf } from '../src/cards/sets';

const byId = new Map(ALL_CARDS.map((card) => [card.id, card]));
const nameOf = cardNames(sampleDb(true));
/** 還沒發布的系列：另外列在最後面。 */
const unreleased = CARD_SETS.filter((set) => !set.released);
const rank = (card: DeckCardDef) => RARITIES.indexOf(card.rarity);

function section(title: string, cards: DeckCardDef[]): string[] {
  const sorted = [...cards].sort((x, y) => rank(x) - rank(y) || x.cost - y.cost);
  return [
    `## ${title}`,
    '',
    ...sorted.flatMap((card) => {
      const [head, ...body] = describeCard(card, nameOf);
      return [`**${head}**`, ...body.map((line) => `- ${line}`), ''];
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
  '## 關鍵字',
  '',
  '卡上的粗體字是關鍵字，N 是卡上寫的數字。',
  '',
  '| 關鍵字 | 意思 |',
  '|---|---|',
  ...Object.entries(KEYWORDS).map(([word, text]) => `| **${word}${text.includes('N') ? ' N' : ''}** | ${text} |`),
  '',
  '## 英雄',
  '',
  '單色的五個是基礎英雄，每個人都有；雙色以上的是 UR 英雄，要從卡包抽到。',
  '',
  '| 英雄 | 稀有度 | 顏色 | HP | 效果 |',
  '|---|---|---|---|---|',
  ...SAMPLE_HEROES.map((hero) => {
    const effects = describeHero(hero, nameOf).slice(1).join('<br>');
    return `| **${hero.name}** | ${hero.rarity ?? '基礎'} | ${describeColors(hero.colors)} | ${hero.hp} | ${effects} |`;
  }),
  '',
  ...section('英雄進化', SAMPLE_CARDS.filter((card) => card.kind === 'heroEvolution')),
  '## 進化線',
  '',
  ...evolutionLines(),
  '',
  ...section('生物', SAMPLE_CARDS.filter((card) => card.kind === 'creature' && !card.token)),
  ...section('衍生物（由效果召喚，不能放進牌組）', SAMPLE_CARDS.filter((card) => card.kind === 'creature' && card.token)),
  ...section('法術', SAMPLE_CARDS.filter((card) => card.kind === 'spell')),
  ...section('道具', SAMPLE_CARDS.filter((card) => card.kind === 'item')),
  ...section('場地', SAMPLE_CARDS.filter((card) => card.kind === 'field')),
  ...unreleased.flatMap((set) => {
    const cards = ALL_CARDS.filter((card) => setOf(card) === set.id);
    return [
      `# 第二彈以後：${set.name}（還沒發布）`,
      '',
      '> 這些卡還沒發布：遊戲、商店、組牌都看不到。網址加 `?preview`（或伺服器用 `CARD_PREVIEW=1`）可以先預覽；',
      '> 發布時把 `packages/engine/src/cards/sets.ts` 裡這個系列的 `released` 改成 `true`。',
      '',
      ...section(`${set.name}・生物`, cards.filter((card) => card.kind === 'creature' && !card.token)),
      ...section(`${set.name}・衍生物`, cards.filter((card) => card.kind === 'creature' && card.token)),
      ...section(`${set.name}・法術與道具`, cards.filter((card) => card.kind !== 'creature')),
    ];
  }),
];

writeFileSync(new URL('../../../docs/cards.md', import.meta.url), lines.join('\n'));
console.log(`docs/cards.md：${SAMPLE_HEROES.length} 名英雄、${SAMPLE_CARDS.length} 張卡；還沒發布的 ${ALL_CARDS.length - SAMPLE_CARDS.length} 張`);

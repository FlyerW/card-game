// 從卡牌資料產生卡表，讓文件裡的卡永遠跟程式碼一致：docs/cards.md 是總覽（系列與關鍵字），
// 每一彈各一份 docs/cards-set<第幾彈>-<系列>.md（例如 cards-set1-core.md）。
// 用法：npm run cards

import { writeFileSync } from 'node:fs';
import { cardNames, describeCard, describeColors, describeHero, KEYWORDS } from '../src/describe';
import { RARITIES, type CreatureDef, type DeckCardDef, type HeroDef } from '../src/types';
import { ALL_CARDS, ALL_HEROES, sampleDb } from '../src/cards/sample';
import { CARD_SETS, setOf, type CardSet } from '../src/cards/sets';

const byId = new Map(ALL_CARDS.map((card) => [card.id, card]));
const nameOf = cardNames(sampleDb(true));
const rank = (card: DeckCardDef) => RARITIES.indexOf(card.rarity);
const isToken = (card: DeckCardDef) => card.kind === 'creature' && card.token === true;

function section(title: string, cards: DeckCardDef[]): string[] {
  if (cards.length === 0) return [];
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
function evolutionLines(cards: DeckCardDef[]): string[] {
  const creatures = cards.filter((card): card is CreatureDef => card.kind === 'creature');
  const evolvedInto = new Set(creatures.flatMap((card) => (card.evolvesFrom ? [card.evolvesFrom] : [])));
  const lines = creatures
    .filter((card) => card.stage > 0 && !evolvedInto.has(card.id))
    .map((top) => {
      const chain: CreatureDef[] = [top];
      while (chain[0]!.evolvesFrom) chain.unshift(byId.get(chain[0]!.evolvesFrom) as CreatureDef);
      return `- ${chain.map((card) => `${card.name}（${card.rarity}）`).join(' → ')}`;
    });
  return lines.length === 0 ? [] : ['## 進化線', '', ...lines, ''];
}

/** 英雄表的一列。 */
function heroRow(hero: HeroDef): string {
  const effects = describeHero(hero, nameOf).slice(1).join('<br>');
  return `| **${hero.name}** | ${hero.rarity ?? '基礎'} | ${describeColors(hero.colors)} | ${hero.hp} | ${effects} |`;
}

const heroesOf = (set: string) => ALL_HEROES.filter((hero) => (hero.set ?? 'core') === set);
const cardsOf = (set: string) => ALL_CARDS.filter((card) => setOf(card) === set);
const fileOf = (set: CardSet) => `cards-set${CARD_SETS.indexOf(set) + 1}-${set.id}.md`;

/** 一個系列的卡表。 */
function setPage(set: CardSet): string {
  const cards = cardsOf(set.id);
  const heroes = heroesOf(set.id);
  const deckCards = cards.filter((card) => !isToken(card));
  return [
    `# ${set.name}${set.released ? '' : '（還沒發布）'}`,
    '',
    `> 由 \`npm run cards\` 從卡牌資料（\`packages/engine/src/cards/\`）產生，請改程式碼裡的資料，不要直接改這份。回到[總覽](cards.md)（關鍵字的意思在那裡）。`,
    ...(set.released
      ? []
      : [
          '>',
          '> 這些卡還沒發布：遊戲、商店、組牌都看不到。網址加 `?preview`、超級帳號或伺服器用 `CARD_PREVIEW=1` 可以先預覽；',
          '> 發布時把 `packages/engine/src/cards/sets.ts` 裡這個系列的 `released` 改成 `true`。',
        ]),
    '',
    `${heroes.length} 名英雄、${deckCards.length} 張卡（另有 ${cards.length - deckCards.length} 種衍生物）。`,
    '',
    ...(heroes.length
      ? [
          '## 英雄',
          '',
          ...(set.id === 'core' ? ['單色的五個是基礎英雄，每個人都有；雙色以上的是 UR 英雄，要從卡包抽到。', ''] : []),
          '| 英雄 | 稀有度 | 顏色 | HP | 效果 |',
          '|---|---|---|---|---|',
          ...heroes.map(heroRow),
          '',
        ]
      : []),
    ...section('英雄進化', cards.filter((card) => card.kind === 'heroEvolution')),
    ...evolutionLines(cards),
    ...section('生物', cards.filter((card) => card.kind === 'creature' && !isToken(card))),
    ...section('衍生物（由效果召喚，不能放進牌組）', cards.filter(isToken)),
    ...section('法術', cards.filter((card) => card.kind === 'spell')),
    ...section('道具', cards.filter((card) => card.kind === 'item')),
    ...section('場地', cards.filter((card) => card.kind === 'field')),
  ].join('\n');
}

/** 總覽：每一彈的連結與張數，加上關鍵字。 */
const overview = [
  '# 卡牌',
  '',
  '> 由 `npm run cards` 從卡牌資料產生，請改程式碼裡的資料，不要直接改這份。名字與數值都是暫定。',
  '',
  '## 系列',
  '',
  '| 系列 | 狀態 | 英雄 | 卡 | 卡表 |',
  '|---|---|---|---|---|',
  ...CARD_SETS.map((set) => {
    const deckCards = cardsOf(set.id).filter((card) => !isToken(card));
    return `| ${set.name} | ${set.released ? '已發布' : '還沒發布'} | ${heroesOf(set.id).length} | ${deckCards.length} | [${fileOf(set)}](${fileOf(set)}) |`;
  }),
  '',
  '## 關鍵字',
  '',
  '卡上的粗體字是關鍵字，N 是卡上寫的數字。',
  '',
  '| 關鍵字 | 意思 |',
  '|---|---|',
  ...Object.entries(KEYWORDS).map(([word, text]) => `| **${word}${text.includes('N') ? ' N' : ''}** | ${text} |`),
  '',
].join('\n');

const docs = new URL('../../../docs/', import.meta.url);
writeFileSync(new URL('cards.md', docs), overview);
for (const set of CARD_SETS) writeFileSync(new URL(fileOf(set), docs), setPage(set));
console.log(`docs/cards.md 與 ${CARD_SETS.map(fileOf).join('、')}：${CARD_SETS.map((set) => `${set.name} ${cardsOf(set.id).filter((card) => !isToken(card)).length} 張`).join('、')}`);

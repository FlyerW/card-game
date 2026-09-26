import { copyLimit, DEFAULT_RULES, SAMPLE_CARDS, type CreatureDef, type DeckCardDef } from '@card-game/engine';

// 試玩與模擬共用的組牌方式。
//
// 完全隨機組牌會抽到一堆沒有對應基礎生物的進化卡，卡在手上用不了。
// 所以進化線照 2/2 帶：基礎 2 張、進化 2 張（最多進化一次）；其餘隨機補滿。同名最多 2 張、UR 最多 1 張。
// 9 費以上的卡最多帶 2 張，不然前幾回合手上都是打不出來的牌。

const DECK_SIZE = DEFAULT_RULES.deckSize;
const LINE_COPIES = [2, 2];
const HIGH_COST = 9;
const MAX_HIGH_COST = 2;
const limit = (card: DeckCardDef) => copyLimit(DEFAULT_RULES, card);

function random(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** 卡池裡每一條完整的進化線，基礎形態在前。 */
export function evolutionLines(pool: readonly DeckCardDef[]): CreatureDef[][] {
  const creatures = pool.filter((card): card is CreatureDef => card.kind === 'creature');
  const lines: CreatureDef[][] = [];
  for (const base of creatures.filter((card) => card.stage === 0)) {
    const line = [base];
    for (let next = creatures.find((c) => c.evolvesFrom === base.id); next; next = creatures.find((c) => c.evolvesFrom === line.at(-1)!.id)) {
      line.push(next);
    }
    if (line.length > 1) lines.push(line);
  }
  return lines;
}

/**
 * 組一副牌：挑 lineCount 條進化線照 2/2 帶，英雄有進化卡就帶 2 張，
 * 其餘從不屬於任何進化線的卡隨機補滿（同名最多 3 張，9 費以上合計最多 3 張）。同一個 seed 一定組出同一副。
 */
export function buildDeck(seed: number, heroId: string | null, pool: readonly DeckCardDef[] = SAMPLE_CARDS, lineCount = 2): string[] {
  const rand = random(seed);
  const lines = evolutionLines(pool);
  const inLines = new Set(lines.flat().map((card) => card.id));
  const deck: string[] = [];

  for (const line of shuffle([...lines], rand).slice(0, lineCount)) {
    line.forEach((card, stage) => deck.push(...Array<string>(Math.min(LINE_COPIES[stage] ?? 1, limit(card))).fill(card.id)));
  }
  for (const card of pool) {
    if (card.kind === 'heroEvolution' && card.evolvesFrom === heroId) deck.push(...Array<string>(Math.min(2, limit(card))).fill(card.id));
  }
  const fillers = pool.filter((card) => card.kind !== 'heroEvolution' && !inLines.has(card.id));
  let highCost = 0;
  for (const card of shuffle(fillers.flatMap((card) => Array<DeckCardDef>(limit(card)).fill(card)), rand)) {
    if (deck.length === DECK_SIZE) break;
    if (card.cost >= HIGH_COST && highCost++ >= MAX_HIGH_COST) continue;
    deck.push(card.id);
  }
  return deck;
}

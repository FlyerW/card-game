import { SAMPLE_CARDS, type CreatureDef, type DeckCardDef } from '@card-game/engine';

// 試玩與模擬共用的組牌方式。
//
// 完全隨機組牌會抽到一堆沒有對應基礎生物的進化卡，卡在手上用不了。
// 所以進化線照 3/2/1 帶：基礎 3 張、一階 2 張、二階 1 張；其餘隨機補滿。

const DECK_SIZE = 40;
const LINE_COPIES = [3, 2, 1];

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
 * 組一副 40 張的牌：挑 lineCount 條進化線照 3/2/1 帶，英雄有進化卡就帶 2 張，
 * 其餘從不屬於任何進化線的卡隨機補滿（同名最多 3 張）。同一個 seed 一定組出同一副。
 */
export function buildDeck(seed: number, heroId: string | null, pool: readonly DeckCardDef[] = SAMPLE_CARDS, lineCount = 2): string[] {
  const rand = random(seed);
  const lines = evolutionLines(pool);
  const inLines = new Set(lines.flat().map((card) => card.id));
  const deck: string[] = [];

  for (const line of shuffle([...lines], rand).slice(0, lineCount)) {
    line.forEach((card, stage) => deck.push(...Array<string>(LINE_COPIES[stage] ?? 1).fill(card.id)));
  }
  for (const card of pool) {
    if (card.kind === 'heroEvolution' && card.evolvesFrom === heroId) deck.push(card.id, card.id);
  }
  const fillers = pool.filter((card) => card.kind !== 'heroEvolution' && !inLines.has(card.id));
  const copies = shuffle(fillers.flatMap((card) => [card.id, card.id, card.id]), rand);
  deck.push(...copies.slice(0, DECK_SIZE - deck.length));
  return deck;
}

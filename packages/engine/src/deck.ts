import { COLOR_NAMES } from './describe';
import type { CardDb, DeckCardDef, Rules } from './types';

/**
 * 英雄能放進牌組的卡，順序跟卡牌資料一樣：顏色都在英雄的顏色內（或無色），
 * 英雄進化卡只有對應的英雄能放。
 */
export function deckPool(db: CardDb, heroId: string): DeckCardDef[] {
  const hero = db.heroes.get(heroId);
  if (hero === undefined) return [];
  return [...db.cards.values()].filter(
    (card) =>
      card.colors.every((color) => hero.colors.includes(color)) &&
      (card.kind !== 'heroEvolution' || card.evolvesFrom === heroId),
  );
}

/** 這張卡一副牌最多放幾張：UR 另有更嚴的上限。 */
export const copyLimit = (rules: Rules, card: DeckCardDef): number =>
  card.rarity === 'UR' ? Math.min(rules.maxCopies, rules.maxUrCopies) : rules.maxCopies;

/** 檢查牌組是否合法，回傳所有問題；空陣列表示合法。 */
export function validateDeck(db: CardDb, rules: Rules, heroId: string, deck: readonly string[]): string[] {
  const hero = db.heroes.get(heroId);
  if (hero === undefined) return [`找不到英雄：${heroId}`];

  const problems: string[] = [];
  if (deck.length !== rules.deckSize) {
    problems.push(`牌組必須是 ${rules.deckSize} 張，目前 ${deck.length} 張`);
  }

  const counts = new Map<string, number>();
  for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);

  const heroColors = new Set(hero.colors);
  for (const [id, count] of counts) {
    const card = db.cards.get(id);
    if (card === undefined) {
      problems.push(db.heroes.has(id) ? `英雄不能放進牌組：${id}` : `找不到卡牌：${id}`);
      continue;
    }
    if (card.kind === 'heroEvolution' && card.evolvesFrom !== heroId) {
      const owner = db.heroes.get(card.evolvesFrom)?.name ?? card.evolvesFrom;
      problems.push(`${card.name} 是${owner}的進化卡，不能放進${hero.name}的牌組`);
    }
    const limit = copyLimit(rules, card);
    if (count > limit) {
      problems.push(`${card.name} 最多 ${limit} 張${card.rarity === 'UR' ? '（UR）' : ''}，目前 ${count} 張`);
    }
    const missing = card.colors.filter((color) => !heroColors.has(color));
    if (missing.length > 0) {
      problems.push(`${card.name} 需要英雄具有顏色：${missing.map((color) => COLOR_NAMES[color]).join('、')}`);
    }
  }
  return problems;
}

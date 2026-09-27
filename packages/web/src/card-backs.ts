// 卡背：牌庫、對手手牌上看到的那一面。每副牌組可以選一種（組牌畫面），連線對戰時對手也看得到。
// 圖案用 CSS 與向量圖畫，任何大小都清楚；要新增一種就在 CARD_BACKS 加一筆，再到 style.css 加它的顏色（.cb-<id>）。

export interface CardBack {
  id: string;
  name: string;
  /** 中間徽記的向量路徑（viewBox 0 0 100 100）。 */
  emblem: string;
}

export const CARD_BACKS: readonly CardBack[] = [
  {
    id: 'classic',
    name: '經典',
    // 八芒星
    emblem: 'M50 6 L57 38 L86 22 L66 46 L94 50 L66 54 L86 78 L57 62 L50 94 L43 62 L14 78 L34 54 L6 50 L34 46 L14 22 L43 38 Z',
  },
  {
    id: 'ember',
    name: '烈焰',
    // 火焰
    emblem: 'M50 6 C58 26 80 38 76 62 C73 82 60 94 50 94 C40 94 27 82 24 62 C21 44 36 36 38 20 C44 30 46 38 47 46 C55 36 56 22 50 6 Z',
  },
  {
    id: 'grove',
    name: '翠林',
    // 葉子（中間一條葉脈）
    emblem: 'M50 6 C78 22 86 58 50 94 C14 58 22 22 50 6 Z M50 16 L50 86',
  },
];

export const DEFAULT_BACK = CARD_BACKS[0]!.id;

/** 認得的卡背；不認得（舊存檔、別人的新版本）就用預設的。 */
export const backOf = (id: string | undefined): CardBack => CARD_BACKS.find((back) => back.id === id) ?? CARD_BACKS[0]!;

/** 畫一張卡背。 */
export function cardBack(id: string | undefined, extraClass = ''): string {
  const back = backOf(id);
  return `<span class="card-back cb-${back.id}${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true">
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" class="cb-ring"/><path d="${back.emblem}" class="cb-mark"/></svg></span>`;
}

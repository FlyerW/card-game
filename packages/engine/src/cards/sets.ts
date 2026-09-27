// 卡包系列：每一彈的卡屬於一個系列。還沒發布的系列，遊戲、商店、組牌都看不到（只有預覽模式看得到），
// 發布時把 released 改成 true 就好。

export interface CardSet {
  id: string;
  name: string;
  released: boolean;
}

export const CARD_SETS: CardSet[] = [
  { id: 'core', name: '基本卡包', released: true },
  { id: 'awakening', name: '龍脈覺醒', released: false },
];

/** 卡片的系列：沒寫就是基本卡包。 */
export const setOf = (card: { set?: string }): string => card.set ?? 'core';

export const isReleased = (setId: string): boolean => CARD_SETS.find((set) => set.id === setId)?.released === true;

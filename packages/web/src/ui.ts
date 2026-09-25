import type { Color, DeckCardDef } from '@card-game/engine';

// 牌桌與組牌畫面共用的小工具。

export const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function pips(colors: Color[]): string {
  if (colors.length === 0) return '<span class="pips" aria-label="無色"><i class="pip none"></i></span>';
  return `<span class="pips" aria-label="${colors.join('')}">${colors.map((c) => `<i class="pip ${c}"></i>`).join('')}</span>`;
}

export function kindLabel(def: DeckCardDef): string {
  switch (def.kind) {
    case 'creature':
      return def.stage === 0 ? '生物' : `進化・${def.stage === 1 ? '一階' : '二階'}`;
    case 'spell':
      return '法術';
    case 'item':
      return '道具';
    case 'field':
      return '場地';
    case 'heroEvolution':
      return '英雄進化';
  }
}

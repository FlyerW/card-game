import { RACE_NAMES, type Color, type DeckCardDef } from '@card-game/engine';

// 牌桌與組牌畫面共用的小工具。

export const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function pips(colors: Color[]): string {
  if (colors.length === 0) return '<span class="pips" aria-label="無色"><i class="pip none"></i></span>';
  return `<span class="pips" aria-label="${colors.join('')}">${colors.map((c) => `<i class="pip ${c}"></i>`).join('')}</span>`;
}

export function kindLabel(def: DeckCardDef): string {
  switch (def.kind) {
    case 'creature': {
      // 生物寫種族；進化卡多標「進化」。
      const race = def.race ? RACE_NAMES[def.race] : '生物';
      return def.stage === 0 ? race : `${race}・進化`;
    }
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

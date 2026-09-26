import { explainKeywords, RACE_NAMES, type Color, type DeckCardDef, type HeroDef } from '@card-game/engine';

// 牌桌與組牌畫面共用的小工具。

export const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 說明文字：跳脫之後把 **關鍵字** 換成粗體。 */
export const rich = (text: string) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/** 卡牌說明：第一行是標題，其餘是效果，最後用小字解釋用到的關鍵字。 */
export function detailLines(texts: readonly string[]): string {
  const [head, ...body] = texts;
  const glossary = explainKeywords(body);
  return (
    `<p class="d-head">${rich(head ?? '')}</p>${body.map((text) => `<p class="d-line">${rich(text)}</p>`).join('')}` +
    (glossary.length > 0 ? `<ul class="d-kw">${glossary.map((text) => `<li>${rich(text)}</li>`).join('')}</ul>` : '')
  );
}

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

/**
 * 插圖的完整網址。CSS 變數裡的相對網址會照「用到它的樣式表」去解析（打包後樣式表在 assets/ 底下），
 * 所以在這裡先換成完整網址。
 */
export const artUrl = (id: string): string => new URL(`art/${id}.webp`, document.baseURI).href;

export interface FaceOptions {
  /** 放在 <button> 上的屬性，例如 data-hand="3"。 */
  attrs?: string;
  /** 額外的 class，例如 playable、selected。 */
  classes?: string[];
  /** 卡片上緣的小標籤，例如「重抽」。 */
  mark?: string;
}

/**
 * 卡面：左上角費用，上排正中間名字、右上角顏色，中間插圖，下排左邊稀有度與種類、右邊 ⚔ 與 ♥。
 * 插圖是 art/<id>.webp；還沒有圖時顯示卡片顏色的底色。UR 英雄沒有費用，只寫 ♥。
 */
export function cardFace(def: DeckCardDef | HeroDef, options: FaceOptions = {}): string {
  const isHero = def.kind === 'hero';
  const rarity = isHero ? (def.rarity ?? '') : def.rarity;
  const classes = ['card', `k-${def.kind}`, rarity ? `r-${rarity}` : '', ...(options.classes ?? [])].filter(Boolean).join(' ');
  const evo = def.kind === 'creature' && def.stage > 0;
  const cost = isHero ? '' : `<span class="c-cost${evo ? ' evo' : ''}">${evo ? '+' : ''}${def.cost}</span>`;
  const kind = isHero ? '英雄' : kindLabel(def);
  const stats =
    def.kind === 'creature'
      ? `<span class="c-hp"><span class="c-atk">⚔${def.attack}</span> <span class="c-heart">♥</span>${def.hp}</span>`
      : isHero
        ? `<span class="c-hp"><span class="c-heart">♥</span>${def.hp}</span>`
        : '';
  const tint = def.colors[0] ?? 'none';
  return `<button class="${classes}" ${options.attrs ?? ''}>
      ${cost}<span class="c-name">${esc(def.name)}</span>${pips(def.colors)}
      <span class="c-art art-${tint}" style="--art:url('${artUrl(def.id)}')" aria-hidden="true"></span>
      <span class="c-foot"><span class="c-kind"><span class="rarity">${rarity}</span>${kind}</span>${stats}</span>
      ${options.mark ? `<span class="c-mark">${esc(options.mark)}</span>` : ''}
    </button>`;
}

import {
  CARD_SETS,
  cardNames,
  COLOR_NAMES,
  copyLimit,
  DEFAULT_RULES,
  deckPool,
  describeCard,
  describeColors,
  RARITIES,
  setOf,
  validateDeck,
  type CardDb,
  type Color,
  type DeckCardDef,
  type Rarity,
  encodeDeckCode,
} from '@card-game/engine';
import { cleanBook, DECK_NAME_LIMIT, emptyBook, type DeckBook, type SavedDeck } from '@card-game/economy';
import { buildDeck } from '@card-game/sim/deck';
import { CARD_BACKS, backOf, cardBack } from './card-backs';
import { cardFace, detailLines, esc, pips } from './ui';

// 組牌：照正式規則，30 張、同名最多 2 張、UR 最多 1 張、只能放英雄顏色內的卡與無色卡；
// 而且只能放收藏裡有的卡，張數不超過擁有的。
// 牌組每個帳號、每個英雄各存一副，存在這個瀏覽器裡；沒有自訂牌組就每局用收藏自動組一副。

/** 每張卡最多能放幾張：規則上限與擁有張數取小的。電腦組牌不看收藏，用 copyLimit。 */
export type Owned = (card: DeckCardDef) => number;

const { deckSize, maxCopies, maxUrCopies } = DEFAULT_RULES;
/** 牌組規則從 40 張改成 30 張時換了 key，舊的 40 張牌組就不讀了。 */
const STORAGE_KEY = 'card-game.decks.v3';
/** 舊版（每個英雄一副）的存檔，第一次讀的時候轉成牌組清單。 */
const OLD_STORAGE_KEY = 'card-game.decks.v2';

export type KindFilter = 'all' | 'creature' | 'spell' | 'other';
const FILTERS: [KindFilter, string][] = [
  ['all', '全部'],
  ['creature', '生物'],
  ['spell', '法術'],
  ['other', '道具・場地・英雄進化'],
];

/** 顏色篩選：英雄的某個顏色、無色，或全部。 */
export type ColorPick = Color | 'none' | 'all';
/** 費用篩選：1–6 各自一格，7 以上合成一格。 */
export type CostPick = number | 'all';
const COSTS: CostPick[] = ['all', 1, 2, 3, 4, 5, 6, 7];

export interface Builder {
  heroId: string;
  /** 正在編輯的牌組。 */
  deckId: string;
  /** 顯示牌組代碼（可以手動複製）。 */
  showCode: boolean;
  /** 按了「刪除這副」，等確認。 */
  confirmDelete: boolean;
  filter: KindFilter;
  color: ColorPick;
  cost: CostPick;
  rarity: Rarity | 'all';
  /** 只看哪幾個系列（可以多選）；空的就是全部。 */
  sets: string[];
  /** 說明欄正在看的卡。 */
  focus: string | null;
}

/** 每個帳號的牌組分開存，測試帳號的全卡牌組不會跑到 Google 帳號上。 */
const keyFor = (accountId: string, key = STORAGE_KEY) => `${key}:${accountId}`;

/** 讀出這個帳號存在瀏覽器裡的牌組清單。讀不到（隱私模式、被清掉）就當作沒有；舊版的存檔轉成新的。 */
export function loadBook(db: CardDb, accountId: string): DeckBook {
  try {
    const saved = localStorage.getItem(keyFor(accountId));
    if (saved !== null) return cleanBook(db, JSON.parse(saved));
    return cleanBook(db, JSON.parse(localStorage.getItem(keyFor(accountId, OLD_STORAGE_KEY)) ?? '{}'));
  } catch {
    return emptyBook();
  }
}

export function saveBook(book: DeckBook, accountId: string): void {
  try {
    localStorage.setItem(keyFor(accountId), JSON.stringify(book));
  } catch {
    // 存不了就只留在這次開著的頁面裡。
  }
}

/** 一副牌組的狀態：可以用、還差幾張、缺卡或不合法。 */
export function deckStatus(db: CardDb, deck: SavedDeck, owned: Owned): { ok: boolean; text: string } {
  if (deck.cards.length < deckSize) return { ok: false, text: `還差 ${deckSize - deck.cards.length} 張` };
  const missing = [...new Set(deck.cards)].reduce((sum, id) => {
    const card = db.cards.get(id);
    return sum + (card ? Math.max(0, count(deck.cards, id) - owned(card)) : 0);
  }, 0);
  if (missing > 0) return { ok: false, text: `缺 ${missing} 張卡` };
  const problems = deckIssues(db, deck.heroId, deck.cards, owned).problems;
  return problems.length > 0 ? { ok: false, text: '不合法' } : { ok: true, text: '可以用' };
}

const count = (deck: readonly string[], id: string) => deck.filter((each) => each === id).length;

/** 能不能再加一張；不能的話回傳原因。 */
export function addProblem(db: CardDb, deck: readonly string[], id: string, owned: Owned): string | null {
  if (deck.length >= deckSize) return `牌組已經 ${deckSize} 張了`;
  const card = db.cards.get(id);
  if (!card) return '沒有這張卡';
  const limit = copyLimit(DEFAULT_RULES, card);
  const have = owned(card);
  if (count(deck, id) >= limit) return limit < maxCopies ? `UR 最多 ${limit} 張` : `同名卡最多 ${limit} 張`;
  if (count(deck, id) >= have) return have === 0 ? '還沒有這張卡：開卡包或用粉塵合成' : `你只有 ${have} 張`;
  return null;
}

export function removeOne(deck: readonly string[], id: string): string[] {
  const index = deck.lastIndexOf(id);
  return index === -1 ? [...deck] : [...deck.slice(0, index), ...deck.slice(index + 1)];
}

/** 9 費以上算高費卡；30 張的牌組帶超過 2 張，前幾回合手上容易都是打不出來的牌。 */
const HIGH_COST = 9;
const MAX_HIGH_COST = 2;
const highCostCount = (db: CardDb, deck: readonly string[]) => deck.filter((id) => (db.cards.get(id)?.cost ?? 0) >= HIGH_COST).length;

/** 用英雄能用的卡隨機補滿，已經放的不動。高費卡補到上限為止。 */
export function fillRandom(db: CardDb, heroId: string, deck: readonly string[], owned: Owned): string[] {
  const spare = deckPool(db, heroId).flatMap((card) => Array<string>(Math.max(0, owned(card) - count(deck, card.id))).fill(card.id));
  for (let i = spare.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spare[i], spare[j]] = [spare[j]!, spare[i]!];
  }
  const filled = [...deck];
  let highCost = highCostCount(db, deck);
  for (const id of spare) {
    if (filled.length >= deckSize) break;
    if (db.cards.get(id)!.cost >= HIGH_COST && highCost++ >= MAX_HIGH_COST) continue;
    filled.push(id);
  }
  return filled;
}

/** 跟電腦的牌組一樣自動組一副：進化線照 2/2 帶，其餘隨機。給了 owned 就只用收藏裡的卡。 */
export const autoDeck = (db: CardDb, heroId: string, seed: number, owned?: Owned): string[] =>
  buildDeck(seed, heroId, deckPool(db, heroId), 2, owned);

/** 規則上的問題（有就不能開始），以及組牌建議（可以不理）。 */
export function deckIssues(db: CardDb, heroId: string, deck: readonly string[], owned: Owned): { problems: string[]; tips: string[] } {
  const problems = validateDeck(db, DEFAULT_RULES, heroId, deck);
  for (const id of new Set(deck)) {
    const card = db.cards.get(id);
    if (card && count(deck, id) > owned(card)) problems.push(`${card.name} 只有 ${owned(card)} 張，牌組放了 ${count(deck, id)} 張`);
  }
  const tips: string[] = [];
  const name = (id: string) => db.cards.get(id)?.name ?? id;
  for (const id of new Set(deck)) {
    const def = db.cards.get(id);
    if (def?.kind !== 'creature' || def.evolvesFrom === undefined) continue;
    const base = def.evolvesFrom;
    if (!deck.includes(base)) tips.push(`${def.name} 要由 ${name(base)} 進化，牌組裡沒有 ${name(base)}`);
    else if (count(deck, id) > count(deck, base)) tips.push(`${def.name} 比 ${name(base)} 多，容易卡在手上用不了（建議照 2/2 帶）`);
  }
  const highCost = highCostCount(db, deck);
  if (highCost > MAX_HIGH_COST) tips.push(`9 費以上的卡有 ${highCost} 張，前幾回合容易卡手（建議 ${MAX_HIGH_COST} 張以內）`);
  return { problems, tips };
}

// ─── 畫面 ────────────────────────────────────────────────────────────────────

const matches = (card: DeckCardDef, filter: KindFilter) =>
  filter === 'all' || (filter === 'creature' ? card.kind === 'creature' : filter === 'spell' ? card.kind === 'spell' : card.kind !== 'creature' && card.kind !== 'spell');

const KIND_ORDER: DeckCardDef['kind'][] = ['creature', 'spell', 'item', 'field', 'heroEvolution'];
const KIND_NAMES: Record<DeckCardDef['kind'], string> = {
  creature: '生物',
  spell: '法術',
  item: '道具',
  field: '場地',
  heroEvolution: '英雄進化',
};
const byCost = (x: DeckCardDef, y: DeckCardDef) =>
  x.cost - y.cost || RARITIES.indexOf(x.rarity) - RARITIES.indexOf(y.rarity) || x.name.localeCompare(y.name, 'zh-Hant');

function poolCard(db: CardDb, card: DeckCardDef, deck: readonly string[], focus: string | null, owned: Owned): string {
  const n = count(deck, card.id);
  const addWhy = addProblem(db, deck, card.id, owned);
  const have = owned(card);
  return `<div class="pool-card${n ? ' in-deck' : ''}${have === 0 ? ' unowned' : ''}${focus === card.id ? ' focused' : ''}">
    ${cardFace(card, { attrs: `data-focus="${card.id}" aria-label="${esc(card.name)}，看說明"` })}
    <div class="pc-count">
      <button data-remove="${card.id}" ${n === 0 ? 'disabled' : ''} aria-label="拿掉一張${esc(card.name)}">−</button>
      <span>${have === 0 ? '未擁有' : `<b>${n}</b>/${have}`}</span>
      <button data-add="${card.id}" ${addWhy ? `disabled title="${esc(addWhy)}"` : ''} aria-label="加一張${esc(card.name)}">+</button>
    </div>
  </div>`;
}

function curve(db: CardDb, deck: readonly string[]): string {
  const buckets = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((cost) => ({
    label: cost === 9 ? '9+' : String(cost),
    n: deck.filter((id) => {
      const c = db.cards.get(id)!.cost;
      return cost === 9 ? c >= 9 : cost === 1 ? c <= 1 : c === cost;
    }).length,
  }));
  const top = Math.max(1, ...buckets.map((b) => b.n));
  return `<div class="curve" aria-label="費用分布">${buckets
    .map((b) => `<div class="bar"><i style="height:${Math.round((b.n / top) * 100)}%"></i><b>${b.n}</b><span>${b.label}</span></div>`)
    .join('')}</div>`;
}

function deckList(db: CardDb, deck: readonly string[]): string {
  const ids = [...new Set(deck)].map((id) => db.cards.get(id)!).sort(byCost);
  const groups = KIND_ORDER.map((kind) => ids.filter((card) => card.kind === kind)).filter((group) => group.length > 0);
  if (groups.length === 0) return '<p class="d-line">還沒有放卡。點左邊卡片下面的「+」加進來。</p>';
  return groups
    .map((group) => {
      const total = group.reduce((sum, card) => sum + count(deck, card.id), 0);
      const rows = group
        .map(
          (card) => `<li><span class="dl-cost">${card.cost}</span><button class="dl-name" data-focus="${card.id}">${esc(card.name)}</button>
            <span class="dl-n">×${count(deck, card.id)}</span><button class="dl-minus" data-remove="${card.id}" aria-label="拿掉一張${esc(card.name)}">−</button></li>`,
        )
        .join('');
      return `<p class="dl-head">${KIND_NAMES[group[0]!.kind]}・${total}</p><ul class="deck-list">${rows}</ul>`;
    })
    .join('');
}

/** 顏色與費用篩選：7 那一格是 7 費以上。 */
const colorMatches = (card: DeckCardDef, color: ColorPick) =>
  color === 'all' || (color === 'none' ? card.colors.length === 0 : card.colors.includes(color));
const costMatches = (card: DeckCardDef, cost: CostPick) => cost === 'all' || (cost === 7 ? card.cost >= 7 : card.cost === cost);

export function deckScreen(db: CardDb, b: Builder, saved: SavedDeck, owned: Owned): string {
  const hero = db.heroes.get(b.heroId)!;
  const deck = saved.cards;
  const code = encodeDeckCode(saved.heroId, deck);
  // 擁有的排前面，沒有的變暗放後面，看得到還能收集什麼。
  const pool = deckPool(db, b.heroId)
    .filter(
      (card) =>
        matches(card, b.filter) &&
        colorMatches(card, b.color) &&
        costMatches(card, b.cost) &&
        (b.rarity === 'all' || card.rarity === b.rarity) &&
        (b.sets.length === 0 || b.sets.includes(setOf(card))),
    )
    .sort((x, y) => Number(owned(y) > 0) - Number(owned(x) > 0) || byCost(x, y));
  const { problems, tips } = deckIssues(db, b.heroId, deck, owned);
  const focus = b.focus ? db.cards.get(b.focus) : undefined;
  const focusBox = focus
    ? `<div class="focus">${detailLines(describeCard(focus, cardNames(db)))}
        <div class="respond"><button class="ghost" data-remove="${focus.id}" ${count(deck, focus.id) === 0 ? 'disabled' : ''}>拿掉一張</button>
        <button class="primary" data-add="${focus.id}" ${addProblem(db, deck, focus.id, owned) ? 'disabled' : ''}>加一張（${count(deck, focus.id)}/${owned(focus)}）</button></div>
        ${owned(focus) === 0 ? '<p class="d-line warn">還沒有這張卡：開卡包，或到「卡包與收藏」用粉塵合成。</p>' : ''}
        <button class="ghost focus-close" data-do="focus-close">關閉</button></div>`
    : '<p class="d-line">點卡片看說明；卡片下面的 − ＋ 調整張數。</p>';
  const status =
    problems.length === 0
      ? '<p class="ok">✓ 牌組合法，可以開始對戰</p>'
      : `<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  const tipList = tips.length ? `<ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  const chip = (attr: string, value: string, label: string, on: boolean) =>
    `<button class="chip${on ? ' on' : ''}" ${attr}="${value}" aria-pressed="${on}">${label}</button>`;
  const filters = FILTERS.map(([id, label]) => chip('data-filter', id, label, b.filter === id)).join('');
  // 顏色只列這個英雄能用的，加上無色。
  const colorOptions: [ColorPick, string][] = [['all', '全部顏色'], ...hero.colors.map((c): [ColorPick, string] => [c, COLOR_NAMES[c]]), ['none', '無色']];
  const colorChips = colorOptions.map(([c, label]) => chip('data-color', c, label, b.color === c)).join('');
  const rarityChips = (['all', ...RARITIES] as const).map((r) => chip('data-rarity', r, r === 'all' ? '全部稀有度' : r, b.rarity === r)).join('');
  const costChips = COSTS.map((c) => chip('data-cost', String(c), c === 'all' ? '全部費用' : c === 7 ? '7+' : String(c), b.cost === c)).join('');
  // 系列：看得到兩個以上的系列（預覽）才顯示；可以多選。
  const sets = CARD_SETS.filter((set) => deckPool(db, b.heroId).some((card) => setOf(card) === set.id));
  const setChips =
    sets.length > 1
      ? `<div class="chips">${chip('data-deck-set', 'all', '全部系列', b.sets.length === 0)}${sets
          .map((set) => chip('data-deck-set', set.id, `${esc(set.name)}${set.released ? '' : '（預覽）'}`, b.sets.includes(set.id)))
          .join('')}</div>`
      : '';
  const back = backOf(saved.back).id;
  const backPicker = `<div class="back-picker" role="group" aria-label="卡背">${CARD_BACKS.map(
    (each) => `<button class="back-pick${each.id === back ? ' on' : ''}" data-back="${each.id}" aria-pressed="${each.id === back}">${cardBack(each.id)}<span>${esc(each.name)}</span></button>`,
  ).join('')}</div>`;

  return `<main class="builder">
    <header class="b-head">
      <div><h1 class="deck-title">組牌・${esc(hero.name)}・<input id="deck-name" maxlength="${DECK_NAME_LIMIT}" value="${esc(saved.name)}" aria-label="牌組名字"></h1>
        <p>${pips(hero.colors)} ${describeColors(hero.colors)}的卡加上無色卡；${deckSize} 張，同名最多 ${maxCopies} 張，UR 最多 ${maxUrCopies} 張，只能放收藏裡有的卡。牌組會自動存起來。</p></div>
      <div class="b-count${deck.length === deckSize ? ' full' : ''}"><b>${deck.length}</b>/${deckSize}</div>
    </header>
    <div class="b-body">
      <section class="b-pool" aria-label="可以放的卡">
        <div class="chips">${filters}</div>
        <div class="chips">${rarityChips}</div>
        <div class="chips">${colorChips}</div>
        <div class="chips">${costChips}</div>
        ${setChips}
        <div class="pool">${pool.map((card) => poolCard(db, card, deck, b.focus, owned)).join('')}</div>
      </section>
      ${focus ? '<div class="shop-backdrop" data-do="focus-close"></div>' : ''}
      <aside class="b-side">
        <div class="detail b-tools">
          <div class="b-actions">
            <button class="ghost" data-do="deck-fill" ${deck.length >= deckSize ? 'disabled' : ''}>隨機補滿</button>
            <button class="ghost" data-do="deck-auto">自動組一副</button>
            <button class="ghost" data-do="deck-clear" ${deck.length === 0 ? 'disabled' : ''}>清空</button>
          </div>
          <div class="b-actions">
            <button class="ghost" data-do="deck-code">複製牌組代碼</button>
            <button class="ghost" data-do="deck-copy">另存一副</button>
            ${
              b.confirmDelete
                ? '<button class="primary danger" data-do="deck-delete-confirm">確定刪除</button><button class="ghost" data-do="deck-delete-cancel">留著</button>'
                : '<button class="ghost" data-do="deck-delete">刪除這副</button>'
            }
          </div>
          ${b.showCode ? `<label class="deck-code">把代碼傳給朋友，他在開局畫面按「貼上代碼」就能拿到一樣的牌組：<input id="deck-code-out" readonly value="${esc(code)}"></label>` : ''}
          <p class="dl-head">卡背</p>
          ${backPicker}
        </div>
        <div class="detail${focus ? ' has-focus' : ''}">${focusBox}</div>
        <div class="detail">
          ${status}${tipList}
          ${curve(db, deck)}
          ${deckList(db, deck)}
        </div>
        <button class="primary big" data-do="deck-done">完成</button>
      </aside>
    </div>
  </main>`;
}

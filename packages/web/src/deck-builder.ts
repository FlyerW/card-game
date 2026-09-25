import {
  DEFAULT_RULES,
  deckPool,
  describeCard,
  describeColors,
  RARITIES,
  validateDeck,
  type CardDb,
  type DeckCardDef,
} from '@card-game/engine';
import { buildDeck } from '@card-game/sim/deck';
import { esc, kindLabel, pips } from './ui';

// 組牌：照正式規則，40 張、同名最多 3 張、只能放英雄顏色內的卡與無色卡。
// 牌組每個英雄各存一副，存在這個瀏覽器裡；沒有自訂牌組就每局自動組一副。

const { deckSize, maxCopies } = DEFAULT_RULES;
const STORAGE_KEY = 'card-game.decks.v1';

export type KindFilter = 'all' | 'creature' | 'spell' | 'other';
const FILTERS: [KindFilter, string][] = [
  ['all', '全部'],
  ['creature', '生物'],
  ['spell', '法術'],
  ['other', '道具・場地・英雄進化'],
];

export interface Builder {
  heroId: string;
  filter: KindFilter;
  /** 說明欄正在看的卡。 */
  focus: string | null;
}

/** 讀出存著的牌組。讀不到（隱私模式、被清掉）就當作沒有；不認得的卡直接拿掉。 */
export function loadDecks(db: CardDb): Record<string, string[]> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};
    const decks: Record<string, string[]> = {};
    for (const [heroId, deck] of Object.entries(raw)) {
      if (db.heroes.has(heroId) && Array.isArray(deck)) decks[heroId] = deck.filter((id) => typeof id === 'string' && db.cards.has(id));
    }
    return decks;
  } catch {
    return {};
  }
}

export function saveDecks(decks: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  } catch {
    // 存不了就只留在這次開著的頁面裡。
  }
}

const count = (deck: readonly string[], id: string) => deck.filter((each) => each === id).length;

/** 能不能再加一張；不能的話回傳原因。 */
export function addProblem(deck: readonly string[], id: string): string | null {
  if (deck.length >= deckSize) return `牌組已經 ${deckSize} 張了`;
  if (count(deck, id) >= maxCopies) return `同名卡最多 ${maxCopies} 張`;
  return null;
}

export function removeOne(deck: readonly string[], id: string): string[] {
  const index = deck.lastIndexOf(id);
  return index === -1 ? [...deck] : [...deck.slice(0, index), ...deck.slice(index + 1)];
}

/** 9 費以上算高費卡；帶超過 3 張，前幾回合手上容易都是打不出來的牌。 */
const HIGH_COST = 9;
const MAX_HIGH_COST = 3;
const highCostCount = (db: CardDb, deck: readonly string[]) => deck.filter((id) => (db.cards.get(id)?.cost ?? 0) >= HIGH_COST).length;

/** 用英雄能用的卡隨機補到 40 張，已經放的不動。高費卡補到 3 張為止。 */
export function fillRandom(db: CardDb, heroId: string, deck: readonly string[]): string[] {
  const spare = deckPool(db, heroId).flatMap((card) => Array<string>(maxCopies - count(deck, card.id)).fill(card.id));
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

/** 跟電腦的牌組一樣自動組一副：進化線照 3/2/1 帶，其餘隨機。 */
export const autoDeck = (db: CardDb, heroId: string, seed: number): string[] => buildDeck(seed, heroId, deckPool(db, heroId));

/** 規則上的問題（有就不能開始），以及組牌建議（可以不理）。 */
export function deckIssues(db: CardDb, heroId: string, deck: readonly string[]): { problems: string[]; tips: string[] } {
  const problems = validateDeck(db, DEFAULT_RULES, heroId, deck);
  const tips: string[] = [];
  const name = (id: string) => db.cards.get(id)?.name ?? id;
  for (const id of new Set(deck)) {
    const def = db.cards.get(id);
    if (def?.kind !== 'creature' || def.evolvesFrom === undefined) continue;
    const base = def.evolvesFrom;
    if (!deck.includes(base)) tips.push(`${def.name} 要由 ${name(base)} 進化，牌組裡沒有 ${name(base)}`);
    else if (count(deck, id) > count(deck, base)) tips.push(`${def.name} 比 ${name(base)} 多，容易卡在手上用不了（建議照 3/2/1 帶）`);
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

function poolCard(card: DeckCardDef, deck: readonly string[], focus: string | null): string {
  const n = count(deck, card.id);
  const hp = card.kind === 'creature' ? `<span class="c-hp">HP ${card.hp}</span>` : '';
  const evo = card.kind === 'creature' && card.stage > 0;
  const addWhy = addProblem(deck, card.id);
  return `<div class="pool-card${n ? ' in-deck' : ''}${focus === card.id ? ' focused' : ''}">
    <button class="card k-${card.kind} r-${card.rarity}" data-focus="${card.id}" aria-label="${esc(card.name)}，看說明">
      <span class="c-cost${evo ? ' evo' : ''}">${evo ? '+' : ''}${card.cost}</span>
      <span class="c-top"><span class="rarity">${card.rarity}</span>${pips(card.colors)}</span>
      <span class="c-name">${esc(card.name)}</span>
      <span class="c-kind">${kindLabel(card)}</span>${hp}
    </button>
    <div class="pc-count">
      <button data-remove="${card.id}" ${n === 0 ? 'disabled' : ''} aria-label="拿掉一張${esc(card.name)}">−</button>
      <span><b>${n}</b>/${maxCopies}</span>
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

export function deckScreen(db: CardDb, b: Builder, deck: readonly string[], custom: boolean): string {
  const hero = db.heroes.get(b.heroId)!;
  const pool = deckPool(db, b.heroId).filter((card) => matches(card, b.filter)).sort(byCost);
  const { problems, tips } = deckIssues(db, b.heroId, deck);
  const focus = b.focus ? db.cards.get(b.focus) : undefined;
  const focusBox = focus
    ? `<div class="focus">${describeCard(focus, (id) => db.cards.get(id)?.name ?? id)
        .map((line, i) => (i === 0 ? `<p class="d-head">${esc(line)}</p>` : `<p class="d-line">${esc(line)}</p>`))
        .join('')}
        <div class="respond"><button class="ghost" data-remove="${focus.id}" ${count(deck, focus.id) === 0 ? 'disabled' : ''}>拿掉一張</button>
        <button class="primary" data-add="${focus.id}" ${addProblem(deck, focus.id) ? 'disabled' : ''}>加一張（${count(deck, focus.id)}/${maxCopies}）</button></div></div>`
    : '<p class="d-line">點卡片看說明；卡片下面的 − ＋ 調整張數。</p>';
  const status =
    problems.length === 0
      ? '<p class="ok">✓ 牌組合法，可以開始對戰</p>'
      : `<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  const tipList = tips.length ? `<ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  const filters = FILTERS.map(
    ([id, label]) => `<button class="chip${b.filter === id ? ' on' : ''}" data-filter="${id}" aria-pressed="${b.filter === id}">${label}</button>`,
  ).join('');

  return `<main class="builder">
    <header class="b-head">
      <div><h1>組牌・${esc(hero.name)}</h1>
        <p>${pips(hero.colors)} ${describeColors(hero.colors)}的卡加上無色卡；${deckSize} 張，同名最多 ${maxCopies} 張。
        ${custom ? '牌組存在這個瀏覽器裡。' : '還沒有自訂牌組，開始對戰時會自動組一副。'}</p></div>
      <div class="b-count${deck.length === deckSize ? ' full' : ''}"><b>${deck.length}</b>/${deckSize}</div>
    </header>
    <div class="b-body">
      <section class="b-pool" aria-label="可以放的卡">
        <div class="chips">${filters}</div>
        <div class="pool">${pool.map((card) => poolCard(card, deck, b.focus)).join('')}</div>
      </section>
      <aside class="b-side">
        <div class="detail">${focusBox}</div>
        <div class="detail">
          ${status}${tipList}
          ${curve(db, deck)}
          ${deckList(db, deck)}
          <div class="b-actions">
            <button class="ghost" data-do="deck-fill" ${deck.length >= deckSize ? 'disabled' : ''}>隨機補滿</button>
            <button class="ghost" data-do="deck-auto">自動組一副</button>
            <button class="ghost" data-do="deck-clear" ${deck.length === 0 ? 'disabled' : ''}>清空</button>
            ${custom ? '<button class="ghost" data-do="deck-forget">不用自訂牌組</button>' : ''}
          </div>
        </div>
        <button class="primary big" data-do="deck-done">完成</button>
      </aside>
    </div>
  </main>`;
}

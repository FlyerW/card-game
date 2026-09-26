import {
  COLOR_NAMES,
  copyLimit,
  DEFAULT_RULES,
  describeCard,
  cardNames,
  describeHero,
  RARITIES,
  type CardDb,
  type Color,
  type DeckCardDef,
  type HeroDef,
  type Rarity,
} from '@card-game/engine';
import { ECONOMY, packItems, questDef, type PackCard, type PackItem, type Profile } from '@card-game/economy';
import type { Backend } from './account';
import { cardFace, detailLines, esc, pips } from './ui';

// 卡包與收藏：金幣、開卡包、兌換卷。規則在 @card-game/economy，這裡只負責畫面；
// 開卡包與兌換交給登入的帳號（測試帳號在瀏覽器裡算，Google 帳號交給伺服器）。

/** 每張卡最多能放進牌組幾張：規則上限與擁有張數取小的。 */
export const ownedOf = (profile: Profile) => (card: DeckCardDef): number =>
  Math.min(copyLimit(DEFAULT_RULES, card), profile.collection[card.id] ?? 0);

// ─── 畫面 ────────────────────────────────────────────────────────────────────

export type ColorFilter = Color | 'none' | 'all';

export interface Shop {
  rarity: Rarity | 'all';
  color: ColorFilter;
  /** 只看還沒收齊的卡。 */
  missing: boolean;
  focus: string | null;
  /** 剛開的那一包。 */
  opened: PackCard[] | null;
  /** 剛開完：這次繪製播發牌動畫，之後點別的就不再播。 */
  dealing: boolean;
  /** 兌換成功之類的提示。 */
  notice: string | null;
  /** 正在等開卡包或兌換的結果。 */
  busy: boolean;
}

export const newShop = (): Shop => ({
  rarity: 'all',
  color: 'all',
  missing: false,
  focus: null,
  opened: null,
  dealing: false,
  notice: null,
  busy: false,
});

/** 開局畫面上的金幣與今日任務。 */
export function walletBar(profile: Profile): string {
  const quest = questDef(profile.quest.id);
  const questText = quest
    ? `${esc(quest.text)}　<b>${profile.quest.progress}/${quest.goal}</b>　${profile.quest.done ? '<span class="done">✓ 已完成</span>' : `獎勵 ${ECONOMY.questReward} 金幣`}`
    : '今天沒有任務';
  return `<section class="wallet">
    <div class="w-gold"><span class="coin" aria-hidden="true"></span><b>${profile.gold}</b><span>金幣</span></div>
    <div class="w-info">
      <p class="d-line"><span class="w-label">今日任務</span>${questText}</p>
      <p class="d-line"><span class="w-label">贏場金幣</span>贏一場 ${ECONOMY.winGold}，今天 <b>${profile.winGoldToday}/${ECONOMY.dailyWinGoldCap}</b></p>
    </div>
    <button class="ghost" data-do="shop">卡包與收藏${profile.gold >= ECONOMY.packPrice ? '<span class="dot" aria-label="可以開卡包"></span>' : ''}</button>
  </section>`;
}

/** 收藏裡的一格：一張卡，或一個 UR 英雄。 */
interface Collectible extends PackItem {
  def: DeckCardDef | HeroDef;
  colors: Color[];
}

function collectibles(db: CardDb): Collectible[] {
  return packItems(db, DEFAULT_RULES).map((item) => {
    const def = item.hero ? db.heroes.get(item.id)! : db.cards.get(item.id)!;
    return { ...item, def, colors: def.colors };
  });
}

const costOf = (def: DeckCardDef | HeroDef) => (def.kind === 'hero' ? -1 : def.cost);
const RARITY_ORDER = (x: Collectible, y: Collectible) =>
  RARITIES.indexOf(y.rarity) - RARITIES.indexOf(x.rarity) || costOf(x.def) - costOf(y.def) || x.name.localeCompare(y.name, 'zh-Hant');

/** 卡面：跟牌桌同一套；UR 英雄沒有費用，寫 HP。 */
const itemFace = (def: DeckCardDef | HeroDef, attrs: string): string => cardFace(def, { attrs });

function packRow(db: CardDb, profile: Profile, opened: PackCard[], dealing: boolean): string {
  const cards = opened
    .map((got, i) => {
      const card = got.hero ? db.heroes.get(got.cardId)! : db.cards.get(got.cardId)!;
      // 開完之後的張數，扣掉同一包後面又開到的，就是開到這張時的第幾張。
      const later = opened.filter((other, j) => j > i && other.cardId === got.cardId && !other.duplicate).length;
      const nth = (profile.collection[got.cardId] ?? 0) - later;
      const label = got.duplicate
        ? `<span class="p-tag dup">重複 → ${got.rarity} 兌換卷 +1</span>`
        : `<span class="p-tag new">${got.hero ? '新英雄' : nth === 1 ? '新卡' : `第 ${nth} 張`}</span>`;
      return `<div class="p-card" style="--i:${i}">${itemFace(card, `data-focus="${card.id}" aria-label="${esc(card.name)}，看說明"`)}${label}</div>`;
    })
    .join('');
  return `<div class="pack-row${dealing ? ' deal' : ''}" aria-label="剛開的卡包">${cards}</div>`;
}

export function shopScreen(db: CardDb, profile: Profile, shop: Shop, toast: string | null): string {
  const all = collectibles(db);
  const owned = (item: { id: string }) => profile.collection[item.id] ?? 0;
  const full = (item: Collectible) => owned(item) >= item.limit;
  const kinds = all.filter((item) => owned(item) > 0).length;
  const copies = all.reduce((sum, item) => sum + owned(item), 0);
  const shown = all
    .filter((card) => shop.rarity === 'all' || card.rarity === shop.rarity)
    .filter((card) => (shop.color === 'all' ? true : shop.color === 'none' ? card.colors.length === 0 : card.colors.includes(shop.color)))
    .filter((card) => !shop.missing || !full(card))
    .sort(RARITY_ORDER);

  const chip = (attr: string, value: string, label: string, on: boolean) =>
    `<button class="chip${on ? ' on' : ''}" ${attr}="${value}" aria-pressed="${on}">${label}</button>`;
  const rarityChips = [chip('data-rarity', 'all', '全部', shop.rarity === 'all'), ...RARITIES.map((r) => chip('data-rarity', r, r, shop.rarity === r))].join('');
  const colors: [ColorFilter, string][] = [['all', '全部顏色'], ...(Object.entries(COLOR_NAMES) as [Color, string][]), ['none', '無色']];
  const colorChips = colors.map(([c, label]) => chip('data-color', c, label, shop.color === c)).join('');

  const grid = shown
    .map((item) => {
      const n = owned(item);
      const count = item.hero ? (n > 0 ? '已擁有 ✓' : '未擁有') : n === 0 ? '未擁有' : `<b>${n}</b>/${item.limit}${n >= item.limit ? ' ✓' : ''}`;
      return `<div class="pool-card${n === 0 ? ' unowned' : ''}${shop.focus === item.id ? ' focused' : ''}">
        ${itemFace(item.def, `data-focus="${item.id}" aria-label="${esc(item.name)}，看說明"`)}
        <div class="own-count">${count}</div></div>`;
    })
    .join('');

  const focus = shop.focus ? all.find((item) => item.id === shop.focus) : undefined;
  let focusBox = '<p class="d-line">點卡片看說明。沒收齊的卡（或還沒有的 UR 英雄）可以用 3 張同稀有度的兌換卷換。</p>';
  if (focus) {
    const n = owned(focus);
    const vouchers = profile.vouchers[focus.rarity];
    const why = full(focus)
      ? focus.hero ? '已經有這個英雄了' : '已經收齊了'
      : vouchers < ECONOMY.vouchersPerCard
        ? `${focus.rarity} 兌換卷不夠（${vouchers}/${ECONOMY.vouchersPerCard}）`
        : null;
    const lines = focus.def.kind === 'hero'
      ? describeHero(focus.def, cardNames(db))
      : describeCard(focus.def, cardNames(db));
    const have = focus.hero
      ? `${n > 0 ? '已經有了，開局時可以選' : '還沒有：從卡包抽到，或用兌換卷換'}。`
      : `擁有 <b>${n}</b> 張，牌組最多放 ${focus.limit} 張。`;
    focusBox = `<div class="focus">${detailLines(lines)}
      <p class="d-line">${have}</p>
      <button class="primary" data-exchange="${focus.id}" ${why || shop.busy ? 'disabled' : ''}>用 ${ECONOMY.vouchersPerCard} 張 ${focus.rarity} 兌換卷換${focus.hero ? '這個英雄' : '一張'}</button>
      ${why ? `<p class="d-line">${why}</p>` : ''}</div>`;
  }

  const canBuy = profile.gold >= ECONOMY.packPrice;
  const vouchers = RARITIES.map((r) => `<span class="voucher r-${r}"><span class="rarity">${r}</span> <b>${profile.vouchers[r]}</b></span>`).join('');
  const { UR, SR, R } = ECONOMY.odds;
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  return `<main class="builder shop">
    <header class="b-head">
      <div><h1>卡包與收藏</h1>
        <p>收藏 ${kinds}/${all.length} 種，共 ${copies} 張。贏一場 ${ECONOMY.winGold} 金幣（每天最多 ${ECONOMY.dailyWinGoldCap}），完成每日任務 ${ECONOMY.questReward} 金幣。</p></div>
      <div class="w-gold"><span class="coin" aria-hidden="true"></span><b>${profile.gold}</b><span>金幣</span></div>
    </header>
    <section class="pack-bar">
      <div class="pack-info">
        <p class="d-head">卡包・${ECONOMY.packPrice} 金幣</p>
        <p class="d-line">一包 ${ECONOMY.packSize} 張，每張 R ${pct(R)}、SR ${pct(SR)}、UR ${pct(UR)}，其餘 N；每包至少一張 R 以上。
          UR 也可能開到多色的 UR 英雄。已經有 ${DEFAULT_RULES.maxCopies} 張（UR ${DEFAULT_RULES.maxUrCopies} 張、英雄 1 個）的再開到，換成一張同稀有度的兌換卷。</p>
        <p class="vouchers"><span class="w-label">兌換卷</span>${vouchers}</p>
      </div>
      <button class="primary big" data-do="open-pack" ${canBuy && !shop.busy ? '' : 'disabled'}>${shop.busy ? '開卡包中……' : canBuy ? '開一包' : `金幣不夠（${profile.gold}/${ECONOMY.packPrice}）`}</button>
    </section>
    ${toast ? `<p class="toast" role="alert">${esc(toast)}</p>` : ''}
    ${shop.notice ? `<p class="notice" role="status">${esc(shop.notice)}</p>` : ''}
    ${shop.opened ? packRow(db, profile, shop.opened, shop.dealing) : ''}
    <div class="b-body">
      <section class="b-pool" aria-label="收藏">
        <div class="chips">${rarityChips}</div>
        <div class="chips">${colorChips}${chip('data-missing', String(!shop.missing), '只看沒收齊的', shop.missing)}</div>
        <div class="pool">${grid || '<p class="d-line">沒有符合的卡。</p>'}</div>
      </section>
      <aside class="b-side">
        <div class="detail">${focusBox}</div>
        <button class="primary big" data-do="shop-done">回到開局</button>
      </aside>
    </div>
  </main>`;
}

/** 卡包畫面會改的資料；main 的 app 直接符合這個形狀。 */
export interface ShopHost {
  profile: Profile;
  shop: Shop;
  toast: string | null;
}

/** 卡包畫面的點擊。處理了就回傳 true。開卡包與兌換要等帳號回覆，好了再呼叫 rerender。 */
export function shopClick(
  db: CardDb,
  host: ShopHost,
  backend: Backend,
  el: HTMLElement,
  command: string | undefined,
  rerender: () => void,
): boolean {
  const { focus, rarity, color, missing, exchange: exchangeId } = el.dataset;
  host.toast = null;
  host.shop.dealing = false;
  host.shop.notice = null;
  if (focus) {
    host.shop.focus = host.shop.focus === focus ? null : focus;
  } else if (rarity) {
    host.shop.rarity = rarity as Shop['rarity'];
  } else if (color) {
    host.shop.color = color as ColorFilter;
  } else if (missing) {
    host.shop.missing = missing === 'true';
  } else if ((command === 'open-pack' || exchangeId) && !host.shop.busy) {
    host.shop.busy = true;
    const done = () => {
      host.shop.busy = false;
      rerender();
    };
    if (command === 'open-pack') {
      void backend.openPack(host.profile).then((opened) => {
        if (opened.ok) {
          host.profile = opened.profile;
          host.shop.opened = opened.cards;
          host.shop.dealing = true;
          host.shop.focus = null;
        } else host.toast = opened.reason;
        done();
      });
    } else {
      const cardId = exchangeId!;
      void backend.exchange(host.profile, cardId).then((swapped) => {
        if (swapped.ok) {
          host.profile = swapped.profile;
          const hero = db.heroes.get(cardId);
          host.shop.notice = hero ? `換到了英雄 ${hero.name}，開局時可以選了` : `換到了 ${db.cards.get(cardId)!.name}（現在 ${host.profile.collection[cardId]} 張）`;
        } else host.toast = swapped.reason;
        done();
      });
    }
  } else {
    return false;
  }
  return true;
}

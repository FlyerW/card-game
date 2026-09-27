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
import { ECONOMY, PACK_BATCH, packItems, questDef, TOPUPS, type PackCard, type PackItem, type Profile } from '@card-game/economy';
import type { Backend } from './account';
import { cardFace, detailLines, esc, pips } from './ui';

// 卡包與收藏：金幣、開卡包、粉塵合成。規則在 @card-game/economy，這裡只負責畫面；
// 開卡包與兌換交給登入的帳號（測試帳號在瀏覽器裡算，Google 帳號交給伺服器）。

/** 每張卡最多能放進牌組幾張：規則上限與擁有張數取小的。 */
export const ownedOf = (profile: Profile) => (card: DeckCardDef): number =>
  Math.min(copyLimit(DEFAULT_RULES, card), profile.collection[card.id] ?? 0);

// ─── 畫面 ────────────────────────────────────────────────────────────────────

export type ColorFilter = Color | 'none' | 'all';

export interface Shop {
  rarity: Rarity | 'all';
  color: ColorFilter;
  /** 費用：1–6 各一格、7 是 7 以上；英雄沒有費用，選了費用就不列。 */
  cost: number | 'all';
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
  cost: 'all',
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

function packRow(db: CardDb, profile: Profile, unsorted: PackCard[], dealing: boolean): string {
  // 開很多包時照稀有度排（UR 在前），發牌動畫也快一點，上面先寫一行總結。
  const many = unsorted.length > ECONOMY.packSize;
  const order = ['UR', 'SR', 'R', 'N'];
  const opened = many ? [...unsorted].sort((x, y) => order.indexOf(x.rarity) - order.indexOf(y.rarity)) : unsorted;
  const cards = opened
    .map((got, i) => {
      const card = got.hero ? db.heroes.get(got.cardId)! : db.cards.get(got.cardId)!;
      // 開完之後的張數，扣掉同一包後面又開到的，就是開到這張時的第幾張。
      const later = opened.filter((other, j) => j > i && other.cardId === got.cardId && !other.duplicate).length;
      const nth = (profile.collection[got.cardId] ?? 0) - later;
      const label = got.duplicate
        ? `<span class="p-tag dup">${many ? `粉塵 +${got.dust}` : `重複 → 粉塵 +${got.dust}`}</span>`
        : `<span class="p-tag new">${got.hero ? '新英雄' : nth === 1 ? '新卡' : `第 ${nth} 張`}</span>`;
      return `<div class="p-card" style="--i:${i}">${itemFace(card, `data-focus="${card.id}" aria-label="${esc(card.name)}，看說明"`)}${label}</div>`;
    })
    .join('');
  const summary = many
    ? `<p class="pack-summary">${opened.length / ECONOMY.packSize} 包、${opened.length} 張：${order
        .map((rarity) => `${rarity} ${opened.filter((got) => got.rarity === rarity).length}`)
        .join('、')}；新卡 ${opened.filter((got) => !got.duplicate).length} 張，粉塵 +${opened.reduce((sum, got) => sum + got.dust, 0)}</p>`
    : '';
  return `${summary}<div class="pack-row${dealing ? ' deal' : ''}${many ? ' many' : ''}" aria-label="剛開的卡包">${cards}</div>`;
}

/** 儲值：跳到綠界付款頁，付完按「返回商店」回來。 */
function topupBar(canTopup: boolean, busy: boolean): string {
  if (!canTopup) return '';
  const buttons = TOPUPS.map(
    (topup) => `<button class="ghost topup" data-topup="${topup.id}" ${busy ? 'disabled' : ''}><b>${topup.gold}</b> 金幣<small>NT$${topup.price}</small></button>`,
  ).join('');
  return `<section class="topup-bar">
      <div><p class="d-head">儲值金幣</p><p class="d-line">NT$30 = 100 金幣。付款由綠界科技處理，可以用信用卡、ATM 或超商代碼；付款完成後金幣會自動入帳。</p></div>
      <div class="topups">${buttons}</div>
    </section>`;
}

export function shopScreen(db: CardDb, profile: Profile, shop: Shop, toast: string | null, canTopup = false): string {
  const all = collectibles(db);
  const owned = (item: { id: string }) => profile.collection[item.id] ?? 0;
  const full = (item: Collectible) => owned(item) >= item.limit;
  const kinds = all.filter((item) => owned(item) > 0).length;
  const copies = all.reduce((sum, item) => sum + owned(item), 0);
  const shown = all
    .filter((card) => shop.rarity === 'all' || card.rarity === shop.rarity)
    .filter((card) => (shop.color === 'all' ? true : shop.color === 'none' ? card.colors.length === 0 : card.colors.includes(shop.color)))
    .filter((card) => shop.cost === 'all' || (card.def.kind !== 'hero' && (shop.cost === 7 ? card.def.cost >= 7 : card.def.cost === shop.cost)))
    .filter((card) => !shop.missing || !full(card))
    .sort(RARITY_ORDER);

  const chip = (attr: string, value: string, label: string, on: boolean) =>
    `<button class="chip${on ? ' on' : ''}" ${attr}="${value}" aria-pressed="${on}">${label}</button>`;
  const rarityChips = [chip('data-rarity', 'all', '全部', shop.rarity === 'all'), ...RARITIES.map((r) => chip('data-rarity', r, r, shop.rarity === r))].join('');
  const colors: [ColorFilter, string][] = [['all', '全部顏色'], ...(Object.entries(COLOR_NAMES) as [Color, string][]), ['none', '無色']];
  const colorChips = colors.map(([c, label]) => chip('data-color', c, label, shop.color === c)).join('');
  const costs: (number | 'all')[] = ['all', 1, 2, 3, 4, 5, 6, 7];
  const costChips = costs.map((c) => chip('data-cost', String(c), c === 'all' ? '全部費用' : c === 7 ? '7+' : String(c), shop.cost === c)).join('');

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
  const { craftCost } = ECONOMY;
  let focusBox = `<p class="d-line">點卡片看說明。沒收齊的卡（或還沒有的 UR 英雄）可以用粉塵合成：N ${craftCost.N}、R ${craftCost.R}、SR ${craftCost.SR}、UR ${craftCost.UR}。</p>`;
  if (focus) {
    const n = owned(focus);
    const cost = craftCost[focus.rarity];
    const why = full(focus)
      ? focus.hero ? '已經有這個英雄了' : '已經收齊了'
      : profile.dust < cost
        ? `粉塵不夠（${profile.dust}/${cost}）`
        : null;
    const lines = focus.def.kind === 'hero'
      ? describeHero(focus.def, cardNames(db))
      : describeCard(focus.def, cardNames(db));
    const have = focus.hero
      ? `${n > 0 ? '已經有了，開局時可以選' : '還沒有：從卡包抽到，或用粉塵合成'}。`
      : `擁有 <b>${n}</b> 張，牌組最多放 ${focus.limit} 張。`;
    focusBox = `<div class="focus">${detailLines(lines)}
      <p class="d-line">${have}</p>
      <button class="primary" data-craft="${focus.id}" ${why || shop.busy ? 'disabled' : ''}>用 ${cost} 粉塵合成${focus.hero ? '這個英雄' : '一張'}</button>
      ${why ? `<p class="d-line">${why}</p>` : ''}
      <button class="ghost focus-close" data-do="focus-close">關閉</button></div>`;
  }

  const canBuy = profile.gold >= ECONOMY.packPrice;
  const canBuyBatch = profile.gold >= ECONOMY.packPrice * PACK_BATCH;
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
          UR 也可能開到多色的 UR 英雄。已經有 ${DEFAULT_RULES.maxCopies} 張（UR ${DEFAULT_RULES.maxUrCopies} 張、英雄 1 個）的再開到，換成粉塵
          （N ${ECONOMY.dustValue.N}、R ${ECONOMY.dustValue.R}、SR ${ECONOMY.dustValue.SR}、UR ${ECONOMY.dustValue.UR}），粉塵可以合成任意一張卡。</p>
        <p class="vouchers"><span class="dust">粉塵 ${profile.dust}</span></p>
      </div>
      <div class="pack-buttons">
        <button class="primary big" data-do="open-pack" ${canBuy && !shop.busy ? '' : 'disabled'}>${shop.busy ? '開卡包中……' : canBuy ? '開一包' : `金幣不夠（${profile.gold}/${ECONOMY.packPrice}）`}</button>
        <button class="ghost big" data-do="open-packs" ${canBuyBatch && !shop.busy ? '' : 'disabled'}>開 ${PACK_BATCH} 包（${ECONOMY.packPrice * PACK_BATCH} 金幣）</button>
      </div>
    </section>
    ${topupBar(canTopup, shop.busy)}
    ${toast ? `<p class="toast" role="alert">${esc(toast)}</p>` : ''}
    ${shop.notice ? `<p class="notice" role="status">${esc(shop.notice)}</p>` : ''}
    ${shop.opened ? packRow(db, profile, shop.opened, shop.dealing) : ''}
    <div class="b-body">
      <section class="b-pool" aria-label="收藏">
        <div class="chips">${rarityChips}</div>
        <div class="chips">${colorChips}</div>
        <div class="chips">${costChips}${chip('data-missing', String(!shop.missing), '只看沒收齊的', shop.missing)}</div>
        <div class="pool">${grid || '<p class="d-line">沒有符合的卡。</p>'}</div>
      </section>
      ${focus ? '<div class="shop-backdrop" data-do="focus-close"></div>' : ''}
      <aside class="b-side">
        <div class="detail${focus ? ' has-focus' : ''}">${focusBox}</div>
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
  const { focus, rarity, color, cost, missing, craft: craftId, topup } = el.dataset;
  host.toast = null;
  host.shop.dealing = false;
  host.shop.notice = null;
  if (focus) {
    host.shop.focus = host.shop.focus === focus ? null : focus;
  } else if (command === 'focus-close') {
    host.shop.focus = null;
  } else if (topup && backend.topup && !host.shop.busy) {
    // 建立訂單後，用表單把頁面送去綠界付款。
    host.shop.busy = true;
    backend.topup(topup).then(
      (checkout) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = checkout.action;
        for (const [name, value] of Object.entries(checkout.fields)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      },
      (error: unknown) => {
        host.shop.busy = false;
        host.toast = error instanceof Error ? error.message : '儲值失敗';
        rerender();
      },
    );
  } else if (rarity) {
    host.shop.rarity = rarity as Shop['rarity'];
  } else if (color) {
    host.shop.color = color as ColorFilter;
  } else if (cost) {
    host.shop.cost = cost === 'all' ? 'all' : Number(cost);
  } else if (missing) {
    host.shop.missing = missing === 'true';
  } else if ((command === 'open-pack' || command === 'open-packs' || craftId) && !host.shop.busy) {
    host.shop.busy = true;
    const done = () => {
      host.shop.busy = false;
      rerender();
    };
    if (command === 'open-pack' || command === 'open-packs') {
      void backend.openPack(host.profile, command === 'open-packs' ? PACK_BATCH : 1).then((opened) => {
        if (opened.ok) {
          host.profile = opened.profile;
          host.shop.opened = opened.cards;
          host.shop.dealing = true;
          host.shop.focus = null;
        } else host.toast = opened.reason;
        done();
      });
    } else {
      const cardId = craftId!;
      void backend.craft(host.profile, cardId).then((crafted) => {
        if (crafted.ok) {
          host.profile = crafted.profile;
          const hero = db.heroes.get(cardId);
          host.shop.notice = hero ? `合成了英雄 ${hero.name}，開局時可以選了` : `合成了 ${db.cards.get(cardId)!.name}（現在 ${host.profile.collection[cardId]} 張）`;
        } else host.toast = crafted.reason;
        done();
      });
    }
  } else {
    return false;
  }
  return true;
}

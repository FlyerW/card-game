import { DEFAULT_RULES, type CardDb } from '@card-game/engine';

// 牌組清單：同一個英雄可以存很多副牌組，每個英雄記住開局要用哪一副（沒選就用收藏自動組一副）。
// 網頁（測試帳號存在瀏覽器）與伺服器（名字＋密碼、Google 帳號）共用這個格式與檢查。

export interface SavedDeck {
  id: string;
  name: string;
  heroId: string;
  /** 卡的 id；可以還沒組滿，開局時才檢查合不合法、收藏夠不夠。 */
  cards: string[];
}

export interface DeckBook {
  decks: SavedDeck[];
  /** 英雄 id → 開局要用的牌組 id。 */
  selected: Record<string, string>;
}

/** 一個帳號最多存幾副牌組、牌組名字最長幾個字。 */
export const DECK_LIMIT = 40;
export const DECK_NAME_LIMIT = 20;

export const emptyBook = (): DeckBook => ({ decks: [], selected: {} });

/** 新牌組的編號。 */
export const newDeckId = () => `d${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, '0')}`;

const cleanName = (name: unknown, fallback: string) =>
  typeof name === 'string' && name.trim() ? name.trim().slice(0, DECK_NAME_LIMIT) : fallback;

/** 一副牌組讀進來：英雄要存在；不存在的卡、衍生物拿掉；最多 30 張。格式不對就是 null。 */
export function cleanDeck(db: CardDb, raw: unknown): SavedDeck | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Partial<SavedDeck>;
  if (typeof d.id !== 'string' || !/^[a-z0-9]{4,24}$/.test(d.id) || typeof d.heroId !== 'string') return null;
  const hero = db.heroes.get(d.heroId);
  if (!hero || hero.boss || !Array.isArray(d.cards)) return null;
  const cards = d.cards
    .filter((id): id is string => {
      const card = typeof id === 'string' ? db.cards.get(id) : undefined;
      return card !== undefined && !(card.kind === 'creature' && card.token);
    })
    .slice(0, DEFAULT_RULES.deckSize);
  return { id: d.id, name: cleanName(d.name, `${hero.name}的牌組`), heroId: d.heroId, cards };
}

/**
 * 讀回牌組清單。也認得舊格式（英雄 id → 卡片清單，每個英雄一副），
 * 轉成「○○的牌組」並設成那個英雄開局要用的牌組。
 */
export function cleanBook(db: CardDb, raw: unknown): DeckBook {
  if (typeof raw !== 'object' || raw === null) return emptyBook();
  const r = raw as Partial<DeckBook> & Record<string, unknown>;
  if (Array.isArray(r.decks)) {
    const decks = r.decks.map((deck) => cleanDeck(db, deck)).filter((deck): deck is SavedDeck => deck !== null).slice(0, DECK_LIMIT);
    const selected: Record<string, string> = {};
    for (const [heroId, id] of Object.entries(r.selected ?? {})) {
      if (decks.some((deck) => deck.id === id && deck.heroId === heroId)) selected[heroId] = id;
    }
    return { decks, selected };
  }
  // 舊格式：{ 英雄 id: [卡 id…] }
  const book = emptyBook();
  for (const [heroId, cards] of Object.entries(r)) {
    const hero = db.heroes.get(heroId);
    if (!hero || !Array.isArray(cards)) continue;
    const deck = cleanDeck(db, { id: `old${heroId.replace(/[^a-z0-9]/g, '')}`.slice(0, 24), name: `${hero.name}的牌組`, heroId, cards });
    if (!deck) continue;
    book.decks.push(deck);
    book.selected[heroId] = deck.id;
  }
  return book;
}

/** 存一副（新的就加在最後面，舊的換掉）；超過上限回傳 null。 */
export function putDeck(book: DeckBook, deck: SavedDeck): DeckBook | null {
  const exists = book.decks.some((each) => each.id === deck.id);
  if (!exists && book.decks.length >= DECK_LIMIT) return null;
  const decks = exists ? book.decks.map((each) => (each.id === deck.id ? deck : each)) : [...book.decks, deck];
  return { ...book, decks };
}

/** 刪掉一副；如果是某個英雄開局要用的，那個英雄改回自動組牌。 */
export function removeDeck(book: DeckBook, id: string): DeckBook {
  const selected = Object.fromEntries(Object.entries(book.selected).filter(([, each]) => each !== id));
  return { decks: book.decks.filter((deck) => deck.id !== id), selected };
}

/** 選一個英雄開局要用的牌組；null 是用收藏自動組一副。 */
export function selectDeck(book: DeckBook, heroId: string, id: string | null): DeckBook {
  const { [heroId]: _, ...rest } = book.selected;
  if (id === null || !book.decks.some((deck) => deck.id === id && deck.heroId === heroId)) return { ...book, selected: rest };
  return { ...book, selected: { ...rest, [heroId]: id } };
}

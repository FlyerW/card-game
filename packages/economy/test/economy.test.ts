import { describe, expect, it } from 'vitest';
import { copyLimit, DEFAULT_RULES, SAMPLE_HEROES, sampleDb, validateDeck, type GameEvent } from '@card-game/engine';
import {
  ECONOMY,
  emptyTally,
  exchange,
  fullProfile,
  newProfile,
  openPack,
  ownsHero,
  ownedDeck,
  ownershipProblems,
  packableCards,
  parseProfile,
  parseSummary,
  QUESTS,
  questFor,
  recordGame,
  refreshDay,
  seededRandom,
  starterDecks,
  summarizeGame,
  tallyEvents,
  type GameSummary,
  type Profile,
} from '../src';

const db = sampleDb();
const DAY = '2026-09-26';
const fresh = (): Profile => newProfile(DAY, starterDecks(db));
const game = (patch: Partial<GameSummary> = {}): GameSummary => ({ won: false, conceded: false, deckColors: [], summoned: 0, drew: 0, spells: 0, ...patch });
/** 今天的任務換成指定的那個，方便測試。 */
const withQuest = (profile: Profile, id: string): Profile => ({ ...profile, quest: { id, progress: 0, done: false } });

describe('新玩家', () => {
  it('基礎英雄每個人都有，UR 英雄要抽到才有', () => {
    const profile = fresh();
    for (const hero of SAMPLE_HEROES) expect(ownsHero(profile, db, hero.id), hero.name).toBe(hero.rarity === undefined);
    expect(ownsHero({ ...profile, collection: { ...profile.collection, 'prism-sage': 1 } }, db, 'prism-sage')).toBe(true);
  });

  it('收藏裡有每個基礎英雄的起始牌組，所以每個基礎英雄都組得出合法的牌組', () => {
    const profile = fresh();
    for (const hero of SAMPLE_HEROES.filter((each) => each.rarity === undefined)) {
      const deck = ownedDeck(profile, db, DEFAULT_RULES, hero.id, 7);
      expect(validateDeck(db, DEFAULT_RULES, hero.id, deck), hero.name).toEqual([]);
      expect(ownershipProblems(profile, db, deck), hero.name).toEqual([]);
    }
  });

  it('一開始有 100 金幣，剛好開一包；沒有兌換卷', () => {
    const profile = fresh();
    expect(profile.gold).toBe(ECONOMY.packPrice);
    expect(profile.vouchers).toEqual({ N: 0, R: 0, SR: 0, UR: 0 });
  });
});

describe('金幣與每日任務', () => {
  it('贏一場 10 金幣，輸了沒有', () => {
    const profile = withQuest(fresh(), 'draw-15');
    expect(recordGame(profile, game({ won: true }), DAY)).toMatchObject({ winGold: 10, questGold: 0 });
    expect(recordGame(profile, game(), DAY).winGold).toBe(0);
  });

  it('贏場金幣每天最多 100，隔天重新算', () => {
    let profile = withQuest(fresh(), 'draw-15');
    let total = 0;
    for (let i = 0; i < 12; i++) {
      const reward = recordGame(profile, game({ won: true }), DAY);
      total += reward.winGold;
      profile = reward.profile;
    }
    expect(total).toBe(ECONOMY.dailyWinGoldCap);
    expect(recordGame(profile, game({ won: true }), DAY).winGold).toBe(0);
    expect(recordGame(profile, game({ won: true }), '2026-09-27').winGold).toBe(10);
  });

  it('遊玩 3 場：第 3 場完成，拿 50 金幣，之後不會再拿', () => {
    let profile = withQuest(fresh(), 'play-3');
    const gold = profile.gold;
    const rewards = [0, 0, 0, 0].map(() => {
      const reward = recordGame(profile, game(), DAY);
      profile = reward.profile;
      return reward.questGold;
    });
    expect(rewards).toEqual([0, 0, 50, 0]);
    expect(profile.quest).toMatchObject({ progress: 3, done: true });
    expect(profile.gold).toBe(gold + 50);
  });

  it('自己投降的對局不算任務進度', () => {
    const profile = withQuest(fresh(), 'play-3');
    expect(recordGame(profile, game({ conceded: true }), DAY).profile.quest.progress).toBe(0);
    expect(recordGame(profile, game(), DAY).profile.quest.progress).toBe(1);
  });

  it('用有綠色卡的牌組贏：輸了、或牌組沒有綠色都不算', () => {
    const profile = withQuest(fresh(), 'win-green');
    expect(recordGame(profile, game({ won: false, deckColors: ['green'] }), DAY).questGold).toBe(0);
    expect(recordGame(profile, game({ won: true, deckColors: ['red'] }), DAY).questGold).toBe(0);
    expect(recordGame(profile, game({ won: true, deckColors: ['red', 'green'] }), DAY).questGold).toBe(50);
  });

  it('召喚 10 隻、抽 15 張這類任務可以跨好幾場累積', () => {
    let profile = withQuest(fresh(), 'summon-10');
    profile = recordGame(profile, game({ summoned: 6 }), DAY).profile;
    expect(profile.quest.progress).toBe(6);
    const reward = recordGame(profile, game({ summoned: 6 }), DAY);
    expect(reward.questGold).toBe(50);
    expect(reward.profile.quest.progress).toBe(10);
  });

  it('每天一個任務：同一天大家一樣，換日就換成新的、進度歸零', () => {
    expect(questFor(DAY).id).toBe(questFor(DAY).id);
    const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    expect(new Set(days.map((day) => questFor(day).id)).size).toBeGreaterThan(QUESTS.length / 2);

    const profile = recordGame(withQuest(fresh(), 'play-3'), game({ won: true }), DAY).profile;
    const tomorrow = refreshDay(profile, '2026-09-27');
    expect(tomorrow).toMatchObject({ day: '2026-09-27', winGoldToday: 0, quest: { id: questFor('2026-09-27').id, progress: 0, done: false } });
    expect(refreshDay(profile, DAY)).toBe(profile);
  });

  it('從對局事件算出召喚、抽牌、法術；起手抽的不算', () => {
    const events: GameEvent[] = [
      { type: 'drew', player: 0, cards: [{ uid: 1, cardId: 'x' }, { uid: 2, cardId: 'x' }, { uid: 3, cardId: 'x' }, { uid: 4, cardId: 'x' }] },
      { type: 'turnStarted', player: 0, turn: 1 },
      { type: 'drew', player: 0, cards: [{ uid: 5, cardId: 'x' }] },
      { type: 'drew', player: 1, cards: [{ uid: 6, cardId: 'x' }] },
      { type: 'summoned', player: 0, zone: 0, cardId: 'x' },
      { type: 'summoned', player: 0, zone: 1, cardId: 'soldier-token' },
      { type: 'summoned', player: 1, zone: 0, cardId: 'x' },
      { type: 'abilityUsed', player: 0, source: 'spell', cardId: 'x', ability: 'x' },
      { type: 'abilityUsed', player: 0, source: 'creature', cardId: 'x', ability: 'x' },
    ];
    const deck = ['devouring-flame', 'wandering-mercenary'];
    expect(summarizeGame(db, events, 0, deck, 0)).toEqual({ won: true, conceded: false, deckColors: ['red'], summoned: 2, drew: 1, spells: 1 });
    expect(summarizeGame(db, events, 1, deck, 0)).toMatchObject({ won: false, summoned: 1, drew: 1, spells: 0 });
  });

  it('事件分好幾批來也算得一樣：第一個回合開始之後的抽牌都算', () => {
    const batches: GameEvent[][] = [
      [{ type: 'drew', player: 0, cards: [{ uid: 1, cardId: 'x' }] }],
      [{ type: 'turnStarted', player: 0, turn: 1 }],
      [{ type: 'drew', player: 0, cards: [{ uid: 2, cardId: 'x' }, { uid: 3, cardId: 'x' }] }],
    ];
    const tally = batches.reduce((sum, events) => tallyEvents(sum, events, 0), emptyTally());
    expect(tally).toEqual({ started: true, summoned: 0, drew: 2, spells: 0 });
  });
});

describe('卡包', () => {
  it('一包 100 金幣、5 張；金幣不夠不能買', () => {
    const opened = openPack(fresh(), db, DEFAULT_RULES, seededRandom(1));
    if (!opened.ok) throw new Error(opened.reason);
    expect(opened.cards).toHaveLength(ECONOMY.packSize);
    expect(opened.profile.gold).toBe(0);
    expect(openPack(opened.profile, db, DEFAULT_RULES, seededRandom(2))).toMatchObject({ ok: false });
  });

  it('每包至少一張 R 以上；開很多包，各稀有度的比例接近 N 74%、R 20%、SR 5%、UR 1%（保底另外加）', () => {
    const random = seededRandom(42);
    const counts = { N: 0, R: 0, SR: 0, UR: 0 };
    const packs = 4000;
    let profile: Profile = { ...fresh(), gold: packs * ECONOMY.packPrice };
    for (let i = 0; i < packs; i++) {
      const opened = openPack(profile, db, DEFAULT_RULES, random);
      if (!opened.ok) throw new Error(opened.reason);
      expect(opened.cards.some((card) => card.rarity !== 'N')).toBe(true);
      for (const card of opened.cards) counts[card.rarity]++;
      profile = opened.profile;
    }
    const total = packs * ECONOMY.packSize;
    // 5 張全是 N 的機率 0.74^5 ≈ 22%，那一包最後一張換成 R 以上，所以 R 以上會比 26% 多一點。
    expect(counts.UR / total).toBeGreaterThan(0.008);
    expect(counts.UR / total).toBeLessThan(0.016);
    expect(counts.SR / total).toBeGreaterThan(0.045);
    expect(counts.SR / total).toBeLessThan(0.07);
    expect(counts.R / total).toBeGreaterThan(0.19);
    expect(counts.R / total).toBeLessThan(0.25);
  });

  it('開到的卡跟稀有度對得上，而且不會開到衍生物', () => {
    const random = seededRandom(5);
    let profile: Profile = { ...fresh(), gold: 50 * ECONOMY.packPrice };
    for (let i = 0; i < 50; i++) {
      const opened = openPack(profile, db, DEFAULT_RULES, random);
      if (!opened.ok) throw new Error(opened.reason);
      for (const card of opened.cards) {
        if (card.hero) {
          expect(db.heroes.get(card.cardId)!.rarity).toBe('UR');
          continue;
        }
        const def = db.cards.get(card.cardId)!;
        expect(def.rarity).toBe(card.rarity);
        expect(def.kind === 'creature' && def.token).toBeFalsy();
      }
      profile = opened.profile;
    }
  });

  it('已經有 2 張（UR 1 張）的卡再開到，換成一張同稀有度的兌換卷，收藏不會超過上限', () => {
    const random = seededRandom(9);
    const full: Record<string, number> = {};
    for (const card of packableCards(db)) full[card.id] = copyLimit(DEFAULT_RULES, card);
    let profile: Profile = { ...fresh(), gold: 20 * ECONOMY.packPrice, collection: full };
    let duplicates = 0;
    for (let i = 0; i < 20; i++) {
      const opened = openPack(profile, db, DEFAULT_RULES, random);
      if (!opened.ok) throw new Error(opened.reason);
      expect(opened.cards.every((card) => card.duplicate)).toBe(true);
      duplicates += opened.cards.length;
      profile = opened.profile;
    }
    expect(profile.collection).toEqual(full);
    expect(Object.values(profile.vouchers).reduce((a, b) => a + b, 0)).toBe(duplicates);
  });
});

describe('UR 英雄', () => {
  it('卡包開得到；已經有了再開到換成 UR 兌換卷', () => {
    const random = seededRandom(3);
    let profile: Profile = { ...fresh(), gold: 3000 * ECONOMY.packPrice };
    const heroes = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const opened = openPack(profile, db, DEFAULT_RULES, random);
      if (!opened.ok) throw new Error(opened.reason);
      for (const card of opened.cards) if (card.hero) heroes.set(card.cardId, (heroes.get(card.cardId) ?? 0) + 1);
      profile = opened.profile;
    }
    const urHeroes = SAMPLE_HEROES.filter((hero) => hero.rarity === 'UR');
    expect([...heroes.keys()].sort()).toEqual(urHeroes.map((hero) => hero.id).sort());
    for (const hero of urHeroes) expect(profile.collection[hero.id]).toBe(1);
  });

  it('3 張 UR 兌換卷換一個英雄；有了就不能再換', () => {
    const profile: Profile = { ...fresh(), vouchers: { N: 0, R: 0, SR: 0, UR: 6 } };
    const swapped = exchange(profile, db, DEFAULT_RULES, 'tide-shadow-twins');
    if (!swapped.ok) throw new Error(swapped.reason);
    expect(ownsHero(swapped.profile, db, 'tide-shadow-twins')).toBe(true);
    expect(exchange(swapped.profile, db, DEFAULT_RULES, 'tide-shadow-twins')).toMatchObject({ ok: false });
    expect(exchange(profile, db, DEFAULT_RULES, 'flame-lord')).toMatchObject({ ok: false }); // 基礎英雄不用換
  });
});

describe('兌換卷', () => {
  const sr = packableCards(db).find((card) => card.rarity === 'SR')!;
  const ur = packableCards(db).find((card) => card.rarity === 'UR')!;

  it('3 張同稀有度的兌換卷換一張那個稀有度的任意卡', () => {
    const profile: Profile = { ...fresh(), collection: {}, vouchers: { N: 0, R: 0, SR: 4, UR: 0 } };
    const swapped = exchange(profile, db, DEFAULT_RULES, sr.id);
    if (!swapped.ok) throw new Error(swapped.reason);
    expect(swapped.profile.collection[sr.id]).toBe(1);
    expect(swapped.profile.vouchers.SR).toBe(1);
  });

  it('兌換卷不夠、稀有度不同、已經有滿的都不能換', () => {
    const profile: Profile = { ...fresh(), collection: { [ur.id]: 1 }, vouchers: { N: 0, R: 0, SR: 2, UR: 9 } };
    expect(exchange(profile, db, DEFAULT_RULES, sr.id)).toMatchObject({ ok: false });
    expect(exchange(profile, db, DEFAULT_RULES, ur.id)).toMatchObject({ ok: false });
    expect(exchange(profile, db, DEFAULT_RULES, 'soldier-token')).toMatchObject({ ok: false });
  });
});

describe('收藏與牌組', () => {
  it('牌組放的張數超過擁有的，會列出來', () => {
    const profile: Profile = { ...fresh(), collection: { 'devouring-flame': 1 } };
    expect(ownershipProblems(profile, db, ['devouring-flame', 'devouring-flame', 'wandering-mercenary'])).toHaveLength(2);
  });

  it('只用收藏組牌時，每張卡的張數不超過擁有的', () => {
    const profile = fresh();
    const hero = SAMPLE_HEROES[0]!;
    for (let seed = 0; seed < 20; seed++) expect(ownershipProblems(profile, db, ownedDeck(profile, db, DEFAULT_RULES, hero.id, seed))).toEqual([]);
  });

  it('存檔讀回來格式不對就不用', () => {
    const profile = fresh();
    expect(parseProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile({ ...profile, version: 2 })).toBeNull();
    expect(parseProfile({ ...profile, gold: 'lots' })).toBeNull();
    expect(parseProfile({ ...profile, collection: { x: -1 } })).toBeNull();
  });
});

describe('測試帳號與伺服器', () => {
  it('測試帳號每張卡都收滿、UR 英雄都有，有 10000 金幣', () => {
    const profile = fullProfile(db, DEFAULT_RULES, DAY);
    expect(profile.gold).toBe(10000);
    for (const card of packableCards(db)) expect(profile.collection[card.id], card.id).toBe(copyLimit(DEFAULT_RULES, card));
    for (const hero of SAMPLE_HEROES) expect(ownsHero(profile, db, hero.id), hero.name).toBe(true);
    for (const hero of SAMPLE_HEROES) expect(ownershipProblems(profile, db, ownedDeck(profile, db, DEFAULT_RULES, hero.id, 3))).toEqual([]);
  });

  it('瀏覽器回報的對局數字：格式不對不收，數字壓在範圍內，不認得的顏色拿掉', () => {
    expect(parseSummary({ won: true, conceded: false, deckColors: ['red', 'pink'], summoned: 9999, drew: -3, spells: 2.7 })).toEqual({
      won: true, conceded: false, deckColors: ['red'], summoned: 200, drew: 0, spells: 2,
    });
    expect(parseSummary({ won: 'yes', conceded: false, deckColors: [], summoned: 1, drew: 1, spells: 1 })).toBeNull();
    expect(parseSummary(null)).toBeNull();
  });
});

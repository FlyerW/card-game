import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngine, deckPool, sampleDb, SAMPLE_HEROES } from '@card-game/engine';
import { ECONOMY } from '@card-game/economy';
import { buildDeck } from '@card-game/sim/deck';
import { GameLog, type GameRecord } from '../src/gamelog';
import { Lobby, type Client } from '../src/lobby';
import { startServer, type Running } from '../src/server';

// 牌組存在伺服器、一次開 10 包、對局紀錄。

const db = sampleDb();
const [white, blue] = [SAMPLE_HEROES[0]!.id, SAMPLE_HEROES[1]!.id];
const deckFor = (heroId: string, seed = 1) => buildDeck(seed, heroId, deckPool(db, heroId));

describe('伺服器上的牌組、卡包與對局紀錄', () => {
  let running: Running;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'card-game-records-'));
    running = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir });
    base = `http://127.0.0.1:${running.port}`;
  });
  afterAll(async () => {
    await running.close();
    await rm(dir, { recursive: true, force: true });
  });

  const call = async (path: string, init: { token?: string; body?: unknown } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  };
  const signUp = async (name: string) => (await call('/api/login/password', { body: { name, password: 'secret-123', create: true } })).json.token as string;

  it('冒險模式：打過一關第一次給 100 金幣，之後不再給；還沒解鎖的關卡不收', async () => {
    const token = await signUp('冒險的人');
    const gold = async () => (await call('/api/me', { token })).json.profile.gold as number;
    const before = await gold();
    const clear = (stage: string, difficulty: string) => call('/api/adventure/clear', { token, body: { stage, difficulty } });
    expect((await clear('tide-cave', 'normal')).status).toBe(400); // 第二關還沒解鎖
    const first = await clear('mist-forest', 'normal');
    expect(first.status).toBe(200);
    expect(first.json.gold).toBe(100);
    expect((await clear('mist-forest', 'nightmare')).json.gold).toBe(0);
    expect((await clear('mist-forest', 'bogus')).status).toBe(400);
    expect(await gold()).toBe(before + 100);
    expect((await call('/api/me', { token })).json.profile.adventure).toEqual({ 'mist-forest': ['normal', 'nightmare'] });
    expect((await clear('tide-cave', 'hard')).status).toBe(200);
  });

  it('牌組清單存在帳號上：同一個英雄存很多副、選開局用哪一副、刪掉；/api/me 帶回來', async () => {
    const token = await signUp('組牌的人');
    const cards = deckFor(white);
    const save = (deck: unknown) => call('/api/decks/save', { token, body: { deck } });
    expect((await save({ id: 'aggro1', name: '快攻', heroId: white, cards })).status).toBe(200);
    expect((await save({ id: 'ctrl1', name: '控場', heroId: white, cards: cards.slice(0, 10) })).status).toBe(200);
    expect((await call('/api/decks/select', { token, body: { heroId: white, id: 'ctrl1' } })).status).toBe(200);
    let book = (await call('/api/me', { token })).json.deckBook;
    expect(book.decks.map((deck: { name: string }) => deck.name)).toEqual(['快攻', '控場']);
    expect(book.selected).toEqual({ [white]: 'ctrl1' });
    // 不存在的英雄、格式不對的不收；不存在的卡直接拿掉
    expect((await save({ id: 'bad1', name: 'x', heroId: 'nobody', cards })).status).toBe(400);
    expect((await save({ id: 'bad 1', name: 'x', heroId: white, cards })).status).toBe(400);
    await save({ id: 'aggro1', name: '快攻', heroId: white, cards: ['no-such-card', ...cards.slice(0, 5)] });
    await call('/api/decks/delete', { token, body: { id: 'ctrl1' } });
    book = (await call('/api/me', { token })).json.deckBook;
    expect(book.decks).toHaveLength(1);
    expect(book.decks[0].cards).toEqual(cards.slice(0, 5));
    expect(book.selected).toEqual({});
  });

  it('一次開 10 包要 1000 金幣；只能開 1 包或 10 包', async () => {
    const token = await signUp('開包的人');
    expect(ECONOMY.startingGold).toBeLessThan(ECONOMY.packPrice * 10);
    const broke = await call('/api/pack', { token, body: { count: 10 } });
    expect(broke.status).toBe(400);
    expect(broke.json.error).toContain('金幣不夠');
    expect((await call('/api/pack', { token, body: { count: 3 } })).status).toBe(400);
  });

  it('跟電腦打的對局紀錄寫進 games.jsonl；格式不對的不記，但照樣領獎', async () => {
    const token = await signUp('打電腦的人');
    const summary = { won: true, conceded: false, deckColors: ['white'], summoned: 3, drew: 5, spells: 1 };
    const record = {
      hero: white, heroEvolution: null, deck: deckFor(white), opponentHero: blue, opponentHeroEvolution: null, opponentDeck: deckFor(blue, 2),
      difficulty: 'hard', first: true, winner: 'you', reason: 'heroDefeated', turns: 14, seconds: 420,
    };
    expect((await call('/api/game', { token, body: { summary, record } })).status).toBe(200);
    expect((await call('/api/game', { token, body: { summary, record: { ...record, hero: 'nobody' } } })).json.winGold).toBe(ECONOMY.winGold);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const games = await GameLog.read(join(dir, 'games.jsonl'));
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ mode: 'bot', winner: 0, firstPlayer: 0, turns: 14, seconds: 420 });
    expect(games[0]!.players[1]).toMatchObject({ hero: blue, bot: 'hard', account: null });
  });
});

describe('連線對戰的對局紀錄', () => {
  it('打完一局（投降也算）由伺服器記下雙方的英雄、牌組與勝負', async () => {
    const records: GameRecord[] = [];
    const log = { add: async (record: GameRecord) => void records.push(record) } as unknown as GameLog;
    let now = 1_000_000;
    const lobby = new Lobby(createEngine(db), () => 0.5, () => now, null, log);
    let code = '';
    const host: Client = { send: (message) => void (message.t === 'room' && (code = message.code)) };
    const guest: Client = { send: () => undefined };
    lobby.handle(host, { t: 'create', name: 'x', heroId: white, deck: deckFor(white) });
    lobby.handle(guest, { t: 'join', code, name: 'y', heroId: blue, deck: deckFor(blue, 2) });
    now += 90_000;
    lobby.handle(guest, { t: 'act', action: { type: 'concede', player: 1 } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ mode: 'friendly', winner: 0, reason: 'concede', seconds: 90 });
    expect(records[0]!.players.map((player) => player.hero)).toEqual([white, blue]);
  });
});

describe('舊的牌組存檔', () => {
  it('每個英雄一副的舊格式，讀進來轉成牌組清單', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { AccountStore } = await import('../src/accounts');
    const { newProfile } = await import('@card-game/economy');
    const dir = await mkdtemp(join(tmpdir(), 'card-game-olddecks-'));
    const account = {
      id: 'guest:old', name: '老玩家', email: null, picture: null, createdAt: '2026-09-01T00:00:00.000Z',
      profile: newProfile('2026-09-27', []), decks: { [white]: deckFor(white) },
    };
    await writeFile(join(dir, 'accounts.json'), JSON.stringify({ accounts: { [account.id]: account }, sessions: {} }));
    const store = await AccountStore.open(dir, db);
    const book = store.byId('guest:old')!.deckBook!;
    expect(book.decks).toHaveLength(1);
    expect(book.decks[0]).toMatchObject({ heroId: white, cards: deckFor(white) });
    expect(book.selected[white]).toBe(book.decks[0]!.id);
    await rm(dir, { recursive: true, force: true });
  });
});

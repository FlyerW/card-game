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

  it('牌組存在帳號上：/api/me 帶回來，可以刪掉；不存在的卡或太多張不收', async () => {
    const token = await signUp('組牌的人');
    const deck = deckFor(white);
    expect((await call('/api/decks', { token, body: { heroId: white, deck } })).status).toBe(200);
    expect((await call('/api/me', { token })).json.decks).toEqual({ [white]: deck });
    expect((await call('/api/decks', { token, body: { heroId: white, deck: ['no-such-card'] } })).status).toBe(400);
    expect((await call('/api/decks', { token, body: { heroId: white, deck: [...deck, ...deck] } })).status).toBe(400);
    expect((await call('/api/decks', { token, body: { heroId: 'nobody', deck } })).status).toBe(400);
    await call('/api/decks', { token, body: { heroId: white, deck: null } });
    expect((await call('/api/me', { token })).json.decks).toEqual({});
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

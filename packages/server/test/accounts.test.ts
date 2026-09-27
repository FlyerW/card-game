import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, sampleDb } from '@card-game/engine';
import { ECONOMY, packItems, UNLIMITED_GOLD } from '@card-game/economy';
import { AccountStore } from '../src/accounts';
import { googleVerifier, TokenError, verifyIdToken, type Jwk } from '../src/google';
import { startServer, type Running } from '../src/server';

// 用自己產生的金鑰簽 token，模擬 Google。
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEYS: Jwk[] = [{ ...(publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', alg: 'RS256', use: 'sig' }];
const CLIENT = 'test-client.apps.googleusercontent.com';
const NOW = 1_800_000_000;

function sign(payload: Record<string, unknown>, kid = 'k1'): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = `${part({ alg: 'RS256', kid, typ: 'JWT' })}.${part(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(head);
  return `${head}.${signer.sign(privateKey).toString('base64url')}`;
}

const good = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234', email: 'a@example.com', name: '小明', exp: NOW + 600 };

describe('Google ID token', () => {
  it('簽章、發給誰、誰發的、過期了沒都對，才拿得到帳號', () => {
    expect(verifyIdToken(sign(good), CLIENT, KEYS, NOW)).toEqual({ sub: '1234', email: 'a@example.com', name: '小明', picture: null });
  });

  it('發給別的程式、不是 Google 發的、過期、簽章被改過、不認得的金鑰，都不收', () => {
    const bad = (token: string) => () => verifyIdToken(token, CLIENT, KEYS, NOW);
    expect(bad(sign({ ...good, aud: 'other' }))).toThrow(TokenError);
    expect(bad(sign({ ...good, iss: 'https://evil.example' }))).toThrow(TokenError);
    expect(bad(sign({ ...good, exp: NOW - 3600 }))).toThrow('過期');
    const [head, , signature] = sign(good).split('.');
    const forged = `${head}.${Buffer.from(JSON.stringify({ ...good, sub: '9999' })).toString('base64url')}.${signature}`;
    expect(bad(forged)).toThrow('簽章不對');
    expect(bad(sign(good, 'k2'))).toThrow(TokenError);
    expect(bad('not-a-token')).toThrow(TokenError);
  });

  it('遇到不認得的金鑰會重抓一次（Google 換了金鑰）', async () => {
    let fetched = 0;
    const verify = googleVerifier(CLIENT, async () => {
      fetched++;
      return { keys: fetched === 1 ? [] : KEYS, maxAge: 3600 };
    });
    await expect(verify(sign({ ...good, exp: Date.now() / 1000 + 600 }))).resolves.toMatchObject({ sub: '1234' });
    expect(fetched).toBe(2);
  });
});

describe('帳號資料', () => {
  it('第一次登入開新帳號，再登入是同一個；資料存檔後讀得回來', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'card-game-'));
    try {
      const store = await AccountStore.open(dir, sampleDb());
      const first = await store.login({ sub: '1', email: 'a@example.com', name: '小明', picture: null });
      expect(first.account.profile.gold).toBe(ECONOMY.startingGold);
      await store.update(first.account, { ...first.account.profile, gold: 777 });
      const again = await store.login({ sub: '1', email: 'a@example.com', name: '小明', picture: null });
      expect(again.account.id).toBe(first.account.id);
      expect(again.token).not.toBe(first.token);

      const reopened = await AccountStore.open(dir, sampleDb());
      expect(reopened.byToken(first.token)?.profile.gold).toBe(777);
      await reopened.logout(first.token);
      expect(reopened.byToken(first.token)).toBeNull();
      expect(reopened.byToken(again.token)?.id).toBe('google:1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('超級帳號（帳號檔裡 unlimited: true）：讀進來就全卡、金幣補滿，花掉會再補回來', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'card-game-'));
    try {
      const db = sampleDb();
      const store = await AccountStore.open(dir, db);
      const { token, account } = await store.login({ sub: '9', email: null, name: '管理員', picture: null });
      await store.update(account, { ...account.profile, gold: 0 });
      // 管理指令只改帳號檔：模擬它把旗標寫進去
      const file = join(dir, 'accounts.json');
      const data = JSON.parse(await readFile(file, 'utf8'));
      data.accounts['google:9'].unlimited = true;
      await writeFile(file, JSON.stringify(data));

      const reopened = await AccountStore.open(dir, db);
      const hero = reopened.byToken(token)!;
      expect(hero.profile.gold).toBe(UNLIMITED_GOLD);
      for (const item of packItems(db, DEFAULT_RULES)) expect(hero.profile.collection[item.id]).toBe(item.limit);
      await reopened.update(hero, { ...hero.profile, gold: hero.profile.gold - 100 });
      expect(reopened.byToken(token)!.profile.gold).toBe(UNLIMITED_GOLD);
      // 一般帳號不受影響
      const normal = await reopened.login({ sub: '10', email: null, name: '路人', picture: null });
      expect(normal.account.profile.gold).toBe(ECONOMY.startingGold);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('超級帳號看得到還沒發布的卡包：開得到第二彈、牌組放得進第二彈的卡；一般帳號不行', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'card-game-'));
    try {
      const store = await AccountStore.open(dir, sampleDb());
      const admin = await store.login({ sub: 'admin', email: null, name: '管理員', picture: null });
      const normal = await store.login({ sub: 'normal', email: null, name: '路人', picture: null });
      const file = join(dir, 'accounts.json');
      const data = JSON.parse(await readFile(file, 'utf8'));
      data.accounts['google:admin'].unlimited = true;
      await writeFile(file, JSON.stringify(data));

      const running = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir });
      try {
        const call = async (token: string, path: string, body?: unknown) => {
          const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          return { status: response.status, json: (await response.json()) as Record<string, any> };
        };
        const me = await call(admin.token, '/api/me');
        expect(me.json.account.preview).toBe(true);
        expect(me.json.profile.collection['white-wyrmling']).toBeGreaterThan(0); // 全卡也包括第二彈
        expect((await call(normal.token, '/api/me')).json.account.preview).toBeUndefined();

        const pack = (token: string) => call(token, '/api/pack', { count: 1, set: 'awakening' });
        expect((await pack(admin.token)).status).toBe(200);
        expect((await pack(normal.token)).status).toBe(400);

        const deck = { id: 'dragons', name: '龍', heroId: 'nameless-swordsman', cards: ['white-wyrmling', 'squire'] };
        await call(admin.token, '/api/decks/save', { deck });
        await call(normal.token, '/api/decks/save', { deck });
        expect((await call(admin.token, '/api/me')).json.deckBook.decks[0].cards).toEqual(['white-wyrmling', 'squire']);
        expect((await call(normal.token, '/api/me')).json.deckBook.decks[0].cards).toEqual(['squire']);
      } finally {
        await running.close();
      }
      // 重開伺服器：超級帳號牌組裡的第二彈卡還在
      const reopened = await AccountStore.open(dir, sampleDb(), sampleDb(true));
      expect(reopened.byToken(admin.token)!.deckBook!.decks[0]!.cards).toContain('white-wyrmling');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('session 過期就找不到', async () => {
    const store = await AccountStore.open(null, sampleDb());
    const { token } = await store.login({ sub: '1', email: null, name: null, picture: null }, 0);
    expect(store.byToken(token, 1000)?.name).toBe('玩家');
    expect(store.byToken(token, 31 * 24 * 3600 * 1000)).toBeNull();
  });
});

describe('帳號 API', () => {
  let running: Running;
  let base: string;

  beforeAll(async () => {
    running = await startServer({
      port: 0,
      host: '127.0.0.1',
      googleClientId: CLIENT,
      verify: async (credential) => {
        if (credential !== 'ok') throw new TokenError('簽章不對');
        return { sub: '42', email: 'b@example.com', name: '阿華', picture: null };
      },
    });
    base = `http://127.0.0.1:${running.port}`;
  });
  afterAll(() => running.close());

  const call = async (path: string, init: { token?: string; body?: unknown } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  };

  it('告訴網頁能不能用 Google 登入', async () => {
    expect((await call('/api/config')).json).toEqual({ googleClientId: CLIENT, topup: false });
  });

  it('登入 → 看自己的資料 → 開卡包 → 回報對局 → 登出', async () => {
    expect((await call('/api/login/google', { body: { credential: 'bad' } })).status).toBe(401);
    const login = await call('/api/login/google', { body: { credential: 'ok' } });
    expect(login.status).toBe(200);
    const token: string = login.json.token;
    expect(login.json.account).toMatchObject({ id: 'google:42', name: '阿華' });

    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/me', { token })).json.profile.gold).toBe(ECONOMY.startingGold);

    const pack = await call('/api/pack', { token, body: {} });
    expect(pack.status).toBe(200);
    expect(pack.json.cards).toHaveLength(ECONOMY.packSize);
    expect(pack.json.profile.gold).toBe(ECONOMY.startingGold - ECONOMY.packPrice);
    const broke = await call('/api/pack', { token, body: {} });
    expect(broke.status).toBe(400);
    expect(broke.json.error).toContain('金幣不夠');

    const summary = { won: true, conceded: false, deckColors: ['red'], summoned: 3, drew: 5, spells: 1 };
    const game = await call('/api/game', { token, body: { summary } });
    expect(game.json.winGold).toBe(ECONOMY.winGold);
    expect((await call('/api/game', { token, body: { summary: { won: 'yes' } } })).status).toBe(400);

    await call('/api/logout', { token, body: {} });
    expect((await call('/api/me', { token })).status).toBe(401);
  });

  it('網頁上帶著 Google client id', async () => {
    const response = await fetch(`${base}/`);
    // 測試環境不一定有打包好的網頁；有的話檢查旗標。
    if (response.status === 200) expect(await response.text()).toContain(`CARD_GAME_GOOGLE_CLIENT_ID = "${CLIENT}"`);
  });
});

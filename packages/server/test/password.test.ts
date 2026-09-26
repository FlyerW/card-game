import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sampleDb } from '@card-game/engine';
import { newProfile, starterDecks } from '@card-game/economy';
import { AccountError, AccountStore } from '../src/accounts';

const db = sampleDb();

describe('名字＋密碼帳號', () => {
  it('開帳號、登出後用同樣的名字與密碼登回同一個帳號；密碼錯、名字重複都不行', async () => {
    const store = await AccountStore.open(null, db);
    const first = await store.loginWithPassword('Flyer', 'secret', true);
    await store.logout(first.token);
    const again = await store.loginWithPassword('flyer', 'secret', false);
    expect(again.account.id).toBe(first.account.id);
    await expect(store.loginWithPassword('Flyer', 'wrong', false)).rejects.toThrow('名字或密碼不對');
    await expect(store.loginWithPassword('Flyer', 'secret', true)).rejects.toThrow('已經有人用了');
    await expect(store.loginWithPassword('Nobody', 'secret', false)).rejects.toThrow('沒有這個帳號');
    await expect(store.loginWithPassword('短', '123', true)).rejects.toBeInstanceOf(AccountError);
  });

  it('密碼不存明文', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'card-game-'));
    try {
      const store = await AccountStore.open(dir, db);
      await store.loginWithPassword('小安', 'my-secret-pw', true);
      const text = await readFile(join(dir, 'accounts.json'), 'utf8');
      expect(text).not.toContain('my-secret-pw');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('舊的訪客帳號（沒有密碼）：第一次用那個名字登入就認領，同名的全部合併，抽到的卡加在一起', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'card-game-'));
    try {
      const base = newProfile('2026-09-26', starterDecks(db));
      const legacy = (id: string, extra: Record<string, number>, gold: number, ur: number) => ({
        id,
        name: 'Flyer',
        email: null,
        picture: null,
        createdAt: '2026-09-26T00:00:00.000Z',
        profile: {
          ...base,
          gold,
          vouchers: { ...base.vouchers, UR: ur },
          collection: Object.fromEntries(
            Object.entries({ ...Object.fromEntries(Object.keys(extra).map((k) => [k, 0])), ...base.collection }).map(([k, n]) => [k, n + (extra[k] ?? 0)]),
          ),
        },
      });
      const accounts = {
        'guest:a': legacy('guest:a', { 'ancient-dragon': 1, kraken: 1 }, 0, 1),
        'guest:b': legacy('guest:b', { kraken: 1 }, 100, 2),
        'guest:c': legacy('guest:c', {}, 0, 0),
      };
      await writeFile(join(dir, 'accounts.json'), JSON.stringify({ accounts, sessions: {} }));
      const store = await AccountStore.open(dir, db);
      const { account } = await store.loginWithPassword('Flyer', 'newpass', false);
      expect(account.profile.collection['ancient-dragon']).toBe((base.collection['ancient-dragon'] ?? 0) + 1);
      expect(account.profile.collection.kraken).toBe(Math.min(2, (base.collection.kraken ?? 0) + 2));
      expect(account.profile.vouchers.UR).toBe(3);
      expect(account.profile.gold).toBe(100);
      // 其他同名的舊帳號併掉了；之後要用密碼登入
      expect(['guest:a', 'guest:b', 'guest:c'].filter((id) => store.byId(id) !== null)).toHaveLength(1);
      await expect(store.loginWithPassword('Flyer', 'other', false)).rejects.toThrow('名字或密碼不對');
      expect((await store.loginWithPassword('Flyer', 'newpass', false)).account.id).toBe(account.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sampleDb } from '@card-game/engine';
import { newProfile, starterDecks } from '@card-game/economy';
import { AccountStore } from '../src/accounts';

const db = sampleDb();

describe('帳號資料庫（SQLite）', () => {
  it('舊的 accounts.json 第一次開時搬進資料庫，原檔改名留著；之後重開資料都在', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'card-game-store-'));
    try {
      const account = { id: 'google:1', name: '老玩家', email: null, picture: null, createdAt: '2026-09-01T00:00:00.000Z', profile: { ...newProfile('2026-09-27', starterDecks(db)), gold: 777 } };
      const order = { tradeNo: 'CG1', accountId: 'google:1', topup: 't', amount: 30, gold: 100, status: 'paid', createdAt: '2026-09-01T00:00:00.000Z' };
      await writeFile(join(dir, 'accounts.json'), JSON.stringify({ accounts: { [account.id]: account }, sessions: {}, orders: { CG1: order } }));
      const store = await AccountStore.open(dir, db);
      expect(store.byId('google:1')!.profile.gold).toBe(777);
      expect(store.order('CG1')!.status).toBe('paid');
      expect(existsSync(join(dir, 'accounts.json'))).toBe(false);
      expect((await readdir(dir)).some((name) => /^accounts\.migrated-\d{8}-\d{4}\.json$/.test(name))).toBe(true);
      // 改一個帳號只寫那一列；重開之後讀得回來，登入的 session 也還在
      const { token, account: fresh } = await store.login({ sub: '2', email: null, name: '新玩家', picture: null });
      await store.update(fresh, { ...fresh.profile, gold: 5 });
      store.close();
      const reopened = await AccountStore.open(dir, db);
      expect(reopened.byToken(token)!.profile.gold).toBe(5);
      expect(reopened.byId('google:1')!.profile.gold).toBe(777);
      reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('每天備份一份到 data/backups，當天已經有就不再做', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'card-game-backup-'));
    try {
      const store = await AccountStore.open(dir, db);
      await store.login({ sub: '1', email: null, name: '玩家', picture: null });
      const day = new Date(2026, 8, 30, 12, 0);
      const file = await store.dailyBackup(day);
      expect(file).toMatch(/accounts-20260930\.sqlite$/);
      expect(await store.dailyBackup(day)).toBeNull();
      store.close();
      // 備份檔本身就是一個完整的資料庫：改名成 accounts.sqlite 放進資料夾就能還原
      const restore = join(dir, 'restore');
      await mkdir(restore);
      await copyFile(file!, join(restore, 'accounts.sqlite'));
      const restored = await AccountStore.open(restore, db);
      expect(restored.allAccounts().map((account) => account.name)).toEqual(['玩家']);
      restored.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

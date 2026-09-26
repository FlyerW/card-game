import { describe, expect, it } from 'vitest';
import { createEngine, deckPool, sampleDb, SAMPLE_HEROES } from '@card-game/engine';
import { buildDeck } from '@card-game/sim/deck';
import { AccountStore } from '../src/accounts';
import { FORFEIT_MS, Lobby, type Client, type RankedHooks } from '../src/lobby';
import type { ServerMessage } from '../src/protocol';

const engine = createEngine(sampleDb());
const hero = SAMPLE_HEROES[0]!.id;
const deck = buildDeck(1, hero, deckPool(engine.db, hero));

function fakeClient() {
  const inbox: ServerMessage[] = [];
  const client: Client = { send: (message) => inbox.push(structuredClone(message)) };
  const last = <T extends ServerMessage['t']>(t: T) => [...inbox].reverse().find((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  return { client, inbox, last };
}

/** 假的帳號：token 就是帳號 id，隱藏分數照表。 */
function fakeHooks(mmr: Record<string, number>) {
  const reported: Parameters<RankedHooks['report']>[0][] = [];
  const hooks: RankedHooks = {
    authenticate: (token) => (token in mmr ? { id: token, name: token, mmr: mmr[token]!, ownershipProblem: () => null } : null),
    report: async (players) => {
      reported.push(players);
      const report = (won: boolean) => ({
        won,
        before: { season: 's', tier: 0, stars: 0, mmr: 1000, wins: 0, losses: 0, streak: 0, best: 0 },
        after: { season: 's', tier: 0, stars: won ? 1 : 0, mmr: 1000, wins: 0, losses: 0, streak: 0, best: 0 },
        starsDelta: won ? 1 : 0,
        promoted: false,
        demoted: false,
        reward: { profile: {} as never, winGold: won ? 10 : 0, questGold: 0 },
      });
      return [report(players[0].summary.won), report(players[1].summary.won)];
    },
  };
  return { hooks, reported };
}

describe('排位賽', () => {
  it('兩個人排隊就配對開局；一方投降，結果由伺服器記下，雙方都收到', async () => {
    const { hooks, reported } = fakeHooks({ ann: 1000, bob: 1050 });
    const lobby = new Lobby(engine, Math.random, Date.now, hooks);
    const [a, b] = [fakeClient(), fakeClient()];
    lobby.handle(a.client, { t: 'queue', token: 'ann', heroId: hero, deck });
    expect(a.last('queued')).toMatchObject({ waiting: 1 });
    lobby.handle(b.client, { t: 'queue', token: 'bob', heroId: hero, deck });
    expect(lobby.queueSize).toBe(0);
    expect(a.last('room')).toMatchObject({ ranked: true });
    expect(b.last('state')).toBeDefined();

    lobby.handle(a.client, { t: 'act', action: { type: 'concede', player: a.last('room')!.seat } });
    await Promise.resolve();
    await Promise.resolve();
    expect(reported).toHaveLength(1);
    const winner = reported[0]!.find((p) => p.summary.won)!;
    expect(winner.id).toBe('bob');
    expect(a.last('ranked')!.report.won).toBe(false);
    expect(b.last('ranked')!.report.won).toBe(true);
    // 排位賽不能再來一局
    lobby.handle(b.client, { t: 'rematch' });
    expect(b.last('error')!.message).toContain('排位賽不能再來一局');
  });

  it('沒登入不能排；分數差太多先不配，等久了就配', () => {
    let now = 0;
    const { hooks } = fakeHooks({ low: 800, high: 1400 });
    const lobby = new Lobby(engine, Math.random, () => now, hooks);
    const [a, b, c] = [fakeClient(), fakeClient(), fakeClient()];
    lobby.handle(c.client, { t: 'queue', token: 'nobody', heroId: hero, deck });
    expect(c.last('error')!.message).toContain('登入');
    lobby.handle(a.client, { t: 'queue', token: 'low', heroId: hero, deck });
    lobby.handle(b.client, { t: 'queue', token: 'high', heroId: hero, deck });
    expect(lobby.queueSize).toBe(2);
    now = 31_000;
    lobby.tick();
    expect(lobby.queueSize).toBe(0);
    expect(a.last('room')?.ranked).toBe(true);
  });

  it('取消排隊、斷線都會離開隊伍', () => {
    const { hooks } = fakeHooks({ ann: 1000 });
    const lobby = new Lobby(engine, Math.random, Date.now, hooks);
    const a = fakeClient();
    lobby.handle(a.client, { t: 'queue', token: 'ann', heroId: hero, deck });
    lobby.handle(a.client, { t: 'unqueue' });
    expect(lobby.queueSize).toBe(0);
    lobby.handle(a.client, { t: 'queue', token: 'ann', heroId: hero, deck });
    lobby.disconnect(a.client);
    expect(lobby.queueSize).toBe(0);
  });

  it('排位賽斷線超過兩分鐘判輸', async () => {
    let now = 0;
    const { hooks, reported } = fakeHooks({ ann: 1000, bob: 1000 });
    const lobby = new Lobby(engine, Math.random, () => now, hooks);
    const [a, b] = [fakeClient(), fakeClient()];
    lobby.handle(a.client, { t: 'queue', token: 'ann', heroId: hero, deck });
    lobby.handle(b.client, { t: 'queue', token: 'bob', heroId: hero, deck });
    lobby.disconnect(a.client);
    now = FORFEIT_MS - 1;
    lobby.tick();
    expect(b.last('state')!.view.phase).not.toBe('over');
    now = FORFEIT_MS + 1;
    lobby.tick();
    expect(b.last('state')!.view.phase).toBe('over');
    await Promise.resolve();
    expect(reported[0]!.find((p) => p.summary.won)!.id).toBe('bob');
  });
});

describe('帳號的排位資料', () => {
  it('排位結果改變雙方的星星與分數，贏的人拿金幣', async () => {
    const store = await AccountStore.open(null, sampleDb());
    const { account: ann } = await store.loginWithPassword('小安', 'pass1', true);
    const { account: bob } = await store.loginWithPassword('小寶', 'pass2', true);
    expect(ann.id).toMatch(/^guest:/);
    const summary = (won: boolean) => ({ won, conceded: false, deckColors: [], summoned: 0, drew: 0, spells: 0 });
    const gold = ann.profile.gold;
    const reports = await store.recordRanked([
      { id: ann.id, summary: summary(true) },
      { id: bob.id, summary: summary(false) },
    ]);
    expect(reports![0]).toMatchObject({ won: true, starsDelta: 1 });
    expect(store.byId(ann.id)!.rank!.mmr).toBe(1016);
    expect(store.byId(bob.id)!.rank!.mmr).toBe(984);
    expect(store.byId(ann.id)!.profile.gold).toBe(gold + 10);
    expect(store.leaderboard().map((row) => row.name)).toEqual(['小安', '小寶']);
  });
});

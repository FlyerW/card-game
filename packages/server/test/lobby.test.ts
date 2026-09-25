import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngine, deckPool, sampleDb, SAMPLE_HEROES, type PlayerView } from '@card-game/engine';
import { buildDeck } from '@card-game/sim/deck';
import { WebSocket } from 'ws';
import { Lobby, ROOM_IDLE_MS, type Client } from '../src/lobby';
import type { ServerMessage } from '../src/protocol';
import { startServer, type Running } from '../src/server';

const engine = createEngine(sampleDb());
const [white, red] = [SAMPLE_HEROES[0]!.id, SAMPLE_HEROES[1]!.id];
const deckFor = (heroId: string, seed = 1) => buildDeck(seed, heroId, deckPool(engine.db, heroId));

/** 假的連線：把收到的訊息都記下來。 */
function fakeClient() {
  const inbox: ServerMessage[] = [];
  const client: Client = { send: (message) => inbox.push(structuredClone(message)) };
  const last = <T extends ServerMessage['t']>(t: T) =>
    [...inbox].reverse().find((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  return { client, inbox, last };
}

function openRoom(lobby: Lobby) {
  const host = fakeClient();
  const guest = fakeClient();
  lobby.handle(host.client, { t: 'create', name: '小明', heroId: white, deck: deckFor(white) });
  const code = host.last('room')!.code;
  lobby.handle(guest.client, { t: 'join', code, name: '阿華', heroId: red, deck: deckFor(red, 2) });
  return { host, guest, code };
}

describe('房間', () => {
  it('開房間拿到房號；朋友用房號加入，兩個人都到了就開局', () => {
    const lobby = new Lobby(engine);
    const { host, guest, code } = openRoom(lobby);
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    expect(host.last('room')).toMatchObject({ seat: 0, seats: [{ name: '小明', connected: true }, { name: '阿華', connected: true }] });
    expect(guest.last('room')).toMatchObject({ seat: 1 });
    expect(host.last('state')!.view.phase).toBe('mulligan');
    expect(guest.last('state')!.view.phase).toBe('mulligan');
  });

  it('牌組不合法就不能開房間', () => {
    const lobby = new Lobby(engine);
    const host = fakeClient();
    lobby.handle(host.client, { t: 'create', name: 'x', heroId: white, deck: deckFor(red) });
    expect(host.last('error')!.message).toContain('牌組不合法');
    expect(lobby.roomCount).toBe(0);
  });

  it('房號不存在或房間已滿都加入不了', () => {
    const lobby = new Lobby(engine);
    const { code } = openRoom(lobby);
    const third = fakeClient();
    lobby.handle(third.client, { t: 'join', code, name: 'x', heroId: red, deck: deckFor(red) });
    expect(third.last('error')).toMatchObject({ fatal: true, message: '這個房間已經有兩個人了' });
    lobby.handle(third.client, { t: 'join', code: 'ZZZZ', name: 'x', heroId: red, deck: deckFor(red) });
    expect(third.last('error')!.message).toContain('找不到這個房間');
  });
});

describe('對局', () => {
  function started() {
    const lobby = new Lobby(engine);
    const room = openRoom(lobby);
    lobby.handle(room.host.client, { t: 'act', action: { type: 'mulligan', player: 0, cards: [] } });
    lobby.handle(room.guest.client, { t: 'act', action: { type: 'mulligan', player: 1, cards: [] } });
    return { lobby, ...room };
  }

  it('雙方決定起手後進入第 1 回合；只有輪到的人拿到能做的動作', () => {
    const { host, guest } = started();
    const [a, b] = [host.last('state')!, guest.last('state')!];
    expect(a.view.phase).toBe('main');
    const active = a.view.activePlayer;
    const mine = active === 0 ? a : b;
    const theirs = active === 0 ? b : a;
    expect(mine.legal.length).toBeGreaterThan(0);
    expect(theirs.legal).toEqual([]);
  });

  it('看不到對手的手牌與抽到的牌', () => {
    const { host, guest } = started();
    const hostHand = host.last('state')!.view.you.hand.map((card) => card.uid);
    const guestJson = JSON.stringify(guest.inbox);
    for (const uid of hostHand) expect(guestJson).not.toMatch(new RegExp(`"uid":${uid}[,}]`));
    const guestView: PlayerView = guest.last('state')!.view;
    expect(guestView.opponent).not.toHaveProperty('hand');
  });

  it('出手後雙方都收到新局面；不能替對手出手', () => {
    const { lobby, host, guest } = started();
    const active = host.last('state')!.view.activePlayer;
    const [mover, watcher] = active === 0 ? [host, guest] : [guest, host];
    lobby.handle(mover.client, { t: 'act', action: { type: 'endTurn', player: active } });
    expect(watcher.last('state')!.view.activePlayer).toBe(active === 0 ? 1 : 0);
    lobby.handle(watcher.client, { t: 'act', action: { type: 'endTurn', player: active } });
    expect(watcher.last('error')!.message).toBe('只能替自己的座位出手');
  });

  it('斷線後用 token 回到原本的座位，拿到目前的局面', () => {
    const { lobby, host, code } = started();
    const token = host.last('room')!.token;
    lobby.disconnect(host.client);
    const back = fakeClient();
    lobby.handle(back.client, { t: 'rejoin', code, token });
    expect(back.last('room')).toMatchObject({ seat: 0, code });
    expect(back.last('state')!.view.phase).toBe('main');
  });

  it('對局中離開算投降；結束後雙方都按再來一局才開新局', () => {
    const { lobby, host, guest } = started();
    lobby.handle(guest.client, { t: 'act', action: { type: 'concede', player: 1 } });
    expect(host.last('state')!.view.result).toEqual({ winner: 0, reason: 'concede' });
    lobby.handle(host.client, { t: 'rematch' });
    expect(host.last('room')!.rematch).toEqual([true, false]);
    lobby.handle(guest.client, { t: 'rematch' });
    expect(host.last('state')!.view.phase).toBe('mulligan');

    lobby.handle(guest.client, { t: 'leave' });
    expect(host.last('state')!.view.result).toEqual({ winner: 0, reason: 'concede' });
    expect(host.last('room')!.seats[1]).toBeNull();
  });

  it('沒人連著的房間放太久就收掉', () => {
    let now = 0;
    const lobby = new Lobby(engine, Math.random, () => now);
    const { host, guest } = openRoom(lobby);
    lobby.disconnect(host.client);
    lobby.disconnect(guest.client);
    now = ROOM_IDLE_MS + 1;
    lobby.sweep();
    expect(lobby.roomCount).toBe(0);
  });
});

describe('WebSocket', () => {
  let running: Running;
  beforeAll(async () => {
    running = await startServer({ port: 0, host: '127.0.0.1' });
  });
  afterAll(() => running.close());

  function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
    const inbox: ServerMessage[] = [];
    const waiters: (() => void)[] = [];
    socket.on('message', (data) => {
      inbox.push(JSON.parse(String(data)) as ServerMessage);
      waiters.splice(0).forEach((wake) => wake());
    });
    const next = async (t: ServerMessage['t']) => {
      for (;;) {
        const found = inbox.find((m) => m.t === t);
        if (found) {
          inbox.splice(inbox.indexOf(found), 1);
          return found;
        }
        await new Promise<void>((wake) => waiters.push(wake));
      }
    };
    return { socket, next, opened: new Promise((done) => socket.on('open', done)) };
  }

  it('兩條連線開房間、加入，都收到開局的局面', async () => {
    const host = connect();
    const guest = connect();
    await Promise.all([host.opened, guest.opened]);
    host.socket.send(JSON.stringify({ t: 'create', name: 'A', heroId: white, deck: deckFor(white) }));
    const room = (await host.next('room')) as Extract<ServerMessage, { t: 'room' }>;
    guest.socket.send(JSON.stringify({ t: 'join', code: room.code, name: 'B', heroId: red, deck: deckFor(red) }));
    const [a, b] = await Promise.all([host.next('state'), guest.next('state')]);
    expect(a).toMatchObject({ view: { phase: 'mulligan', viewer: 0 } });
    expect(b).toMatchObject({ view: { phase: 'mulligan', viewer: 1 } });
    host.socket.close();
    guest.socket.close();
  });
});

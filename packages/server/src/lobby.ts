import { randomUUID } from 'node:crypto';
import { DEFAULT_RULES, eventsFor, validateDeck, type Engine, type GameEvent, type GameState, type PlayerId } from '@card-game/engine';
import { emptyTally, gameSummary, tallyEvents, type GameSummary, type GameTally } from '@card-game/economy';
import { CODE_ALPHABET, CODE_LENGTH, type ClientMessage, type RankedReport, type SeatInfo, type ServerMessage } from './protocol';

// 房間與對局。不碰網路：一條連線就是一個能收訊息的 Client，方便測試。
//
// 伺服器握有唯一的真實狀態。客戶端送來的動作一律交給規則引擎驗證，
// 再把各自的視角、各自能做的動作、過濾過的事件分別送給雙方。

export interface Client {
  send(message: ServerMessage): void;
}

/** 排位賽用到的帳號功能；由伺服器接上帳號資料，測試時可以換成假的。 */
export interface RankedHooks {
  /** session token → 帳號；過期或不對就是 null。 */
  authenticate(token: string): RankedPlayer | null;
  /** 記下一場排位賽，回傳雙方看的結果。 */
  report(players: [{ id: string; summary: GameSummary }, { id: string; summary: GameSummary }]): Promise<[RankedReport, RankedReport] | null>;
}

export interface RankedPlayer {
  id: string;
  name: string;
  mmr: number;
  /** 這個英雄與牌組在他的收藏裡有沒有問題；沒問題是 null。 */
  ownershipProblem(heroId: string, deck: string[]): string | null;
}

interface Seat {
  token: string;
  name: string;
  heroId: string;
  deck: string[];
  client: Client | null;
  /** 斷線的時間；連著就是 null。排位賽斷線太久算輸。 */
  disconnectedAt: number | null;
}

interface Room {
  code: string;
  seats: [Seat | null, Seat | null];
  state: GameState | null;
  rematch: [boolean, boolean];
  /** 最後一個人斷線的時間；有人連著就是 null。 */
  idleSince: number | null;
  /** 排位賽：雙方的帳號、邊打邊累計的數字、結果記過了沒。 */
  ranked: { accounts: [string, string]; tallies: [GameTally, GameTally]; reported: boolean } | null;
}

interface QueueEntry {
  client: Client;
  accountId: string;
  name: string;
  heroId: string;
  deck: string[];
  mmr: number;
  since: number;
}

/** 排位賽斷線超過這麼久就判輸。 */
export const FORFEIT_MS = 2 * 60 * 1000;
/** 配對：隱藏分數差多少以內算接近；每多等一秒放寬一點，等太久就誰都配。 */
const MATCH_RANGE = 100;
const MATCH_RANGE_PER_SECOND = 10;
const MATCH_ANYONE_AFTER_MS = 30 * 1000;

/** 沒有人連著的房間放多久就收掉。 */
export const ROOM_IDLE_MS = 30 * 60 * 1000;
const NAME_LIMIT = 16;

const other = (seat: PlayerId): PlayerId => (seat === 0 ? 1 : 0);

export class Lobby {
  private readonly rooms = new Map<string, Room>();
  private readonly where = new Map<Client, { room: Room; seat: PlayerId }>();
  private queue: QueueEntry[] = [];

  constructor(
    private readonly engine: Engine,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
    private readonly ranked: RankedHooks | null = null,
  ) {}

  get queueSize(): number {
    return this.queue.length;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  handle(client: Client, message: ClientMessage): void {
    try {
      this.dispatch(client, message);
    } catch (error) {
      // 規則引擎自己會把不合法的動作擋下來；會走到這裡的是格式不對的訊息。
      client.send({ t: 'error', message: `看不懂這個請求：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  private dispatch(client: Client, message: ClientMessage): void {
    switch (message.t) {
      case 'create':
        return this.create(client, message);
      case 'join':
        return this.join(client, message);
      case 'rejoin':
        return this.rejoin(client, message.code, message.token);
      case 'act':
        return this.act(client, message.action);
      case 'rematch':
        return this.requestRematch(client);
      case 'leave':
        return this.leave(client);
      case 'queue':
        return this.enqueue(client, message);
      case 'unqueue':
        return this.dequeue(client);
      default:
        client.send({ t: 'error', message: '看不懂這個請求' });
    }
  }

  /** 連線斷了：座位留著，等他用 token 回來。 */
  disconnect(client: Client): void {
    this.dequeue(client);
    const at = this.where.get(client);
    this.where.delete(client);
    if (!at) return;
    const seat = at.room.seats[at.seat];
    if (seat?.client === client) {
      seat.client = null;
      seat.disconnectedAt = this.now();
    }
    this.markIdle(at.room);
    this.broadcastRoom(at.room);
  }

  /** 每隔幾秒呼叫：配對排隊的人；排位賽斷線太久的判輸。 */
  tick(): void {
    this.matchQueue();
    for (const room of this.rooms.values()) {
      if (!room.ranked || !room.state || room.state.phase === 'over') continue;
      room.seats.forEach((seat, index) => {
        if (seat?.disconnectedAt != null && this.now() - seat.disconnectedAt > FORFEIT_MS && room.state?.phase !== 'over') {
          const result = this.engine.apply(room.state!, { type: 'concede', player: index as PlayerId });
          if (result.ok) {
            room.state = result.state;
            this.broadcastState(room, result.events);
          }
        }
      });
    }
  }

  /** 收掉太久沒有人連著的房間。 */
  sweep(): void {
    for (const room of this.rooms.values()) {
      if (room.idleSince !== null && this.now() - room.idleSince > ROOM_IDLE_MS) this.rooms.delete(room.code);
    }
  }

  // ─── 各種請求 ───────────────────────────────────────────────────────────────

  private create(client: Client, message: Extract<ClientMessage, { t: 'create' }>): void {
    const seat = this.newSeat(client, message.name, message.heroId, message.deck);
    if (seat === null) return;
    this.leave(client);
    const room: Room = { code: this.newCode(), seats: [seat, null], state: null, rematch: [false, false], idleSince: null, ranked: null };
    this.rooms.set(room.code, room);
    this.where.set(client, { room, seat: 0 });
    this.broadcastRoom(room);
  }

  private join(client: Client, message: Extract<ClientMessage, { t: 'join' }>): void {
    const room = this.rooms.get(String(message.code).toUpperCase().trim());
    if (!room) return client.send({ t: 'error', message: '找不到這個房間，確認一下房號', fatal: true });
    if (room.seats[1] !== null) return client.send({ t: 'error', message: '這個房間已經有兩個人了', fatal: true });
    const seat = this.newSeat(client, message.name, message.heroId, message.deck);
    if (seat === null) return;
    this.leave(client);
    room.seats[1] = seat;
    room.idleSince = null;
    this.where.set(client, { room, seat: 1 });
    this.startGame(room);
  }

  private rejoin(client: Client, code: string, token: string): void {
    const room = this.rooms.get(String(code).toUpperCase().trim());
    const index = room?.seats.findIndex((seat) => seat?.token === token) ?? -1;
    if (!room || index === -1) return client.send({ t: 'error', message: '這個房間已經不在了', fatal: true });
    const seatNo = index as PlayerId;
    const seat = room.seats[seatNo]!;
    // 同一個座位在別的分頁開著的話，舊的那條連線就不再收到訊息。
    if (seat.client !== null && seat.client !== client) this.where.delete(seat.client);
    seat.client = client;
    seat.disconnectedAt = null;
    room.idleSince = null;
    this.where.set(client, { room, seat: seatNo });
    this.broadcastRoom(room);
    if (room.state) this.sendState(room, seatNo, []);
  }

  private act(client: Client, action: unknown): void {
    const at = this.where.get(client);
    if (!at?.room.state) return client.send({ t: 'error', message: '對局還沒開始' });
    if (typeof action !== 'object' || action === null || (action as { player?: unknown }).player !== at.seat) {
      return client.send({ t: 'error', message: '只能替自己的座位出手' });
    }
    const result = this.engine.apply(at.room.state, action as Parameters<Engine['apply']>[1]);
    if (!result.ok) return client.send({ t: 'error', message: result.error.message });
    at.room.state = result.state;
    this.broadcastState(at.room, result.events);
  }

  private requestRematch(client: Client): void {
    const at = this.where.get(client);
    if (!at?.room.state || at.room.state.phase !== 'over') return client.send({ t: 'error', message: '對局結束後才能再來一局' });
    if (at.room.ranked) return client.send({ t: 'error', message: '排位賽不能再來一局，回到開局畫面重新排隊' });
    at.room.rematch[at.seat] = true;
    if (at.room.rematch[0] && at.room.rematch[1]) this.startGame(at.room);
    else this.broadcastRoom(at.room);
  }

  /** 離開房間。對局還在進行就算投降。 */
  private leave(client: Client): void {
    const at = this.where.get(client);
    if (!at) return;
    const { room, seat } = at;
    this.where.delete(client);
    if (room.state?.phase === 'mulligan' || room.state?.phase === 'main') {
      const result = this.engine.apply(room.state, { type: 'concede', player: seat });
      if (result.ok) {
        room.state = result.state;
        this.broadcastState(room, result.events);
      }
    }
    room.seats[seat] = null;
    room.rematch = [false, false];
    if (room.seats.every((each) => each === null)) this.rooms.delete(room.code);
    else {
      this.markIdle(room);
      this.broadcastRoom(room);
    }
  }

  // ─── 對局 ───────────────────────────────────────────────────────────────────

  private startGame(room: Room): void {
    const [a, b] = room.seats;
    if (!a || !b) return;
    const created = this.engine.createGame({
      seed: Math.floor(this.random() * 2 ** 32),
      players: [
        { heroId: a.heroId, deck: a.deck },
        { heroId: b.heroId, deck: b.deck },
      ],
    });
    if (!created.ok) {
      for (const seat of room.seats) seat?.client?.send({ t: 'error', message: created.error.message });
      return;
    }
    room.state = created.state;
    room.rematch = [false, false];
    this.broadcastRoom(room);
    this.broadcastState(room, []);
  }

  private broadcastState(room: Room, events: GameEvent[]): void {
    for (const seat of [0, 1] as const) this.sendState(room, seat, events);
    if (room.ranked) {
      room.ranked.tallies = [tallyEvents(room.ranked.tallies[0], events, 0), tallyEvents(room.ranked.tallies[1], events, 1)];
      if (room.state?.phase === 'over' && !room.ranked.reported) void this.reportRanked(room);
    }
  }

  /** 排位賽結束：由伺服器上的對局決定勝負，記進雙方的帳號，再把結果送給雙方。平手不算。 */
  private async reportRanked(room: Room): Promise<void> {
    const ranked = room.ranked!;
    const result = room.state?.result;
    ranked.reported = true;
    if (!this.ranked || !result || result.winner === 'draw') return;
    const summary = (seat: PlayerId): GameSummary => {
      const won = result.winner === seat;
      return gameSummary(this.engine.db, ranked.tallies[seat], room.seats[seat]!.deck, won, result.reason === 'concede' && !won);
    };
    const reports = await this.ranked.report([
      { id: ranked.accounts[0], summary: summary(0) },
      { id: ranked.accounts[1], summary: summary(1) },
    ]);
    reports?.forEach((report, seat) => room.seats[seat]?.client?.send({ t: 'ranked', report }));
  }

  // ─── 排位賽排隊 ─────────────────────────────────────────────────────────────

  private enqueue(client: Client, message: Extract<ClientMessage, { t: 'queue' }>): void {
    if (!this.ranked) return client.send({ t: 'error', message: '這台伺服器沒有開排位賽' });
    const player = typeof message.token === 'string' ? this.ranked.authenticate(message.token) : null;
    if (!player) return client.send({ t: 'error', message: '要先用伺服器上的帳號登入（訪客或 Google）才能打排位' });
    const seat = this.newSeat(client, player.name, message.heroId, message.deck);
    if (seat === null) return;
    const problem = player.ownershipProblem(seat.heroId, seat.deck);
    if (problem) return client.send({ t: 'error', message: problem });
    this.leave(client);
    // 同一個帳號在別的分頁排隊的話，換成這一個。
    this.queue = this.queue.filter((entry) => entry.accountId !== player.id && entry.client !== client);
    this.queue.push({ client, accountId: player.id, name: seat.name, heroId: seat.heroId, deck: seat.deck, mmr: player.mmr, since: this.now() });
    this.announceQueue();
    this.matchQueue();
  }

  private dequeue(client: Client): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((entry) => entry.client !== client);
    if (this.queue.length !== before) this.announceQueue();
  }

  private announceQueue(): void {
    for (const entry of this.queue) entry.client.send({ t: 'queued', since: entry.since, waiting: this.queue.length });
  }

  /** 先排的先配：找隱藏分數最接近、而且在容許範圍內的人；等越久範圍越大。 */
  private matchQueue(): void {
    const now = this.now();
    const allowed = (a: QueueEntry, b: QueueEntry) => {
      const waited = Math.max(now - a.since, now - b.since);
      return waited >= MATCH_ANYONE_AFTER_MS || Math.abs(a.mmr - b.mmr) <= MATCH_RANGE + (MATCH_RANGE_PER_SECOND * waited) / 1000;
    };
    const waiting = [...this.queue].sort((a, b) => a.since - b.since);
    const matched = new Set<QueueEntry>();
    for (const a of waiting) {
      if (matched.has(a)) continue;
      const partner = waiting
        .filter((b) => b !== a && !matched.has(b) && b.accountId !== a.accountId && allowed(a, b))
        .sort((x, y) => Math.abs(x.mmr - a.mmr) - Math.abs(y.mmr - a.mmr))[0];
      if (!partner) continue;
      matched.add(a);
      matched.add(partner);
      this.startRanked(a, partner);
    }
    if (matched.size > 0) {
      this.queue = this.queue.filter((entry) => !matched.has(entry));
      this.announceQueue();
    }
  }

  private startRanked(a: QueueEntry, b: QueueEntry): void {
    const seat = (entry: QueueEntry): Seat => ({ token: randomUUID(), name: entry.name, heroId: entry.heroId, deck: entry.deck, client: entry.client, disconnectedAt: null });
    const room: Room = {
      code: this.newCode(),
      seats: [seat(a), seat(b)],
      state: null,
      rematch: [false, false],
      idleSince: null,
      ranked: { accounts: [a.accountId, b.accountId], tallies: [emptyTally(), emptyTally()], reported: false },
    };
    this.rooms.set(room.code, room);
    this.where.set(a.client, { room, seat: 0 });
    this.where.set(b.client, { room, seat: 1 });
    this.startGame(room);
  }

  private sendState(room: Room, seat: PlayerId, events: GameEvent[]): void {
    const client = room.seats[seat]?.client;
    const state = room.state;
    if (!client || !state) return;
    client.send({ t: 'state', view: this.engine.viewFor(state, seat), legal: this.legalFor(state, seat), events: eventsFor(events, seat) });
  }

  /** 這個座位現在能做的動作：重抽階段雙方各自決定，之後只有輪到的人能動。 */
  private legalFor(state: GameState, seat: PlayerId) {
    if (state.phase === 'over') return [];
    if (state.phase === 'main' && this.engine.actor(state) !== seat) return [];
    return this.engine.legalActions(state, seat);
  }

  private broadcastRoom(room: Room): void {
    const seats = room.seats.map((seat): SeatInfo | null =>
      seat === null ? null : { name: seat.name, heroId: seat.heroId, connected: seat.client !== null },
    ) as [SeatInfo | null, SeatInfo | null];
    room.seats.forEach((seat, index) => {
      seat?.client?.send({ t: 'room', code: room.code, seat: index as PlayerId, token: seat.token, seats, rematch: room.rematch, ranked: room.ranked !== null });
    });
  }

  // ─── 小工具 ─────────────────────────────────────────────────────────────────

  /** 檢查名字、英雄與牌組；有問題就回報給這位玩家並回傳 null。 */
  private newSeat(client: Client, name: unknown, heroId: unknown, deck: unknown): Seat | null {
    const cleanName = typeof name === 'string' ? name.trim().slice(0, NAME_LIMIT) : '';
    if (typeof heroId !== 'string' || !this.engine.db.heroes.has(heroId)) {
      client.send({ t: 'error', message: '找不到這個英雄' });
      return null;
    }
    if (!Array.isArray(deck) || !deck.every((id) => typeof id === 'string')) {
      client.send({ t: 'error', message: '牌組格式不對' });
      return null;
    }
    const problems = validateDeck(this.engine.db, DEFAULT_RULES, heroId, deck);
    if (problems.length > 0) {
      client.send({ t: 'error', message: `牌組不合法：${problems[0]}` });
      return null;
    }
    return { token: randomUUID(), name: cleanName || '玩家', heroId, deck: [...deck], client, disconnectedAt: null };
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private markIdle(room: Room): void {
    if (room.seats.every((seat) => seat?.client == null)) room.idleSince ??= this.now();
  }
}

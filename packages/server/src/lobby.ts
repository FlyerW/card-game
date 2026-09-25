import { randomUUID } from 'node:crypto';
import { DEFAULT_RULES, eventsFor, validateDeck, type Engine, type GameEvent, type GameState, type PlayerId } from '@card-game/engine';
import { CODE_ALPHABET, CODE_LENGTH, type ClientMessage, type SeatInfo, type ServerMessage } from './protocol';

// 房間與對局。不碰網路：一條連線就是一個能收訊息的 Client，方便測試。
//
// 伺服器握有唯一的真實狀態。客戶端送來的動作一律交給規則引擎驗證，
// 再把各自的視角、各自能做的動作、過濾過的事件分別送給雙方。

export interface Client {
  send(message: ServerMessage): void;
}

interface Seat {
  token: string;
  name: string;
  heroId: string;
  deck: string[];
  client: Client | null;
}

interface Room {
  code: string;
  seats: [Seat | null, Seat | null];
  state: GameState | null;
  rematch: [boolean, boolean];
  /** 最後一個人斷線的時間；有人連著就是 null。 */
  idleSince: number | null;
}

/** 沒有人連著的房間放多久就收掉。 */
export const ROOM_IDLE_MS = 30 * 60 * 1000;
const NAME_LIMIT = 16;

const other = (seat: PlayerId): PlayerId => (seat === 0 ? 1 : 0);

export class Lobby {
  private readonly rooms = new Map<string, Room>();
  private readonly where = new Map<Client, { room: Room; seat: PlayerId }>();

  constructor(
    private readonly engine: Engine,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

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
      default:
        client.send({ t: 'error', message: '看不懂這個請求' });
    }
  }

  /** 連線斷了：座位留著，等他用 token 回來。 */
  disconnect(client: Client): void {
    const at = this.where.get(client);
    this.where.delete(client);
    if (!at) return;
    const seat = at.room.seats[at.seat];
    if (seat?.client === client) seat.client = null;
    this.markIdle(at.room);
    this.broadcastRoom(at.room);
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
    const room: Room = { code: this.newCode(), seats: [seat, null], state: null, rematch: [false, false], idleSince: null };
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
      seat?.client?.send({ t: 'room', code: room.code, seat: index as PlayerId, token: seat.token, seats, rematch: room.rematch });
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
    return { token: randomUUID(), name: cleanName || '玩家', heroId, deck: [...deck], client };
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

import type { ClientMessage, ServerMessage } from '@card-game/server/protocol';

// 連線對戰的連線：一條 WebSocket 連到提供這個網頁的伺服器。
// 斷線會自動重連，重連後用存下來的 token 回到原本的座位，所以重新整理頁面也不會離開對局。

/** 這個網頁是從連線對戰伺服器打開的才能連線；發布在 claude.ai 的試玩版只能跟電腦打。 */
export const ONLINE_AVAILABLE = (window as { CARD_GAME_ONLINE?: boolean }).CARD_GAME_ONLINE === true;

const SESSION_KEY = 'card-game.online';
const RETRY_MS = [500, 1000, 2000, 4000, 8000];

export type RoomMessage = Extract<ServerMessage, { t: 'room' }>;

interface Session {
  code: string;
  token: string;
}

function loadSession(): Session | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    if (typeof raw === 'object' && raw !== null && typeof (raw as Session).code === 'string' && typeof (raw as Session).token === 'string') {
      return raw as Session;
    }
  } catch {
    // 讀不到就當作沒有。
  }
  return null;
}

function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // 存不了就只是重新整理後回不到房間。
  }
}

export class OnlineClient {
  /** 目前所在的房間；不在房間裡是 null。 */
  room: RoomMessage | null = null;
  connected = false;
  onMessage: (message: ServerMessage) => void = () => {};
  /** 連線狀態變了（連上、斷線），畫面可能要更新。 */
  onStatus: () => void = () => {};

  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private session: Session | null = loadSession();
  private attempt = 0;

  /** 上次沒離開的房間；重新整理後用來自動回去。 */
  get hasSession(): boolean {
    return this.session !== null;
  }

  connect(): void {
    if (this.socket) return;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.connected = true;
      this.attempt = 0;
      // 先回到原本的座位，再送斷線期間排隊的訊息。
      if (this.session) socket.send(JSON.stringify({ t: 'rejoin', ...this.session } satisfies ClientMessage));
      for (const message of this.queue.splice(0)) socket.send(JSON.stringify(message));
      this.onStatus();
    });
    socket.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === 'room') {
        this.room = message;
        this.session = { code: message.code, token: message.token };
        saveSession(this.session);
      } else if (message.t === 'error' && message.fatal) {
        this.forget();
      }
      this.onMessage(message);
    });
    socket.addEventListener('close', () => {
      this.socket = null;
      this.connected = false;
      this.onStatus();
      // 還在房間裡才重連；離開了就不必。
      if (this.session) setTimeout(() => this.connect(), RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]);
    });
  }

  send(message: ClientMessage): void {
    this.connect();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else this.queue.push(message);
  }

  /** 離開房間，不再自動回來。 */
  leave(): void {
    if (this.room) this.send({ t: 'leave' });
    this.forget();
  }

  private forget(): void {
    this.room = null;
    this.session = null;
    saveSession(null);
  }
}

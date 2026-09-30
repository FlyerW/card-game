import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, sampleDb } from '@card-game/engine';
import { WebSocketServer, type WebSocket } from 'ws';
import { ownershipProblems, ownsHero } from '@card-game/economy';
import { AccountStore } from './accounts';
import { handleApi } from './api';
import type { EcpayConfig } from './ecpay';
import { GameLog } from './gamelog';
import { googleVerifier, type GoogleIdentity } from './google';
import { clientIp, LIMITS } from './limits';
import { Lobby, type Client } from './lobby';
import type { ClientMessage } from './protocol';

// 連線對戰伺服器：同一個埠提供網頁（packages/web/dist）與 WebSocket（/ws）。

const DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));
/** 網頁看到這個就知道可以連線對戰、能不能用 Google 登入。 */
const pageFlags = (googleClientId: string | null, topup: boolean, preview: boolean) =>
  `<script>window.CARD_GAME_ONLINE = true; window.CARD_GAME_TOPUP = ${topup}; window.CARD_GAME_PREVIEW = ${preview}; window.CARD_GAME_GOOGLE_CLIENT_ID = ${JSON.stringify(googleClientId).replace(/</g, '\\u003c')}</script>`;
const MAX_MESSAGE_BYTES = 64 * 1024;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export interface Running {
  server: Server;
  lobby: Lobby;
  port: number;
  close(): Promise<void>;
}

export interface ServerOptions {
  port: number;
  host?: string;
  dist?: string;
  /** 帳號資料存在哪個資料夾；null 只放在記憶體（測試用）。 */
  dataDir?: string | null;
  /** Google 登入的 OAuth client id；沒有就不能用 Google 登入。 */
  googleClientId?: string | null;
  /** 測試時換掉 Google 的驗證。 */
  verify?: (credential: string) => Promise<GoogleIdentity>;
  /** 綠界金流；沒有就不開放儲值。 */
  ecpay?: EcpayConfig | null;
  /** 對外的網址（綠界通知用）；沒有就用瀏覽器頁面的來源。 */
  publicUrl?: string | null;
  /** 預覽還沒發布的卡包系列（測試用）。 */
  preview?: boolean;
  /** false：關掉流量限制（測試用）。 */
  limits?: boolean;
}

export async function startServer(options: ServerOptions): Promise<Running> {
  const dist = options.dist ?? DIST;
  const db = sampleDb(options.preview ?? false);
  // 超級帳號用：包含還沒發布的卡包系列。
  const previewDb = sampleDb(true);
  const googleClientId = options.googleClientId ?? null;
  const store = await AccountStore.open(options.dataDir ?? null, db, previewDb);
  const log = new GameLog(options.dataDir ? join(options.dataDir, 'games.jsonl') : null);
  // 排位賽：用帳號的 session 驗證身分、檢查收藏，結果記進帳號。
  const lobby = new Lobby(createEngine(db), Math.random, Date.now, {
    authenticate: (token) => {
      const account = store.byToken(token);
      if (!account) return null;
      return {
        id: account.id,
        name: account.name,
        mmr: store.rankOf(account).mmr,
        ownershipProblem: (heroId, deck) => {
          if (!ownsHero(account.profile, db, heroId)) return '你還沒有這個英雄';
          const problems = ownershipProblems(account.profile, db, deck);
          return problems.length > 0 ? `牌組裡有收藏不夠的卡：${problems[0]}` : null;
        },
      };
    },
    report: (players) => store.recordRanked(players),
  }, log);
  // 流量限制（limits.ts）；測試可以關掉。
  const limited = options.limits !== false;
  const api = {
    store,
    db,
    previewDb,
    googleClientId,
    verify: options.verify ?? (googleClientId ? googleVerifier(googleClientId) : null),
    log,
    ecpay: options.ecpay ?? null,
    publicUrl: options.publicUrl ?? null,
    limits: limited ? { api: LIMITS.api(), login: LIMITS.login(), register: LIMITS.register(), failedLogin: LIMITS.failedLogin() } : null,
  };
  const fileLimit = LIMITS.files();
  // 網頁檔案讀一次就留在記憶體（打包好的檔案不會變；重新打包要重開伺服器）。
  const fileCache = new Map<string, Buffer | string>();

  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (await handleApi(request, response, path, api)) return;
    const file = resolve(dist, normalize(path === '/' ? 'index.html' : path.slice(1)));
    if (!file.startsWith(resolve(dist) + sep) && file !== resolve(dist)) {
      response.writeHead(403).end();
      return;
    }
    if (limited && !fileLimit.take(clientIp(request))) {
      response.writeHead(429, { 'content-type': 'text/plain; charset=utf-8' }).end('太頻繁了，請等一下再試');
      return;
    }
    try {
      let body = fileCache.get(file);
      if (body === undefined) {
        body = await readFile(file);
        if (file.endsWith('index.html')) body = body.toString('utf8').replace('</head>', `${pageFlags(googleClientId, Boolean(options.ecpay), options.preview ?? false)}</head>`);
        fileCache.set(file, body);
      }
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      const hint = path === '/' ? '找不到網頁。先執行 npm run build:web，或直接用 npm run server。' : 'Not found';
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(hint);
    }
  });

  const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  // 連線對戰的流量限制：每個 IP 同時幾條連線、每條連線每秒幾則訊息、每個 IP 每分鐘開幾間房、聊天多快。
  const perIp = new Map<string, number>();
  const messageLimit = LIMITS.messages();
  const chatLimit = LIMITS.chat();
  const roomLimit = LIMITS.rooms();
  let nextSocket = 0;
  sockets.on('connection', (socket: WebSocket, request) => {
    const ip = clientIp(request);
    const id = String(nextSocket++);
    if (limited && (perIp.get(ip) ?? 0) >= LIMITS.socketsPerIp) {
      socket.close(1008, 'too many connections');
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const client: Client = {
      send: (message) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    socket.on('message', (data) => {
      let message: unknown;
      try {
        message = JSON.parse(String(data));
      } catch {
        return client.send({ t: 'error', message: '訊息格式不對' });
      }
      if (typeof message !== 'object' || message === null || typeof (message as { t?: unknown }).t !== 'string') return;
      const kind = (message as { t: string }).t;
      if (limited) {
        if (!messageLimit.take(id)) return client.send({ t: 'error', message: '太頻繁了，請等一下再試' });
        if (kind === 'chat' && !chatLimit.take(id)) return client.send({ t: 'error', message: '說太快了，等一下再說' });
        if (kind === 'create' && lobby.roomCount >= LIMITS.maxRooms) return client.send({ t: 'error', message: '伺服器的房間滿了，等一下再試' });
        if (kind === 'create' && !roomLimit.take(ip)) return client.send({ t: 'error', message: '開太多房間了，等一下再試' });
      }
      lobby.handle(client, message as ClientMessage);
    });
    socket.on('close', () => {
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left > 0) perIp.set(ip, left);
      else perIp.delete(ip);
      lobby.disconnect(client);
    });
  });

  const sweeper = setInterval(() => lobby.sweep(), 5 * 60 * 1000);
  sweeper.unref();
  // 排位配對與斷線判輸，每 2 秒看一次。
  const ticker = setInterval(() => lobby.tick(), 2000);
  ticker.unref();
  // 帳號資料每天備份一份（data/backups/，留 14 天）：開伺服器時做一次，之後每小時看一下換日了沒。
  const backup = () =>
    store.dailyBackup().then(
      (file) => file && console.log(`帳號資料已備份：${file}`),
      (error: unknown) => console.error('帳號資料備份失敗', error),
    );
  void backup();
  const backups = setInterval(backup, 60 * 60 * 1000);
  backups.unref();

  await new Promise<void>((done) => server.listen(options.port, options.host ?? '0.0.0.0', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;

  return {
    server,
    lobby,
    port,
    close: () =>
      new Promise<void>((done) => {
        clearInterval(sweeper);
        clearInterval(ticker);
        clearInterval(backups);
        for (const socket of sockets.clients) socket.terminate();
        sockets.close();
        server.close(() => done());
      }),
  };
}

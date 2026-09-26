import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, sampleDb } from '@card-game/engine';
import { WebSocketServer, type WebSocket } from 'ws';
import { ownershipProblems, ownsHero } from '@card-game/economy';
import { AccountStore } from './accounts';
import { handleApi } from './api';
import { googleVerifier, type GoogleIdentity } from './google';
import { Lobby, type Client } from './lobby';
import type { ClientMessage } from './protocol';

// 連線對戰伺服器：同一個埠提供網頁（packages/web/dist）與 WebSocket（/ws）。

const DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));
/** 網頁看到這個就知道可以連線對戰、能不能用 Google 登入。 */
const pageFlags = (googleClientId: string | null) =>
  `<script>window.CARD_GAME_ONLINE = true; window.CARD_GAME_GOOGLE_CLIENT_ID = ${JSON.stringify(googleClientId).replace(/</g, '\\u003c')}</script>`;
const MAX_MESSAGE_BYTES = 64 * 1024;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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
}

export async function startServer(options: ServerOptions): Promise<Running> {
  const dist = options.dist ?? DIST;
  const db = sampleDb();
  const googleClientId = options.googleClientId ?? null;
  const store = await AccountStore.open(options.dataDir ?? null, db);
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
  });
  const api = {
    store,
    db,
    googleClientId,
    verify: options.verify ?? (googleClientId ? googleVerifier(googleClientId) : null),
  };

  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (await handleApi(request, response, path, api)) return;
    const file = resolve(dist, normalize(path === '/' ? 'index.html' : path.slice(1)));
    if (!file.startsWith(resolve(dist) + sep) && file !== resolve(dist)) {
      response.writeHead(403).end();
      return;
    }
    try {
      let body: Buffer | string = await readFile(file);
      if (file.endsWith('index.html')) body = body.toString('utf8').replace('</head>', `${pageFlags(googleClientId)}</head>`);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      const hint = path === '/' ? '找不到網頁。先執行 npm run build:web，或直接用 npm run server。' : 'Not found';
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(hint);
    }
  });

  const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  sockets.on('connection', (socket: WebSocket) => {
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
      if (typeof message === 'object' && message !== null && typeof (message as { t?: unknown }).t === 'string') {
        lobby.handle(client, message as ClientMessage);
      }
    });
    socket.on('close', () => lobby.disconnect(client));
  });

  const sweeper = setInterval(() => lobby.sweep(), 5 * 60 * 1000);
  sweeper.unref();
  // 排位配對與斷線判輸，每 2 秒看一次。
  const ticker = setInterval(() => lobby.tick(), 2000);
  ticker.unref();

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
        for (const socket of sockets.clients) socket.terminate();
        sockets.close();
        server.close(() => done());
      }),
  };
}

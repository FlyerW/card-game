import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, sampleDb } from '@card-game/engine';
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby, type Client } from './lobby';
import type { ClientMessage } from './protocol';

// 連線對戰伺服器：同一個埠提供網頁（packages/web/dist）與 WebSocket（/ws）。

const DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));
/** 網頁看到這個就知道可以連線對戰。 */
const ONLINE_FLAG = '<script>window.CARD_GAME_ONLINE = true</script>';
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

export async function startServer(options: { port: number; host?: string; dist?: string }): Promise<Running> {
  const dist = options.dist ?? DIST;
  const lobby = new Lobby(createEngine(sampleDb()));

  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = resolve(dist, normalize(path === '/' ? 'index.html' : path.slice(1)));
    if (!file.startsWith(resolve(dist) + sep) && file !== resolve(dist)) {
      response.writeHead(403).end();
      return;
    }
    try {
      let body: Buffer | string = await readFile(file);
      if (file.endsWith('index.html')) body = body.toString('utf8').replace('</head>', `${ONLINE_FLAG}</head>`);
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
        for (const socket of sockets.clients) socket.terminate();
        sockets.close();
        server.close(() => done());
      }),
  };
}

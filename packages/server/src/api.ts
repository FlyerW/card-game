import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_RULES, type CardDb } from '@card-game/engine';
import { exchange, openPack, parseSummary, recordGame } from '@card-game/economy';
import { accountInfo, serverDay, type Account, type AccountStore } from './accounts';
import { TokenError, type GoogleIdentity } from './google';

// 帳號與經濟的 HTTP API，全部在 /api/ 底下，收發 JSON。登入後的請求帶 Authorization: Bearer <token>。
// 開卡包的亂數在伺服器上抽，瀏覽器改不了；跟電腦打的勝負目前是瀏覽器回報的（電腦對手跑在瀏覽器裡），
// 所以還防不了作弊，之後要把電腦對戰也搬到伺服器上。

const MAX_BODY_BYTES = 16 * 1024;

export interface ApiOptions {
  store: AccountStore;
  db: CardDb;
  /** Google 登入用的 OAuth client id；沒設定就不能用 Google 登入。 */
  googleClientId: string | null;
  verify: ((credential: string) => Promise<GoogleIdentity>) | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '資料太大');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // 落到下面
  }
  throw new HttpError(400, '資料格式不對');
}

const bearer = (request: IncomingMessage) => /^Bearer ([0-9a-f]{64})$/.exec(request.headers.authorization ?? '')?.[1] ?? null;

/** 處理 /api/ 的請求。不是 API 的網址回傳 false，交給靜態檔案。 */
export async function handleApi(request: IncomingMessage, response: ServerResponse, path: string, options: ApiOptions): Promise<boolean> {
  if (!path.startsWith('/api/')) return false;
  const { store, db } = options;
  const route = `${request.method} ${path}`;
  try {
    const authed = (): { account: Account; token: string } => {
      const token = bearer(request);
      const account = token ? store.byToken(token) : null;
      if (!token || !account) throw new HttpError(401, '登入已經過期，請重新登入');
      return { account, token };
    };

    switch (route) {
      case 'GET /api/config':
        return send(response, 200, { googleClientId: options.googleClientId }), true;

      case 'POST /api/login/google': {
        if (!options.verify) throw new HttpError(503, '這台伺服器還沒設定 Google 登入');
        const { credential } = await readJson(request);
        if (typeof credential !== 'string' || credential.length > 8192) throw new HttpError(400, '缺少 Google 的登入資料');
        let identity: GoogleIdentity;
        try {
          identity = await options.verify(credential);
        } catch (error) {
          throw new HttpError(401, error instanceof TokenError ? error.message : 'Google 登入驗證失敗');
        }
        const { token, account } = await store.login(identity);
        return send(response, 200, { token, account: accountInfo(account), profile: account.profile }), true;
      }

      case 'GET /api/me': {
        const { account } = authed();
        return send(response, 200, { account: accountInfo(account), profile: account.profile }), true;
      }

      case 'POST /api/logout': {
        const token = bearer(request);
        if (token) await store.logout(token);
        return send(response, 200, {}), true;
      }

      case 'POST /api/pack': {
        const { account } = authed();
        const opened = openPack(account.profile, db, DEFAULT_RULES, () => randomInt(2 ** 32) / 2 ** 32);
        if (!opened.ok) throw new HttpError(400, opened.reason);
        await store.update(account, opened.profile);
        return send(response, 200, { profile: opened.profile, cards: opened.cards }), true;
      }

      case 'POST /api/exchange': {
        const { account } = authed();
        const { cardId } = await readJson(request);
        if (typeof cardId !== 'string') throw new HttpError(400, '缺少要兌換的卡');
        const swapped = exchange(account.profile, db, DEFAULT_RULES, cardId);
        if (!swapped.ok) throw new HttpError(400, swapped.reason);
        await store.update(account, swapped.profile);
        return send(response, 200, { profile: swapped.profile }), true;
      }

      case 'POST /api/game': {
        const { account } = authed();
        const summary = parseSummary((await readJson(request)).summary);
        if (!summary) throw new HttpError(400, '對局資料格式不對');
        const reward = recordGame(account.profile, summary, serverDay());
        await store.update(account, reward.profile);
        return send(response, 200, reward), true;
      }

      default:
        throw new HttpError(404, '沒有這個 API');
    }
  } catch (error) {
    if (error instanceof HttpError) send(response, error.status, { error: error.message });
    else {
      console.error(error);
      send(response, 500, { error: '伺服器出錯了' });
    }
    return true;
  }
}

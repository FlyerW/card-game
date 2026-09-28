import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_RULES, type CardDb } from '@card-game/engine';
import { clearStage, cleanDeck, craft, DECK_LIMIT, emptyBook, HERO_DECK_LIMIT, openPacks, PACK_BATCH, packSets, parseSummary, putDeck, recordGame, removeDeck, selectDeck, TOPUPS } from '@card-game/economy';
import { AccountError, accountInfo, serverDay, type Account, type AccountStore } from './accounts';
import { checkoutFields, checkoutUrl, newTradeNo, readNotice, type EcpayConfig } from './ecpay';
import { parseBotRecord, type GameLog } from './gamelog';
import { TokenError, type GoogleIdentity } from './google';

// 帳號與經濟的 HTTP API，全部在 /api/ 底下，收發 JSON。登入後的請求帶 Authorization: Bearer <token>。
// 開卡包的亂數在伺服器上抽，瀏覽器改不了；跟電腦打的勝負目前是瀏覽器回報的（電腦對手跑在瀏覽器裡），
// 所以還防不了作弊，之後要把電腦對戰也搬到伺服器上。

const MAX_BODY_BYTES = 16 * 1024;

export interface ApiOptions {
  store: AccountStore;
  db: CardDb;
  /** 包含還沒發布的卡包系列：超級帳號開包、合成、存牌組用。沒給就跟 db 一樣。 */
  previewDb?: CardDb;
  /** Google 登入用的 OAuth client id；沒設定就不能用 Google 登入。 */
  googleClientId: string | null;
  verify: ((credential: string) => Promise<GoogleIdentity>) | null;
  /** 對局紀錄；null 就不記。 */
  log?: GameLog | null;
  /** 綠界金流；null 就不開放儲值。 */
  ecpay?: EcpayConfig | null;
  /** 對外的網址（綠界付款完成後通知與返回用）；沒設定就用瀏覽器頁面的來源。 */
  publicUrl?: string | null;
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

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '資料太大');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(request);
  if (text === '') return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // 落到下面
  }
  throw new HttpError(400, '資料格式不對');
}

/** 對外的網址：有設定就用設定的，不然用瀏覽器頁面的來源（Origin），再不然用 Host。 */
function publicBase(request: IncomingMessage, configured: string | null | undefined): string {
  if (configured) return configured.replace(/\/$/, '');
  const origin = request.headers.origin;
  if (typeof origin === 'string' && /^https?:\/\/[^/\s]+$/.test(origin)) return origin;
  return `https://${request.headers.host ?? 'localhost'}`;
}

const bearer = (request: IncomingMessage) => /^Bearer ([0-9a-f]{64})$/.exec(request.headers.authorization ?? '')?.[1] ?? null;

/** 處理 /api/ 的請求。不是 API 的網址回傳 false，交給靜態檔案。 */
export async function handleApi(request: IncomingMessage, response: ServerResponse, path: string, options: ApiOptions): Promise<boolean> {
  if (!path.startsWith('/api/')) return false;
  const { store, db } = options;
  /** 超級帳號看得到還沒發布的卡包；其他帳號只有已發布的。 */
  const dbFor = (account: Account): CardDb => (account.unlimited && options.previewDb ? options.previewDb : db);
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
        return send(response, 200, { googleClientId: options.googleClientId, topup: Boolean(options.ecpay) }), true;

      case 'POST /api/topup': {
        // 儲值：建立訂單，回傳要送去綠界付款頁的表單。付款成功要等綠界通知（/api/ecpay/notify）才加金幣。
        const { account } = authed();
        if (!options.ecpay) throw new HttpError(503, '這台伺服器還沒開放儲值');
        const { topup: topupId } = await readJson(request);
        const topup = TOPUPS.find((each) => each.id === topupId);
        if (!topup) throw new HttpError(400, '沒有這個儲值方案');
        const base = publicBase(request, options.publicUrl);
        const order = await store.createOrder(account, topup, newTradeNo());
        const fields = checkoutFields(options.ecpay, {
          tradeNo: order.tradeNo,
          amount: order.amount,
          itemName: `遊戲金幣 ${order.gold} 枚`,
          returnUrl: `${base}/api/ecpay/notify`,
          clientBackUrl: `${base}/?topup=${order.tradeNo}`,
        });
        return send(response, 200, { action: checkoutUrl(options.ecpay), fields, tradeNo: order.tradeNo }), true;
      }

      case 'POST /api/topup/status': {
        const { account } = authed();
        const { tradeNo } = await readJson(request);
        const order = typeof tradeNo === 'string' ? store.order(tradeNo) : null;
        if (!order || order.accountId !== account.id) throw new HttpError(404, '找不到這筆儲值');
        return send(response, 200, { status: order.status, gold: order.gold, profile: account.profile }), true;
      }

      case 'POST /api/ecpay/notify': {
        // 綠界的付款結果通知（從綠界的伺服器送來，表單格式）。檢查碼對才處理；處理完回 1|OK，綠界才不會一直重送。
        if (!options.ecpay) throw new HttpError(404, '沒有開放儲值');
        const fields = Object.fromEntries(new URLSearchParams(await readBody(request)));
        const { valid, paid } = readNotice(options.ecpay, fields);
        if (!valid) {
          response.writeHead(400, { 'content-type': 'text/plain' }).end('0|CheckMacValue error');
          return true;
        }
        if (paid) {
          const result = await store.payOrder(paid);
          if (result === 'mismatch' || result === 'unknown') console.error('綠界通知對不上訂單', result, paid);
        }
        response.writeHead(200, { 'content-type': 'text/plain' }).end('1|OK');
        return true;
      }

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
        return send(response, 200, { token, account: accountInfo(account), profile: account.profile, deckBook: account.deckBook ?? emptyBook() }), true;
      }

      case 'GET /api/me': {
        const { account } = authed();
        const rank = store.rankOf(account);
        const seasonReward = account.seasonReward ?? null;
        if (seasonReward) await store.clearSeasonReward(account);
        return send(response, 200, { account: accountInfo(account), profile: account.profile, rank, seasonReward, deckBook: account.deckBook ?? emptyBook() }), true;
      }

      case 'POST /api/login/password': {
        const { name, password, create } = await readJson(request);
        if (typeof name !== 'string' || typeof password !== 'string' || password.length > 200) throw new HttpError(400, '名字或密碼格式不對');
        try {
          const { token, account } = await store.loginWithPassword(name, password, create === true);
          return send(response, 200, { token, account: accountInfo(account), profile: account.profile, rank: store.rankOf(account), deckBook: account.deckBook ?? emptyBook() }), true;
        } catch (error) {
          if (error instanceof AccountError) throw new HttpError(error.status, error.message);
          throw error;
        }
      }

      case 'GET /api/leaderboard':
        return send(response, 200, { rows: store.leaderboard() }), true;

      case 'POST /api/logout': {
        const token = bearer(request);
        if (token) await store.logout(token);
        return send(response, 200, {}), true;
      }

      case 'POST /api/pack': {
        const { account } = authed();
        const { count = 1, set = 'core' } = await readJson(request);
        if (count !== 1 && count !== PACK_BATCH) throw new HttpError(400, `一次只能開 1 包或 ${PACK_BATCH} 包`);
        const cards = dbFor(account);
        if (typeof set !== 'string' || !packSets(cards).some((each) => each.id === set)) throw new HttpError(400, '沒有這種卡包');
        const opened = openPacks(account.profile, cards, DEFAULT_RULES, () => randomInt(2 ** 32) / 2 ** 32, count, set);
        if (!opened.ok) throw new HttpError(400, opened.reason);
        await store.update(account, opened.profile);
        // 回傳存進去的資料（超級帳號會補滿金幣）。
        return send(response, 200, { profile: account.profile, cards: opened.cards }), true;
      }

      case 'POST /api/craft': {
        const { account } = authed();
        const { cardId } = await readJson(request);
        if (typeof cardId !== 'string') throw new HttpError(400, '缺少要合成的卡');
        const crafted = craft(account.profile, dbFor(account), DEFAULT_RULES, cardId);
        if (!crafted.ok) throw new HttpError(400, crafted.reason);
        await store.update(account, crafted.profile);
        return send(response, 200, { profile: account.profile }), true;
      }

      case 'POST /api/adventure/clear': {
        // 冒險模式打過一關：第一次打過給 100 金幣。跟電腦打的對局一樣是瀏覽器回報的。
        const { account } = authed();
        const { stage, difficulty } = await readJson(request);
        const cleared = typeof stage === 'string' && typeof difficulty === 'string'
          ? clearStage(account.profile, stage, difficulty as 'normal' | 'hard' | 'nightmare')
          : null;
        if (!cleared) throw new HttpError(400, '沒有這一關，或還沒解鎖');
        await store.update(account, cleared.profile);
        return send(response, 200, { ...cleared, profile: account.profile }), true;
      }

      case 'POST /api/decks/save': {
        // 存一副牌組（新的或改過的）：可以還沒組滿；卡要存在、不能是衍生物。收藏夠不夠在開局時才檢查。
        const { account } = authed();
        const deck = cleanDeck(dbFor(account), (await readJson(request)).deck);
        if (!deck) throw new HttpError(400, '牌組格式不對');
        const book = putDeck(account.deckBook ?? emptyBook(), deck);
        if (!book) throw new HttpError(400, `每個英雄最多存 ${HERO_DECK_LIMIT} 副牌組（起始牌組不算），整個帳號最多 ${DECK_LIMIT} 副`);
        await store.saveDeckBook(account, book);
        return send(response, 200, {}), true;
      }

      case 'POST /api/decks/delete': {
        const { account } = authed();
        const { id } = await readJson(request);
        if (typeof id !== 'string') throw new HttpError(400, '缺少牌組');
        await store.saveDeckBook(account, removeDeck(account.deckBook ?? emptyBook(), id));
        return send(response, 200, {}), true;
      }

      case 'POST /api/decks/select': {
        // 選一個英雄開局要用的牌組；id 是 null 就用收藏自動組一副。
        const { account } = authed();
        const { heroId, id } = await readJson(request);
        if (typeof heroId !== 'string' || !db.heroes.has(heroId) || (id !== null && typeof id !== 'string')) throw new HttpError(400, '格式不對');
        await store.saveDeckBook(account, selectDeck(account.deckBook ?? emptyBook(), heroId, id as string | null));
        return send(response, 200, {}), true;
      }

      case 'POST /api/game': {
        const { account } = authed();
        const body = await readJson(request);
        const summary = parseSummary(body.summary);
        if (!summary) throw new HttpError(400, '對局資料格式不對');
        // 跟電腦打的對局紀錄：格式不對就不記，不影響領獎。
        const record = options.log ? parseBotRecord(body.record, dbFor(account), account.id) : null;
        if (record) void options.log!.add(record).catch((error: unknown) => console.error('對局紀錄寫不進去', error));
        const reward = recordGame(account.profile, summary, serverDay());
        await store.update(account, reward.profile);
        return send(response, 200, { ...reward, profile: account.profile }), true;
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

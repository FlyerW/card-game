import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

// 驗證 Google 登入給的 ID token（JWT）。網頁用 Google Identity Services 拿到 token 送過來，
// 伺服器自己檢查簽章、發給誰（aud）、誰發的（iss）、過期了沒，不信任瀏覽器說的任何身分。
// Google 的公鑰從 JWKS 網址抓，照回應的 max-age 快取。

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
/** 伺服器與 Google 的時鐘可以差這麼多秒。 */
const CLOCK_SKEW_S = 60;

export interface GoogleIdentity {
  /** Google 帳號的固定 id，email 會變、這個不會。 */
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export type Jwk = JsonWebKey & { kid?: string };

export class TokenError extends Error {}

const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** 檢查一個 ID token。keys 是 Google 目前的公鑰；now 是秒。不對就丟 TokenError。 */
export function verifyIdToken(token: string, clientId: string, keys: Jwk[], now = Date.now() / 1000): GoogleIdentity {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('token 格式不對');
  const [head, body, signature] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = decode(head) as typeof header;
    payload = decode(body) as typeof payload;
  } catch {
    throw new TokenError('token 格式不對');
  }
  if (header.alg !== 'RS256') throw new TokenError('不支援的簽章演算法');
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new TokenError('找不到簽章用的公鑰');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${head}.${body}`);
  if (!verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))) {
    throw new TokenError('簽章不對');
  }
  if (payload.aud !== clientId) throw new TokenError('這個 token 不是發給這個遊戲的');
  if (typeof payload.iss !== 'string' || !ISSUERS.includes(payload.iss)) throw new TokenError('這個 token 不是 Google 發的');
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < now) throw new TokenError('登入已經過期，請重新登入');
  if (typeof payload.sub !== 'string' || payload.sub === '') throw new TokenError('token 裡沒有帳號 id');
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  return { sub: payload.sub, email: text(payload.email), name: text(payload.name), picture: text(payload.picture) };
}

/** 抓 Google 的公鑰並快取；過期或遇到不認得的 kid 就重抓。 */
export function googleVerifier(clientId: string, fetchKeys: () => Promise<{ keys: Jwk[]; maxAge: number }> = fetchGoogleKeys) {
  let cache: { keys: Jwk[]; until: number } | null = null;
  const load = async (force: boolean) => {
    if (!force && cache && cache.until > Date.now()) return cache.keys;
    const { keys, maxAge } = await fetchKeys();
    cache = { keys, until: Date.now() + maxAge * 1000 };
    return keys;
  };
  return async (token: string): Promise<GoogleIdentity> => {
    try {
      return verifyIdToken(token, clientId, await load(false));
    } catch (error) {
      // Google 換了公鑰：重抓一次再試。
      if (error instanceof TokenError && error.message === '找不到簽章用的公鑰') return verifyIdToken(token, clientId, await load(true));
      throw error;
    }
  };
}

async function fetchGoogleKeys(): Promise<{ keys: Jwk[]; maxAge: number }> {
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error(`抓 Google 公鑰失敗：${response.status}`);
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  const { keys } = (await response.json()) as { keys: Jwk[] };
  return { keys, maxAge };
}

import type { IncomingMessage } from 'node:http';

// 流量限制：同一個來源（IP）在一段時間內能做幾次。擋的是一台電腦寫個小程式狂送請求就能讓伺服器卡住的那種攻擊
// （狂登入吃光 CPU、狂註冊把帳號撐爆、狂開房間吃光記憶體）；大流量的 DDoS 交給前面的 Cloudflare。

/**
 * 令牌桶：每個 key 最多存 capacity 個令牌，每 refillMs 補一個；做一次事花一個，沒有就擋。
 * 平常偶爾用不會碰到，短時間連續打才會被擋。
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** 花一個令牌；沒有了回傳 false。 */
  take(key: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    const refilled = Math.min(this.capacity, bucket.tokens + (now - bucket.at) / this.refillMs);
    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, at: now });
      return false;
    }
    this.buckets.set(key, { tokens: refilled - 1, at: now });
    // 桶子太多就清掉已經補滿的（補滿的跟沒記一樣）。
    if (this.buckets.size > 10_000) this.sweep(now);
    return true;
  }

  /** 還有沒有令牌（不花）。 */
  allows(key: string): boolean {
    const bucket = this.buckets.get(key);
    return bucket === undefined || bucket.tokens + (this.now() - bucket.at) / this.refillMs >= 1;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + (now - bucket.at) / this.refillMs >= this.capacity) this.buckets.delete(key);
    }
  }
}

/** 每分鐘 n 次（可以一次連續用完）。 */
export const perMinute = (n: number, now?: () => number) => new RateLimiter(n, 60_000 / n, now);
/** 每小時 n 次。 */
export const perHour = (n: number, now?: () => number) => new RateLimiter(n, 3_600_000 / n, now);

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * 請求的來源 IP。伺服器只接受本機連線，外面的人都是透過 Cloudflare 通道（cloudflared）進來的，
 * 看到的 IP 都是 127.0.0.1；真正的 IP 在 Cloudflare 加的 CF-Connecting-IP 標頭裡。
 * 只有從本機來的請求才相信這個標頭（不然任何人都能自己填一個假的）。
 */
export function clientIp(request: IncomingMessage): string {
  const remote = request.socket.remoteAddress ?? 'unknown';
  if (!LOOPBACK.has(remote)) return remote;
  const forwarded = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || remote;
}

/** 伺服器用的各種上限（集中在這裡，要調比較好找）。 */
export const LIMITS = {
  /** 所有 API：每個 IP 每分鐘 120 次。 */
  api: () => perMinute(120),
  /** 名字＋密碼、Google 登入：每個 IP 每分鐘 10 次（算密碼很吃 CPU）。 */
  login: () => perMinute(10),
  /** 開新帳號：每個 IP 每小時 10 個（試玩會時同一個網路的人一起開也夠）。 */
  register: () => perHour(10),
  /** 同一個名字登入失敗：每 15 分鐘 10 次（防猜密碼）。 */
  failedLogin: () => new RateLimiter(10, 90_000),
  /** 網頁檔案：每個 IP 每分鐘 600 個（卡圖很多）。 */
  files: () => perMinute(600),
  /** 同一個 IP 同時最多幾條連線對戰的連線。 */
  socketsPerIp: 10,
  /** 開房間：每個 IP 每分鐘 10 間。 */
  rooms: () => perMinute(10),
  /** 每條連線每秒最多約 10 則訊息（可以連續 30 則）。 */
  messages: () => new RateLimiter(30, 100),
  /** 聊天：每條連線每 2 秒 1 則（可以連續 5 則）。 */
  chat: () => new RateLimiter(5, 2000),
  /** 伺服器上最多幾間房間；滿了就不能再開。 */
  maxRooms: 3000,
} as const;

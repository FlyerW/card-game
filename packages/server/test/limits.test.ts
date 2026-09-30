import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientIp, RateLimiter } from '../src/limits';
import { startServer } from '../src/server';

describe('流量限制', () => {
  it('令牌桶：可以連續用完，之後照速度慢慢補回來；不同來源分開算', () => {
    let now = 0;
    const limit = new RateLimiter(3, 1000, () => now);
    expect([limit.take('a'), limit.take('a'), limit.take('a'), limit.take('a')]).toEqual([true, true, true, false]);
    expect(limit.take('b')).toBe(true);
    expect(limit.allows('a')).toBe(false);
    now = 1000;
    expect(limit.allows('a')).toBe(true);
    expect([limit.take('a'), limit.take('a')]).toEqual([true, false]);
  });

  it('來源 IP：本機來的才相信 Cloudflare 的標頭；外面直接連的用連線的 IP', () => {
    const request = (remoteAddress: string, headers: Record<string, string>) => ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage;
    expect(clientIp(request('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' }))).toBe('1.2.3.4');
    expect(clientIp(request('::1', { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }))).toBe('5.6.7.8');
    expect(clientIp(request('9.9.9.9', { 'cf-connecting-ip': '1.2.3.4' }))).toBe('9.9.9.9');
    expect(clientIp(request('127.0.0.1', {}))).toBe('127.0.0.1');
  });

  it('同一個 IP 狂登入會被擋（429）；別的 IP 不受影響', async () => {
    const running = await startServer({ port: 0, host: '127.0.0.1', dataDir: null });
    try {
      const login = (ip: string) =>
        fetch(`http://127.0.0.1:${running.port}/api/login/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
          body: JSON.stringify({ name: 'nobody', password: 'wrong-password', create: false }),
        }).then((response) => response.status);
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push(await login('1.1.1.1'));
      expect(statuses.slice(0, 10).every((status) => status === 404)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      expect(await login('2.2.2.2')).toBe(404);
    } finally {
      await running.close();
    }
  });
});

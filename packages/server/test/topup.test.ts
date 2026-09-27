import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '@card-game/economy';
import { checkMacValue, ECPAY_TEST, readNotice } from '../src/ecpay';
import { startServer, type Running } from '../src/server';

// 儲值（綠界）：建立訂單、驗證付款通知、加金幣只加一次。

describe('綠界檢查碼', () => {
  it('跟綠界官方 Python SDK 算出來的一樣（中文、空白、引號、括號都要對）', () => {
    const params = {
      MerchantID: '3002607', MerchantTradeNo: 'CGTEST0001', MerchantTradeDate: '2026/09/27 15:30:00', PaymentType: 'aio',
      TotalAmount: '150', TradeDesc: '卡牌遊戲金幣', ItemName: '遊戲金幣 500 枚 (test)*', ReturnURL: 'https://example.com/api/ecpay/notify',
      ChoosePayment: 'ALL', EncryptType: '1', ClientBackURL: "https://example.com/?topup=CGTEST0001&x=a b'c~d",
    };
    // 用 ECPay/ECPayAIO_Python 的 generate_check_value 算的。
    expect(checkMacValue(params, ECPAY_TEST)).toBe('9FB3945147093D7B05A4CAC13619C0C1BB85899B4F5A0B96240DDC1749F9F81A');
  });

  it('正式環境不接受模擬付款；付款失敗不算', () => {
    const production = { ...ECPAY_TEST, stage: false };
    const notice = (extra: Record<string, string>, config = production) => {
      const fields = { MerchantID: config.merchantId, MerchantTradeNo: 'CGX', RtnCode: '1', TradeAmt: '30', TradeNo: 'T1', SimulatePaid: '0', ...extra };
      return readNotice(config, { ...fields, CheckMacValue: checkMacValue(fields, config) });
    };
    expect(notice({}).paid).toMatchObject({ tradeNo: 'CGX', amount: 30 });
    expect(notice({ SimulatePaid: '1' }).paid).toBeNull();
    expect(notice({ SimulatePaid: '1' }, ECPAY_TEST).paid).not.toBeNull();
    expect(notice({ RtnCode: '10100058' }).paid).toBeNull();
    expect(readNotice(production, { MerchantID: production.merchantId, CheckMacValue: 'BAD' }).valid).toBe(false);
  });
});

describe('儲值 API', () => {
  let running: Running;
  let base: string;

  beforeAll(async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', ecpay: ECPAY_TEST });
    base = `http://127.0.0.1:${running.port}`;
  });
  afterAll(() => running.close());

  const call = async (path: string, init: { token?: string; body?: unknown } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://game.example.com', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  };
  const notify = async (fields: Record<string, string>) => {
    const response = await fetch(`${base}/api/ecpay/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, CheckMacValue: checkMacValue(fields, ECPAY_TEST) }).toString(),
    });
    return { status: response.status, text: await response.text() };
  };

  it('建立訂單 → 綠界通知付款成功 → 加金幣；重送通知不會再加', async () => {
    expect((await call('/api/config')).json.topup).toBe(true);
    const token = (await call('/api/login/password', { body: { name: '課金的人', password: 'secret-123', create: true } })).json.token as string;
    const order = await call('/api/topup', { token, body: { topup: 'gold-500' } });
    expect(order.status).toBe(200);
    expect(order.json.action).toBe('https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5');
    const fields = order.json.fields as Record<string, string>;
    expect(fields).toMatchObject({ MerchantID: '3002607', TotalAmount: '150', ReturnURL: 'https://game.example.com/api/ecpay/notify' });
    expect(fields.CheckMacValue).toBe(checkMacValue(fields, ECPAY_TEST));
    expect((await call('/api/topup/status', { token, body: { tradeNo: order.json.tradeNo } })).json.status).toBe('pending');

    const paid = { MerchantID: '3002607', MerchantTradeNo: order.json.tradeNo as string, RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2609271530001', TradeAmt: '150', PaymentType: 'Credit_CreditCard', SimulatePaid: '0' };
    expect(await notify({ ...paid, TradeAmt: '30' })).toEqual({ status: 200, text: '1|OK' }); // 金額不合：不加
    expect((await call('/api/me', { token })).json.profile.gold).toBe(ECONOMY.startingGold);
    expect(await notify(paid)).toEqual({ status: 200, text: '1|OK' });
    expect(await notify(paid)).toEqual({ status: 200, text: '1|OK' });
    expect((await call('/api/me', { token })).json.profile.gold).toBe(ECONOMY.startingGold + 500);
    expect((await call('/api/topup/status', { token, body: { tradeNo: order.json.tradeNo } })).json.status).toBe('paid');
  });

  it('檢查碼不對不收；沒有的方案、別人的訂單都不行', async () => {
    const bad = await fetch(`${base}/api/ecpay/notify`, { method: 'POST', body: 'MerchantID=3002607&RtnCode=1&CheckMacValue=BAD' });
    expect(bad.status).toBe(400);
    const token = (await call('/api/login/password', { body: { name: '另一個人', password: 'secret-123', create: true } })).json.token as string;
    expect((await call('/api/topup', { token, body: { topup: 'gold-999999' } })).status).toBe(400);
    expect((await call('/api/topup/status', { token, body: { tradeNo: 'CGNOPE' } })).status).toBe(404);
  });
});

describe('沒設定綠界', () => {
  it('不開放儲值', async () => {
    const running = await startServer({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${running.port}`;
    expect(((await (await fetch(`${base}/api/config`)).json()) as { topup: boolean }).topup).toBe(false);
    await running.close();
  });
});

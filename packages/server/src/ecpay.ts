import { createHash, randomInt } from 'node:crypto';

// 綠界 ECPay 全方位金流（AIO）：建立付款表單、驗證付款結果通知。
// 檢查碼（CheckMacValue）照綠界官方 SDK 的算法：參數照名稱排序（不分大小寫），前面加 HashKey、後面加 HashIV，
// 整串做 URL 編碼（空白變 +，-_.!*()~ 不編碼），轉小寫，再做 SHA256，轉大寫。

export interface EcpayConfig {
  merchantId: string;
  hashKey: string;
  hashIv: string;
  /** 測試環境：付款網址不同，也接受綠界後台的「模擬付款」。 */
  stage: boolean;
}

/** 綠界公開的測試帳號（官方 SDK 範例用的），只能打測試環境。 */
export const ECPAY_TEST: EcpayConfig = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIv: 'EkRm7iFT261dpevs', stage: true };

export const checkoutUrl = (config: EcpayConfig) =>
  config.stage ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5' : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

/** 從環境變數讀設定：ECPAY_TEST=1 用公開的測試帳號；正式的要設 ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV。 */
export function ecpayFromEnv(env: NodeJS.ProcessEnv): EcpayConfig | null {
  if (env.ECPAY_MERCHANT_ID && env.ECPAY_HASH_KEY && env.ECPAY_HASH_IV) {
    return { merchantId: env.ECPAY_MERCHANT_ID, hashKey: env.ECPAY_HASH_KEY, hashIv: env.ECPAY_HASH_IV, stage: env.ECPAY_STAGE === '1' };
  }
  return env.ECPAY_TEST === '1' ? ECPAY_TEST : null;
}

/** 跟 Python 的 quote_plus(safe='-_.!*()') 一樣：encodeURIComponent 另外會留下 '，要補編碼；空白變 +。 */
const urlEncode = (text: string) => encodeURIComponent(text).replace(/'/g, '%27').replace(/%20/g, '+');

export function checkMacValue(params: Record<string, string>, config: Pick<EcpayConfig, 'hashKey' | 'hashIv'>): string {
  const pairs = Object.entries(params)
    .filter(([key]) => key !== 'CheckMacValue')
    .sort(([a], [b]) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  const raw = `HashKey=${config.hashKey}&${pairs.join('&')}&HashIV=${config.hashIv}`;
  return createHash('sha256').update(urlEncode(raw).toLowerCase(), 'utf8').digest('hex').toUpperCase();
}

/** 訂單編號：英數字、20 字以內、不重複。 */
export const newTradeNo = (now = Date.now()) =>
  `CG${now.toString(36).toUpperCase()}${Array.from({ length: 6 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[randomInt(34)]).join('')}`;

/** 綠界要的交易時間：台灣時間 yyyy/MM/dd HH:mm:ss。 */
export function tradeDate(now = Date.now()): string {
  const t = new Date(now + 8 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}

export interface CheckoutOrder {
  tradeNo: string;
  amount: number;
  itemName: string;
  /** 綠界付款完成後從他們的伺服器通知這個網址。 */
  returnUrl: string;
  /** 付款頁上「返回商店」回到這裡。 */
  clientBackUrl: string;
  now?: number;
}

/** 付款表單的欄位（含檢查碼），瀏覽器用 POST 送到 checkoutUrl。 */
export function checkoutFields(config: EcpayConfig, order: CheckoutOrder): Record<string, string> {
  const fields: Record<string, string> = {
    MerchantID: config.merchantId,
    MerchantTradeNo: order.tradeNo,
    MerchantTradeDate: tradeDate(order.now),
    PaymentType: 'aio',
    TotalAmount: String(order.amount),
    TradeDesc: '卡牌遊戲金幣',
    ItemName: order.itemName,
    ReturnURL: order.returnUrl,
    ClientBackURL: order.clientBackUrl,
    ChoosePayment: 'ALL',
    EncryptType: '1',
  };
  return { ...fields, CheckMacValue: checkMacValue(fields, config) };
}

export interface PaidNotice {
  tradeNo: string;
  amount: number;
  /** 綠界的交易編號。 */
  ecpayTradeNo: string;
  simulated: boolean;
}

/**
 * 綠界的付款結果通知：檢查碼對、商店代號對、付款成功（RtnCode 1）才回傳付款資料。
 * 正式環境不接受後台的「模擬付款」。其他情況回傳 null（檢查碼不對要回錯誤，其餘照樣回 1|OK）。
 */
export function readNotice(config: EcpayConfig, fields: Record<string, string>): { valid: boolean; paid: PaidNotice | null } {
  if (!fields.CheckMacValue || fields.CheckMacValue.toUpperCase() !== checkMacValue(fields, config)) return { valid: false, paid: null };
  if (fields.MerchantID !== config.merchantId) return { valid: false, paid: null };
  const simulated = fields.SimulatePaid === '1';
  if (fields.RtnCode !== '1' || (simulated && !config.stage)) return { valid: true, paid: null };
  const amount = Number(fields.TradeAmt);
  if (!fields.MerchantTradeNo || !Number.isInteger(amount)) return { valid: true, paid: null };
  return { valid: true, paid: { tradeNo: fields.MerchantTradeNo, amount, ecpayTradeNo: fields.TradeNo ?? '', simulated } };
}

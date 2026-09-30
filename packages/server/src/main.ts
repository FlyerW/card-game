// 啟動連線對戰伺服器。用法：npm run server（會先打包網頁），或 PORT=9000 npm run server
// Google 登入：GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com npm run server（怎麼申請見 README）
// 帳號資料預設存在專案的 data/ 資料夾，DATA_DIR 可以換地方。
// 儲值（綠界）：ECPAY_TEST=1 用綠界公開的測試帳號；正式的設 ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV（見 README）。
// HOST：預設只接受本機連線（外面的人透過 Cloudflare 通道進來，Cloudflare 會先擋掉大流量攻擊）；
// 要讓同一個網路的朋友直接連，HOST=0.0.0.0。
import './quiet-warnings';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ecpayFromEnv } from './ecpay';
import { startServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST?.trim() || '127.0.0.1';
const localOnly = host === '127.0.0.1' || host === 'localhost' || host === '::1';
const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../../../data/', import.meta.url));
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
const ecpay = ecpayFromEnv(process.env);
const publicUrl = process.env.PUBLIC_URL?.trim() || null;
// CARD_PREVIEW=1：預覽還沒發布的卡包系列（開得到、組得到）。
const preview = process.env.CARD_PREVIEW === '1';
const { port: bound } = await startServer({ port, host, dataDir, googleClientId, ecpay, publicUrl, preview });
if (preview) console.log('預覽模式：還沒發布的卡包系列也開放。');

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => `http://${net!.address}:${bound}`);

console.log(`連線對戰伺服器已啟動：http://localhost:${bound}`);
console.log(`帳號資料存在 ${dataDir}（accounts.sqlite，每天備份到 backups/）；名字＋密碼帳號可以打排位賽。`);
console.log(googleClientId ? 'Google 登入已開啟。' : 'Google 登入沒開（沒有設定 GOOGLE_CLIENT_ID），可以用名字＋密碼帳號或測試帳號。');
console.log(ecpay ? `儲值已開啟（綠界${ecpay.stage ? '測試環境' : '正式環境'}，商店代號 ${ecpay.merchantId}）。` : '儲值沒開（沒有設定綠界）。');
if (localOnly) {
  console.log('只接受本機連線：外面的人透過 Cloudflare 通道進來（見 README）。要讓同一個網路的朋友直接連，用 HOST=0.0.0.0 開。');
} else {
  if (lan.length > 0) console.log(`同一個網路的朋友可以開：${lan.join('、')}`);
  console.log('朋友在別的地方的話，要把這個埠開放到外網，或用 cloudflared 之類的通道，見 README。');
}

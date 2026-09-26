// 啟動連線對戰伺服器。用法：npm run server（會先打包網頁），或 PORT=9000 npm run server
// Google 登入：GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com npm run server（怎麼申請見 README）
// 帳號資料預設存在專案的 data/ 資料夾，DATA_DIR 可以換地方。
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../../../data/', import.meta.url));
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
const { port: bound } = await startServer({ port, dataDir, googleClientId });

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => `http://${net!.address}:${bound}`);

console.log(`連線對戰伺服器已啟動：http://localhost:${bound}`);
console.log(`帳號資料存在 ${dataDir}；名字＋密碼帳號可以打排位賽。`);
console.log(googleClientId ? 'Google 登入已開啟。' : 'Google 登入沒開（沒有設定 GOOGLE_CLIENT_ID），可以用名字＋密碼帳號或測試帳號。');
if (lan.length > 0) console.log(`同一個網路的朋友可以開：${lan.join('、')}`);
console.log('朋友在別的地方的話，要把這個埠開放到外網，或用 cloudflared 之類的通道，見 README。');

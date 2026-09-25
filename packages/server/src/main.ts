// 啟動連線對戰伺服器。用法：npm run server（會先打包網頁），或 PORT=9000 npm run server
import { networkInterfaces } from 'node:os';
import { startServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const { port: bound } = await startServer({ port });

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => `http://${net!.address}:${bound}`);

console.log(`連線對戰伺服器已啟動：http://localhost:${bound}`);
if (lan.length > 0) console.log(`同一個網路的朋友可以開：${lan.join('、')}`);
console.log('朋友在別的地方的話，要把這個埠開放到外網，或用 cloudflared 之類的通道，見 README。');

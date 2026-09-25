// worker 不會繼承主程式的 tsx 載入器，所以入口用普通的 JavaScript，
// 在這裡註冊 tsx 之後，再載入 TypeScript 寫的 worker。
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');

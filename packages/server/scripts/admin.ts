// 管理帳號：看所有帳號、把帳號設成超級帳號（金幣用不完、全卡）。
// 用法：
//   npm run admin -- list                  列出所有帳號（伺服器開著也可以看）
//   npm run admin -- unlimited Flyer       設成超級帳號（要先停掉伺服器）
//   npm run admin -- unlimited Flyer off   取消超級帳號
// 帳號檔預設是專案的 data/accounts.json，DATA_DIR 可以換地方；PORT 是伺服器的埠（檢查它有沒有開著）。
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Account, Order } from '../src/accounts';

const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../../../data/', import.meta.url));
const file = join(dataDir, 'accounts.json');
const port = Number(process.env.PORT ?? 8787);
const [command, who, flag] = process.argv.slice(2);

interface Data {
  accounts: Record<string, Account>;
  sessions: Record<string, unknown>;
  orders: Record<string, Order>;
}
const data = JSON.parse(await readFile(file, 'utf8')) as Data;
const accounts = Object.values(data.accounts);

/** 伺服器開著的話，帳號都在它的記憶體裡，改檔案會被它蓋掉。 */
async function serverRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** 用名字或帳號 id 找帳號；同名的有好幾個就要用 id。 */
function find(key: string): Account {
  const byId = data.accounts[key];
  if (byId) return byId;
  const named = accounts.filter((account) => account.name === key);
  if (named.length === 1) return named[0]!;
  if (named.length === 0) throw new Error(`找不到「${key}」。用 npm run admin -- list 看有哪些帳號。`);
  throw new Error(`有 ${named.length} 個帳號叫「${key}」，請改用 id：${named.map((account) => account.id).join('、')}`);
}

async function save(): Promise<void> {
  // 備份檔名用這台機器的當地時間，例如 accounts.backup-20260927-1835-admin.json。
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
  const backup = join(dataDir, `accounts.backup-${stamp}-admin.json`);
  await copyFile(file, backup);
  // 跟伺服器一樣：先寫暫存檔再換名字，寫到一半當掉也不會壞掉。
  await writeFile(`${file}.tmp`, JSON.stringify(data));
  await rename(`${file}.tmp`, file);
  console.log(`已存檔；改之前的備份在 ${backup}`);
}

if (command === 'list') {
  const paid = (id: string) =>
    Object.values(data.orders ?? {})
      .filter((order) => order.accountId === id && order.status === 'paid')
      .reduce((sum, order) => sum + order.amount, 0);
  console.log(['名字', '帳號 id', '登入方式', '金幣', '粉塵', '卡（種）', '儲值 NT$', '建立時間', ''].join('\t'));
  for (const account of accounts) {
    const kind = account.id.startsWith('google:') ? 'Google' : account.password ? '名字＋密碼' : '訪客';
    const collection = Object.values(account.profile.collection);
    const cards = `${collection.reduce((sum, n) => sum + n, 0)}（${collection.filter((n) => n > 0).length}）`;
    const row = [account.name, account.id, kind, account.profile.gold, account.profile.dust, cards, paid(account.id), account.createdAt.slice(0, 10)];
    console.log([...row, account.unlimited ? '超級帳號' : ''].join('\t'));
  }
} else if (command === 'unlimited' && who) {
  if (await serverRunning()) {
    console.error(`伺服器還開著（埠 ${port}）。先停掉再改，不然會被伺服器蓋掉：tmux 裡按 Ctrl+C，或 tmux kill-window -t card-game:server`);
    process.exit(1);
  }
  const account = find(who);
  const on = flag !== 'off';
  if (on) account.unlimited = true;
  else delete account.unlimited;
  await save();
  console.log(on ? `「${account.name}」現在是超級帳號：下次開伺服器時自動補滿金幣與全卡。` : `「${account.name}」不再是超級帳號（已經有的金幣和卡保留）。`);
} else {
  console.log('用法：npm run admin -- list | unlimited <名字或 id> [off]');
  process.exit(command ? 1 : 0);
}

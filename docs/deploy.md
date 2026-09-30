# 上線與維運

現在的做法、承載量、安全措施，以及正式上線時搬到固定主機的步驟。

## 現在：這台機器＋Cloudflare 免費通道

`scripts/deploy.sh` 在 tmux 裡開兩個視窗：

- `server`：`scripts/serve.sh`，當掉會自動重開（2 秒後，連續當掉越等越久，最多 60 秒）。紀錄在 `logs/server.log`。
- `tunnel`：`cloudflared tunnel --url http://localhost:8787`，給一個 `https://xxxx.trycloudflare.com` 網址（每次重開通道網址會變）。

伺服器**只接受本機連線**（`HOST` 預設 `127.0.0.1`），外面的人都從 Cloudflare 通道進來：

- Cloudflare 會先擋掉大流量的 DDoS，攻擊者也拿不到這台機器的 IP 直接打。
- 伺服器從 Cloudflare 加的 `CF-Connecting-IP` 標頭認出真正的來源 IP（只相信從本機來的請求），流量限制照這個算。
- 要讓同一個網路的朋友直接連（不經過通道），用 `HOST=0.0.0.0` 開。

## 承載量（2026-09-30 實測）

假玩家隨機出牌、每人每秒一個動作（比真人快很多），伺服器單一程序：

| 同時對戰 | 回應時間（中位數／最慢） | 伺服器 CPU |
|---|---|---|
| 100 人 | 4／16 毫秒 | 約 1/4 顆核心 |
| 1000 人 | 1／13 毫秒 | 約半顆 |
| 2000 人 | 2／778 毫秒 | 約 1 顆（到頂） |

- 單顆核心每秒大約處理 1500 個對戰動作；真人大約 3–5 秒一個動作，幾千人同時連線對戰才會卡。
- 跟電腦打在玩家的瀏覽器裡跑，不吃伺服器。
- 記憶體大約 150–200 MB。

## 安全措施

**流量限制**（`packages/server/src/limits.ts`，每個來源 IP 分開算）：

| 項目 | 上限 |
|---|---|
| 所有 API | 每分鐘 120 次 |
| 登入（名字＋密碼、Google） | 每分鐘 10 次 |
| 開新帳號 | 每小時 10 個 |
| 同一個名字登入失敗 | 15 分鐘 10 次（防猜密碼） |
| 網頁檔案（含卡圖） | 每分鐘 600 個 |
| 連線對戰的連線 | 同時 10 條 |
| 開房間 | 每分鐘 10 間；整台伺服器最多 3000 間 |
| 連線對戰的訊息 | 每條連線每秒約 10 則 |
| 聊天 | 每條連線每 2 秒 1 則（可以連續 5 則） |

超過回 429「太頻繁了，請等一下再試」。

**其他**

- 密碼用 scrypt 雜湊，在背景執行緒算（以前是同步的，每次卡住整個伺服器約 20 毫秒，狂登入就能讓遊戲停擺）。
- 帳號資料存在 SQLite（`data/accounts.sqlite`）：改了哪個帳號只寫那一列。以前整份 `accounts.json` 重寫，
  5000 個帳號一次要卡住 65 毫秒、2 萬個要 0.3 秒。舊的 `accounts.json` 第一次開伺服器時自動搬進去，原檔改名留著。
- 每天自動備份一份到 `data/backups/accounts-YYYYMMDD.sqlite`，留 14 天。還原：停掉伺服器，把備份檔複製成 `data/accounts.sqlite`。
- 請求大小上限：API 16 KB、連線對戰的訊息 64 KB。
- session token 只存雜湊；瀏覽器看不到對手的手牌與牌庫順序（伺服器只送各自的視角）。

## 搬到固定的主機

試玩用現在的做法就夠了。正式上線（收真錢、公開宣傳）要搬到一台一直開著的主機，網址也要固定：

1. **主機**：一台小的雲端主機（VPS）就夠，1 顆 CPU、1 GB 記憶體，裝 Node 22。
2. **程式**：
   ```bash
   git clone <repo> /srv/card-game && cd /srv/card-game
   npm ci && npm run build:web
   ```
3. **資料**：把這台機器的 `data/accounts.sqlite`（連同 `data/games.jsonl`、`data/secrets.env`）複製過去。先停掉這邊的伺服器再複製。
4. **開機自動啟動、當掉自動重開**：用 `deploy/card-game.service`（systemd）：
   ```bash
   sudo cp deploy/card-game.service /etc/systemd/system/
   sudo systemctl enable --now card-game
   journalctl -u card-game -f   # 看紀錄
   ```
5. **固定網址**：兩種做法擇一
   - Cloudflare 具名通道（需要 Cloudflare 帳號與一個網域）：網址固定，一樣有 Cloudflare 擋 DDoS，主機不用開任何埠。
   - 主機前面放 Caddy 自動申請 HTTPS 憑證；這樣主機的 IP 是公開的，建議再把網域的 DNS 放到 Cloudflare 代理。
6. **綠界正式環境**：金鑰寫進 `data/secrets.env`，設 `PUBLIC_URL=https://你的網址`（付款通知要送回固定的網址）。

要決定的是用哪家主機、要不要買網域；決定了再照上面做。

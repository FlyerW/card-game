# card-game

一款線上對戰卡牌遊戲。骨架來自寶可夢卡牌，差別在於能量屬於玩家：每位玩家有自己的能量池，
召喚生物、使用技能、施放法術都從池裡付費；每位玩家有一名英雄，英雄的顏色決定牌組能放哪些卡，
英雄被打倒就輸。遊戲名稱暫定。

> **這是大縮模實驗分支**（`claude/hearthstone-scale`）：生物有攻擊力，每回合可以免費攻擊（會被反擊）或花能量發動技能，
> 數字跟爐石一樣（攻擊 = 費用、HP = 費用 + 1）；牌組 30 張、同名最多 2 張、UR 最多 1 張，最多進化一次、進化線照 2/2 帶。規則見 [docs/design.md 的「大縮模實驗」](docs/design.md#大縮模實驗這個分支)。

## 目前進度

- [x] 規則設計：[docs/design.md](docs/design.md)（v0.8）
- [x] 規則引擎：[`packages/engine`](packages/engine)，包括異常狀態、吸血與再生；全部 183 個測試
- [x] 平衡模擬：[`packages/sim`](packages/sim)，讓機器人大量對打，比較不同規則、估算一局要打多久。結果見 [docs/balance-results.md](docs/balance-results.md)
- [x] 網頁試玩版：[`packages/web`](packages/web)，跟電腦對戰，可以自己組牌。引擎和電腦對手都在瀏覽器裡跑，不需要伺服器
- [x] 伺服器：兩人連線對戰（[`packages/server`](packages/server)），見下面「跟朋友連線對戰」
- [ ] 網頁客戶端
- [ ] 帳號、配對；牌組存到伺服器（試玩版的牌組先存在瀏覽器裡）

範例卡牌見 [docs/cards.md](docs/cards.md)。

## 開發

需要 Node 22 以上。

```bash
npm install
npm test            # 全部測試
npm run typecheck   # 型別檢查
npm run cards       # 從卡牌資料重新產生 docs/cards.md
npm run sim         # 平衡模擬，16 個 worker 約 8 分鐘（核心少會久很多）；結果寫到 docs/balance-results.md
npm run sim -- --games 200   # 快速試跑
npm run dev         # 網頁試玩版的開發伺服器，改程式碼會即時更新
npm run build:web   # 打包網頁版；dist/artifact.html 是可以直接發布的單一檔案
npm run server      # 連線對戰伺服器（會先打包網頁），預設 http://localhost:8787
```

## 跟朋友連線對戰

```bash
npm install
npm run server                 # 預設埠 8787；要換埠：PORT=9000 npm run server
```

1. 自己打開 http://localhost:8787 ，輸入名字、選英雄（可以先組牌），按「開房間跟朋友打」。
2. 把房號或邀請連結傳給朋友。朋友要連得到你的伺服器：
   - **同一個網路**（同一個 Wi-Fi）：用終端機印出的區網網址，例如 `http://192.168.1.23:8787`
   - **不同地方**：用免費通道把這個埠開到外網。例如 Cloudflare 的 quick tunnel，
     在跑伺服器的那台電腦上執行：
     ```bash
     cloudflared tunnel --url http://localhost:8787
     ```
     它會印出一個 `https://xxxx.trycloudflare.com` 網址，你和朋友都開這個網址（WebSocket 也通）。
     伺服器跑在遠端機器（例如用 VS Code SSH 連的主機）也一樣，通道在那台機器上開就好。
     用 ngrok 也可以：`ngrok http 8787`。
3. 朋友打開連結、選好英雄按「加入」，對局就開始。對局結束後雙方都按「再來一局」就開新的一局。

- 伺服器握有唯一的真實狀態：每個動作都由規則引擎驗證，雙方只收到自己看得到的部分，看不到對手的手牌。
- 斷線或重新整理頁面會自動回到原本的座位。
- 房間與對局只存在伺服器的記憶體裡：伺服器重開，進行中的對局就沒了。沒有人連著的房間 30 分鐘後收掉。
- 發布在 claude.ai 的試玩版只能跟電腦打；連線對戰要從這個伺服器打開網頁。

## 新增或修改卡牌

卡牌是資料，不寫死在程式裡。改 [`packages/engine/src/cards/sample.ts`](packages/engine/src/cards/sample.ts) 之後：

1. `npm test`——資料有錯會列出所有問題，例如進化來源不存在、R 卡少於兩個技能、
   進化沒有升一級稀有度、位置技能放到法術上
2. `npm run cards`——更新 docs/cards.md

## 結構

```
docs/
├── design.md             規則設計文件
├── board.svg             場上配置圖（由 scripts/board-svg.py 產生）
├── cards.md              範例卡牌（自動產生，請勿手動編輯）
└── balance-results.md    平衡模擬結果（自動產生，請勿手動編輯）

packages/engine/          規則引擎：純函式庫，不碰網路也不碰畫面
├── src/
│   ├── types.ts          卡牌資料、遊戲狀態、動作、事件的型別
│   ├── engine.ts         建立對局、執行動作、列出合法動作、重播
│   ├── targeting.ts      目標判定：位置技能、挑釁
│   ├── resolve.ts        效果結算、異常狀態、吸血與再生、擊倒判定
│   ├── db.ts             卡牌資料驗證
│   ├── deck.ts           牌組驗證、英雄能用的卡池
│   ├── view.ts           玩家視角：隱藏對手手牌與牌庫順序
│   ├── describe.ts       由資料產生卡面文字
│   ├── rules.ts          規則參數（牌組張數、能量制度……）
│   └── cards/sample.ts   範例卡牌
├── scripts/cards-md.ts   產生 docs/cards.md
└── test/                 測試用的是獨立的測試卡，調整範例卡的平衡不會讓測試壞掉

packages/sim/             平衡模擬
├── src/bot.ts            機器人：貪婪策略與局面評分，三種打法
├── src/deck.ts           自動組牌：進化線照 3/2/1 帶
├── src/experiments.ts    實驗設定：比較哪些規則、牌組怎麼組
├── src/match.ts          打一局
├── src/pace.ts           用動作數估算真人一局要打多久
└── src/run.ts            多程序平行跑大量對局，統計並寫出報告

packages/server/          連線對戰伺服器（Node + WebSocket），也負責提供網頁
├── src/lobby.ts          房間與對局：驗證動作、分別送出各自的視角
├── src/protocol.ts       伺服器與網頁之間的訊息格式
├── src/server.ts         HTTP 與 WebSocket
└── src/main.ts           npm run server 的進入點

packages/web/             網頁試玩版（Vite）
├── src/main.ts           牌桌畫面與操作；能點的東西全部由引擎的合法動作推出來
├── src/deck-builder.ts   組牌畫面，牌組存在瀏覽器裡
├── src/online.ts         連線對戰：連到伺服器、斷線自動回到座位
├── src/log.ts            把引擎事件翻成對戰紀錄
├── src/ui.ts             共用的小工具
├── src/style.css         牌桌樣式，配色沿用 docs/board.svg
└── scripts/artifact.mjs  把打包結果合成單一 HTML 檔
```

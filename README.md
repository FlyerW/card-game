# card-game

一款線上對戰卡牌遊戲。骨架來自寶可夢卡牌，差別在於能量屬於玩家：每位玩家有自己的能量池，
召喚生物、使用技能、施放法術都從池裡付費；每位玩家有一名英雄，英雄的顏色決定牌組能放哪些卡，
英雄被打倒就輸。遊戲名稱暫定。

## 目前進度

- [x] 規則設計：[docs/design.md](docs/design.md)（v0.5）
- [x] 規則引擎：[`packages/engine`](packages/engine)，102 個測試
- [x] 平衡模擬：[`packages/sim`](packages/sim)，讓機器人大量對打，比較不同規則。結果見 [docs/balance-results.md](docs/balance-results.md)
- [x] 網頁試玩版：[`packages/web`](packages/web)，跟電腦對戰。引擎和電腦對手都在瀏覽器裡跑，不需要伺服器
- [ ] 伺服器：兩人連線對戰
- [ ] 網頁客戶端
- [ ] 帳號、牌組編輯、配對

範例卡牌見 [docs/cards.md](docs/cards.md)。

## 開發

需要 Node 22 以上。

```bash
npm install
npm test            # 全部測試
npm run typecheck   # 型別檢查
npm run cards       # 從卡牌資料重新產生 docs/cards.md
npm run sim         # 平衡模擬，約 10 分鐘；結果寫到 docs/balance-results.md
npm run sim -- --games 200   # 快速試跑
npm run dev         # 網頁試玩版的開發伺服器，改程式碼會即時更新
npm run build:web   # 打包網頁版；dist/artifact.html 是可以直接發布的單一檔案
```

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
│   ├── resolve.ts        效果結算、擊倒判定
│   ├── db.ts             卡牌資料驗證
│   ├── deck.ts           牌組驗證
│   ├── view.ts           玩家視角：隱藏對手手牌與牌庫順序
│   ├── describe.ts       由資料產生卡面文字
│   ├── rules.ts          規則參數（牌組張數、能量制度……）
│   └── cards/sample.ts   範例卡牌
├── scripts/cards-md.ts   產生 docs/cards.md
└── test/                 測試用的是獨立的測試卡，調整範例卡的平衡不會讓測試壞掉

packages/sim/             平衡模擬
├── src/bot.ts            機器人：貪婪策略與局面評分，三種打法
├── src/experiments.ts    實驗設定：比較哪些規則、牌組怎麼組
├── src/match.ts          打一局
└── src/run.ts            多程序平行跑大量對局，統計並寫出報告

packages/web/             網頁試玩版（Vite）
├── src/main.ts           畫面與操作；能點的東西全部由引擎的合法動作推出來
├── src/log.ts            把引擎事件翻成對戰紀錄
├── src/style.css         牌桌樣式，配色沿用 docs/board.svg
└── scripts/artifact.mjs  把打包結果合成單一 HTML 檔
```

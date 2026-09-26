# 卡牌美術（AI 繪圖）指南

卡面的框、費用、數值、文字都由遊戲畫面畫，**插圖只要畫圖本身**：不要有文字、邊框、數字。
這份是給 AI 繪圖工具用的提示詞範本，讓 113 張卡畫出來風格一致。

## 規格

| | |
|---|---|
| 比例 | 直式 3:4（例如 768×1024），主體在中間偏上，下面三分之一之後會被文字蓋住 |
| 格式 | WebP，檔名用卡牌 id：`art/seraph.webp`、`art/jelly-empress.webp`（id 見 [cards.md](cards.md) 或 `sample.ts`） |
| 英雄 | 同樣 3:4，胸像或半身，`art/hero-flame-lord.webp` |
| 場地、法術 | 場景或效果本身，不一定要有角色 |

## 統一風格

每張都用同一段風格描述、同一個模型；有「參考圖」功能的工具，先畫好一張滿意的，之後都拿它當風格參考。
多數繪圖模型看英文比中文準，所以提示詞用英文。

```
painterly fantasy trading card illustration, rich but soft lighting, clear silhouette,
single focal subject, dark atmospheric background, detailed but readable at small size,
no text, no border, no frame, no watermark, portrait orientation
```

不要的東西（negative prompt，工具有這欄的話）：

```
text, letters, numbers, logo, watermark, card frame, border, UI, blurry, extra limbs, cropped head
```

## 顏色的色調

| 顏色 | 主題 | 色調與光 |
|---|---|---|
| 白 | 騎士、天使、聖職者、士兵 | 象牙白與金色，溫暖的逆光、光暈 |
| 藍 | 海洋、水母、法師、知識 | 深藍與青色，水中或霧氣的冷光 |
| 黑 | 亡靈、暗影、毒、詛咒 | 紫黑與病態的綠，低光、邊緣光 |
| 紅 | 火焰、狐、龍、戰鬥 | 橘紅與餘燼，強烈的火光 |
| 綠 | 森林、熊、樹人、藤蔓 | 苔綠與琥珀，林間透下來的光 |
| 無色 | 傭兵、機械、道具、遺物 | 灰褐與金屬色，中性光 |

## 稀有度的構圖

- **N**：單純的站姿或特寫，背景簡單
- **R**：有動作（出招、奔跑），背景多一點場景
- **SR**：動態構圖、特效明顯（光、火、水花）
- **UR**：史詩感、俯角或仰角、大範圍特效，一眼看得出是王牌

## 提示詞範本

```
[統一風格], [主體：誰、在做什麼], [顏色的色調], [稀有度的構圖]
```

範例：

| 卡 | 提示詞（接在統一風格後面） |
|---|---|
| 熾天使（白 SR） | a six-winged seraph with a burning halo spreading its wings over a battlefield, ivory and gold, warm backlight and lens glow, dynamic composition with radiant light rays |
| 深海水母皇（藍 SR） | a colossal crowned jellyfish queen glowing in the deep sea, trailing electric tentacles, deep blue and cyan bioluminescence, dynamic composition with crackling sparks |
| 死亡騎士（黑 SR） | an armored undead knight on a skeletal horse raising a cursed greatsword, purple-black mist and sickly green glow, dramatic low angle |
| 九尾天狐（紅 SR） | a nine-tailed celestial fox leaping through a storm of fire, each tail a flame, orange-red embers, dynamic swirling composition |
| 古樹熊神（綠 UR） | an ancient bear god made of living wood and moss, a great tree growing from its back, towering over a forest, amber light through leaves, epic low-angle composition |
| 士兵（白 衍生物） | a young foot soldier with a spear and round shield, simple standing pose, ivory and gold, plain background |
| 烈焰吞噬（紅 法術） | a torrent of flame swallowing a silhouetted creature, no clear face, orange-red fire filling the frame |
| 聖域（白 場地） | a sunlit marble sanctuary with a glowing altar, rays of light through tall columns, no characters |

## 注意

- 用的繪圖服務要確認**商業使用的授權**；提示詞裡不要寫在世畫家的名字。
- 同一條進化線（例如林地蠻熊 → 森林熊王）用同一個角色設計，進化後更大、更華麗，玩家一眼認得出來。
- 畫好後放進 `art/`，之後在卡面加插圖欄位；單一 HTML 的試玩版會改成用縮圖內嵌或另外放圖檔。

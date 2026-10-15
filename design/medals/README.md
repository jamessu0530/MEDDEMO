# 獎牌設計提案

## 第二輪：iOS 風格

依 Apple 的圖示設計指南，採用較少的圖形、清楚的輪廓與分層立體感。參考：[App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)、[Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Fitness / Activity awards](https://support.apple.com/guide/watch/track-daily-activity-apd3bf6d85a6/watchos)。

- `ios-A-orbit.blend`：活力圓環，Fitness 成就徽章靈感。
- `ios-B-soft.blend`：柔光方章，連續圓角與紫色浮雕。
- `ios-C-crystal.blend`：晶透徽章，霧透外殼與青藍分層。
- `build_ios_medals.py`：三個系列共 18 面；用一至三個圓點表示等級。
- `compose_ios_preview.py`：產生實際渲染圖與小尺寸的深淺背景比較。
- `ios-A-orbit-products.blend`、`ios-B-soft-products.blend`、`ios-C-crystal-products.blend`：四個品類各銅、銀、金三面。三款共 36 個額外 GLB。
- `build_product_medals.py`：膠囊、藥錠、葉片、器材四種浮雕；Blender 指令最後加 `-- 1` 可重建 B 款（A／B／C 對應 0／1／2）。
- `export_achievement_catalog.py`：從後端共用目錄匯出 18 面獎牌的名稱與條件給比較頁，示例進度會明確標示。

目前比較頁顯示第二輪，頁尾可回到第一輪。霧透獎牌是以分層圖示為靈感的 3D 物件；介面的透明效果只用於預覽按鈕。每個 GLB 保留完整的正反面。

比較頁的 Three.js 動畫包含柔和進場、各系列不同的浮動與傾斜、滑鼠視差、點擊翻轉，以及 2.25 秒的解鎖旋轉、光環與粒子。可暫停日常動態並單獨重播解鎖；看正面／背面使用平順的相機轉動。拖曳時讓出控制，視窗或獎牌離開畫面時停止渲染。遵循 `prefers-reduced-motion`，系統要求減少動態時省略自動浮動與解鎖旋轉。動畫曲線在 `gallery/motion.js`，場景與生命週期在 `gallery/viewer.js`。

```sh
blender --background --factory-startup --disable-autoexec -t 4 --python design/medals/build_ios_medals.py
```

## 第一輪

四個 Blender 5.2 系列：月桂典藏、六角科技、旅行羅盤、療癒熊掌。
每個系列含藥局／縣市兩種成就，銅／銀／金三種等級，共 24 面。

## 檔案

- `A-laurel.blend`：月桂典藏。
- `B-hexagon.blend`：六角科技。
- `C-compass.blend`：旅行羅盤。
- `D-paw.blend`：療癒熊掌。
- `build_medals.py`：可重建模型、材質、光源、相機及輸出。
- `gallery/`：比較頁原始碼。
- `../../frontend/public/medal-designs/`：24 個 GLB、8 張渲染圖、比較圖及可旋轉的預覽頁。

每個 `.blend` 都保留可編輯的幾何、文字與材質。相機畫面上排是藥局，下排是縣市；左至右是銅、銀、金。獎牌正面朝 Blender 的 -Y，匯出 GLB 後朝 +Z。

## 重建

在專案根目錄執行（`blender` 替換成實際的執行檔路徑）：

```sh
blender --background --factory-startup --disable-autoexec -t 4 --python design/medals/build_medals.py
node frontend/node_modules/vite/bin/vite.js build --config design/medals/vite.config.mjs --configLoader native
python3 -m http.server 8766 --bind 127.0.0.1 --directory frontend/public/medal-designs
```

開啟 `http://127.0.0.1:8766/`。可切換系列、成就類別、等級，拖曳旋轉，查看正反面，下載 GLB。

`compose_preview.py` 需要 Pillow 及 macOS 的 Arial Unicode 字型，用於把四張實際 Blender 渲染圖排成比較圖。

個人頁已接入 B 款柔光方章；解鎖的六個類別、三個等級都使用實際 GLB。`medal-scene.ts` 仍共用一張 WebGL 畫布，僅繪製螢幕內的獎牌，背面加入實際門檻與解鎖日期。模型載入失敗時使用程式產生的立體方章；WebGL 不可用時保留 SVG。A、B、C 三款都可在比較頁旋轉、播放解鎖動畫及下載。

品類成就以實際登入帳號的 `LearningCompletion` 紀錄計算，四個類別各有品類辨識、規格核對、情境練習三關。題目取自現有商品型錄，不回傳價格或成本；每關全部答對才能依序解鎖，重複完成不重複發牌。品類課程不計入新人五關的 XP 或 AI 解鎖條件。

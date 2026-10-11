# 商品型錄照片

2026-10-11 整理 284 張網路商品照片，供型錄的 1,596 個料號使用。照片統一轉成最長邊 480px 的 WebP，約 3.7 MiB，頁面按需載入。

商品圖片對應在 `frontend/src/data/product-photos.json`，每張圖保留原商品名稱、來源商品頁與原始圖片網址。原始候選清單在 `data/seed/product-photo-sources.json`。

目前全部標示為「示意圖」：同系列的包裝、尺寸、顏色與舊品，以及虛構的示範商品，都可能共用參考照片。圖片供型錄展示，不能用來辨識藥品、劑量或包裝規格。

主要來源：

- [中化裕民官方商城](https://mall.cenrahealthcare.com/)
- [中化產品網](https://www.ccpp.com.tw/)
- [中化健康360商店](https://www.360care.com.tw/shop)
- [台灣歐姆龍](https://omronhealthcare.com.tw/)
- [BRACOO Taiwan](https://www.bracoo.tw/collections/all)
- [中衛](https://www.csd.com.tw/flat-face-mask)

紗布、棉棒和血糖試紙另使用商品頁記錄的同類參考照片。圖片權利仍屬原權利人，來源連結不代表已取得重製授權。

重新整理圖片：

```bash
uv run --project backend python backend/scripts/fetch_product_photos.py
# 重新讀取官網清單，並保留既有與歷史來源
uv run --project backend python backend/scripts/fetch_product_photos.py --refresh
```

此流程只更新靜態圖片與前端對應表，不修改商品、交易或帳號資料，也不需要重灌資料庫。新增料號尚未配圖時會顯示缺圖狀態。

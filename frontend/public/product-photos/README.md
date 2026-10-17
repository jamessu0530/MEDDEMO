# 商品型錄照片

2026-10-17 更新後保留 307 張商品來源圖片，對應 769 個料號；787 個料號待補照片。統計範圍為 `products.tsv` 的 1,536 項與 20 項活動示範商品。照片統一轉成最長邊 480px 的 WebP，頁面按需載入。完整待補清單見 `data/seed/product-photo-coverage.json`。

商品圖片對應在 `frontend/src/data/product-photos.json`，每張圖保留原商品名稱、來源商品頁與原始圖片網址。原始候選清單在 `data/seed/product-photo-sources.json`。

照片區分「同品項」、「同系列」與「Demo參考照」。自動比對不接受不同藥品或劑量；依本次Demo需求明確指定的參考照，需同時標記 `kind: illustrative`、`demo: true`，並以「Demo參考照：」開頭記錄差異。商品頁可見標示與來源，同系列照片保留規格差異。虛構示範商品不配替代照片。外觀搜尋使用 embedding-2 找候選照片，再依既有 SKU 對應取得型錄品名；Demo參考照不加入外觀搜尋，同系列照片不能確認藥品、劑量或包裝規格。

藥品（一般用藥、慢性處方）共77項，均已有圖片。兩輪共補入21項：3項精確規格、10項同系列、8項Demo參考照。全部藥品圖片共3項精確規格、66項同系列、8項Demo參考照。AYVAKIT 100mg與300mg使用健喬官方台灣30錠瓶身照片；不同劑量的ADHOOD、ATOTY、Zan與不同品牌參考照均保留差異說明。

主要來源：

- [中化裕民官方商城](https://mall.cenrahealthcare.com/)
- [中化產品網](https://www.ccpp.com.tw/)
- [中化健康360商店](https://www.360care.com.tw/shop)
- [台灣歐姆龍](https://omronhealthcare.com.tw/)
- [BRACOO Taiwan](https://www.bracoo.tw/collections/all)
- [中衛](https://www.csd.com.tw/flat-face-mask)
- [高雄榮民總醫院藥品查詢](https://www2.vghks.gov.tw/DIWEB/)

紗布、棉棒和血糖試紙另使用商品頁記錄的同類參考照片。圖片權利仍屬原權利人，來源連結不代表已取得重製授權。

重新整理已核對圖片：

```bash
uv run --project backend python backend/scripts/match_verified_product_photos.py --output data/seed/product-photo-plan-20261017.json
uv run --project backend python backend/scripts/import_verified_product_photos.py --plan data/seed/product-photo-plan-20261017.json
```

核對來源包含 `data/seed/product-photo-sources-verified-*.json`。`reviewedProducts` 必須同時符合料號、完整品名和類別才會套用；不要用 `fetch_product_photos.py` 的歷史相似度配圖流程覆蓋正式對應表。

食藥署公開外觀資料與外盒資料的部分圖片主機回覆403，後續改用原廠、醫院、海外商品頁及食藥署公開包裝PDF取得圖片。包裝PDF以指定頁面的嵌入圖片轉成WebP，來源保留 `pdfPage` 與 `pdfImageIndex`。原查找結果保留在 `data/seed/medicine-photo-review-20261017.json` 的 `previousMissing`。

此流程只更新靜態圖片與前端對應表，不修改商品、交易或帳號資料，也不需要重灌資料庫。新增料號尚未配圖時會顯示缺圖狀態。

另外執行 `uv run --project backend python backend/scripts/import_product_photos.py`，可把本次明確指定的21項照片原檔、來源、圖片種類與差異說明寫入資料庫的 `product_photo` 表。此步驟會核對資料庫品名，並在同一交易內增量匯入；重跑相同資料不重複寫入。`--check-only` 可先檢查本機圖片及核對清單。商品API提供入庫照片的網址，商品頁優先使用資料庫照片。

更新照片或對應表後，再執行 `uv run --project backend python backend/scripts/index_product_appearance.py` 重建外觀搜尋索引；相同照片的向量會沿用。

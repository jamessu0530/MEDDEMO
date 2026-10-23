# 客戶採購推薦

開單選好客戶後，「新增產品」預設顯示「為客戶推薦」。推薦讀取成交紀錄、商品主檔及既有客戶權限，使用目前客戶供貨價；已在訂單內的料號不再推薦。勾選後仍由業務確認數量、供貨條件與價格，再儲存或送出。練習流程維持既有商品型錄。

這是 B2B 選品與補貨討論工具，不根據病患、症狀或疾病推薦治療。商品主檔缺少完整的適應症、通路授權、上架日期與高價值標記，因此本版不推定臨床可替代性、通路供貨資格或新藥價值。零成交商品稱為「品類探索」，不把零成交等同剛上市。

## 線上算法

版本：`channel-item-cf-content-v1`。不呼叫 LLM、不新增資料表、不改寫交易。每次請求以系統的 `app_today()` 重建當下可見、目前供貨價大於零的型錄與近 365 天資料；未來交易和草稿不進入模型。

1. **通路分群與訊號**：依現有 `Customer.type`（連鎖、單店、診所、非藥局通路）分群，讀取使用者可見的成交紀錄。同客戶、料號、訂單去重；每個客戶與商品的強度為 `log(1 + 成交單數) × 2^(-距最近成交天數 / 180)`。金額、數量和利潤不當作偏好標籤。這四種通路仍是粗分類，不能作為供貨資格認證。
2. **Item-to-Item 協同過濾**：商品向量的各維是同通路客戶的採購強度；使用 cosine similarity，至少兩家客戶共購，再乘上 `共購客數 / (共購客數 + 3)` 抑制低支持度。取目標客戶強度最高的前 40 項作錨點，加權累加未買過的商品。理由列出實際共購客數及目標客戶買過的錨點商品，不揭露其他客戶姓名。
3. **採購間隔**：商品至少有三個不同成交日期，才計算相鄰日期間隔的中位數。距最近成交達中位間隔的 80% 時加入候選，分數為 `min(3, 距最近成交天數 / 中位間隔)`。畫面顯示日期證據，不推算庫存、用量或安全存量。
4. **商品內容與冷啟動**：對品名、規格的英文詞、中文字詞與雙字、分類、單位建立 TF-IDF 向量，分類特徵乘二。只在目標客戶已採購的相同分類內比對 cosine；採最強錨點分數。近一年同通路零成交的候選，每份清單最多 `min(2, max(1, floor(K/4)))` 項，顯示探索理由與核對供貨提示。不推論藥品療效相同。
5. **排序與備援**：四組候選用 reciprocal-rank fusion 加總 `weight / (20 + 名次)`；共購、間隔、內容、同通路常購的預設權重分別為 `1、1、0.5、0.15`。權重及門檻是明示的初始規則，未經企業資料調參；排序分數不是購買機率。全新客戶使用同通路常購商品，整個通路無成交時顯示空結果並提供型錄入口。相同分數以料號固定排序，無隨機洗牌。

商品頁既有的個人瀏覽偏好仍服務於業務自己的型錄探索；本功能依「正在開單的客戶」計算，不混用兩種身分。

API：`GET /api/orders/customers/{customer_id}/recommendations?limit=12&exclude_sku=SKU1&exclude_sku=SKU2`。沿用開單客戶權限、銷售資料分享範圍及正式型錄排除規則。`limit` 限 1–25；排除清單限 100 項、每個料號 1–80 字元。回傳客戶、基準日期、歷史成交單數、模型版本，以及各品項的理由、來源與目前供貨價。權限及價格在實際儲存與送出時仍會重新驗證。

## ALS 與離線評估

ALS 使用 `implicit` 的真實 CPU 實作，只作離線比較，不加入 API 或正式映像的必要依賴。每個通路獨立訓練，矩陣為「客戶 × 商品」，已觀測信心值 `1 + 20 × 採購強度`、未觀測值依實作為 1；16 維、正則化 0.1、20 次迭代、seed 42、單執行緒。推薦允許重複採購，無歷史客戶回退同通路常購；無成交商品無法由 ALS 單獨學到。

安裝及執行：

```bash
uv sync --project backend --extra recommendation-eval

# 合成資料僅驗證五種算法與輸出流程能執行，不是企業效果證據。
uv run --project backend --extra recommendation-eval python backend/scripts/eval_product_recommendations.py --demo --output /tmp/product-recommendations-demo.json

# 資料庫唯讀評估；日期須符合該資料庫的 app_today() 與交易期間。
uv run --project backend --extra recommendation-eval python backend/scripts/eval_product_recommendations.py --cutoff 2026-09-30 --as-of 2026-10-23 --k 5 --output /tmp/product-recommendations.json

# 不安裝 ALS 時明確省略，不會用其他算法冒充 ALS。
uv run --project backend python backend/scripts/eval_product_recommendations.py --without-als
```

以全體共用的時間切點分開訓練與測試，避免隨機拆交易列造成同張訂單洩漏。訓練只用切點以前一年；測試為切點後至測試截止日，各客戶實際採購的不同料號。比較同通路常購、上次成交單、Item-CF（不足時補常購）、線上混合排序與 ALS。所有方法都允許再次採購，並使用同一份目前可見型錄；不宣稱已重建歷史供貨資格或上架時間。

輸出 Precision@K、Recall@K、NDCG@K 的客戶平均值、型錄覆蓋率及無訓練成交商品的召回率。短清單的 Precision 仍除以 K，重複料號不重複算命中。無測試客戶的平均值為 `null`，無冷商品的冷商品召回率亦為 `null`。報告只輸出彙整數字，不含客戶身分。合成與資料庫來源會明確標記。

目前尚未證明 ALS 優於混合模型、提升實際成交或縮短找商品時間。正式比較應選定連續數期的訓練、驗證、測試期間，只用驗證期間調參，凍結後再評估測試期；另分通路、新客戶與零成交商品觀察結果。離線驗證後，才能以實際業務試用評估加入訂單率、找料號時間與採用理由。現版本先保留可解釋的混合模型在線上。

2026-10-23 本機檢查：既有展示成交紀錄使用被正式型錄排除的舊料號，因此此次本機資料庫評估的可用訓練單與測試客戶皆為零，指標輸出 `null`。功能驗證另以獨立合成資料庫完成，沒有將展示交易改寫成正式商品的採購證據。使用實際資料前須先完成料號對應或匯入能對應正式型錄的成交紀錄。

## 研究與實作依據

### 2026 年研究與本版選擇

- [AI-Driven Hybrid Recommendation System for E-Commerce，IEEE ICICI 2026](https://ieeexplore.ieee.org/abstract/document/11580790)，DOI `10.1109/ICICI68773.2026.11580790`：IEEE 摘要描述協同過濾與商品內容模型的加權混合，處理稀疏互動與新客戶、新商品問題。其實驗採 Amazon Electronics 評分資料與 RMSE，不能直接作為藥品 B2B 下一次採購排名的效果證據。本案採相近的混合方向，但使用明示的 RRF 預設權重，沒有重現該文的權重最佳化，也不引用其結果作為本案準確率。
- [Improving Cold-Start User Recommendation via LLM-Judged Signals，IEEE IMCOM 2026](https://doi.org/10.1109/IMCOM69009.2026.11360973)：IEEE 摘要提出由 LLM 比較兩位使用者的互動歷史，產生偏好判斷訊號再加入訓練。它提供新客戶研究的候選方向；本版未實作這項訓練流程，亦未將 LLM 推測當成真實成交紀錄。

以上依 IEEE 公開摘要及出版資訊核對研究方向，未作全文重現。近期文獻仍持續研究混合推薦與冷啟動；本案的工程判斷是先保留可解釋基準、補齊正式料號的成交資料，再以固定時間切分驗證是否值得增加模型複雜度。論文年份本身不能證明某個模型更適合本案，也不能補足目前缺少的有效成交訊號。以下經典文獻保留為算法原始依據。

### 算法原始依據與實作

- [Linden 等，Amazon.com Recommendations: Item-to-Item Collaborative Filtering，IEEE Internet Computing 2003](https://doi.org/10.1109/MIC.2003.1167344)：採用商品之間的協同過濾方向；本案的時間衰減、支持度收縮及融合規則是本案設計，並非逐字重現 Amazon 系統。
- [Hu、Koren、Volinsky，Collaborative Filtering for Implicit Feedback Datasets，IEEE ICDM 2008](https://ieeexplore.ieee.org/abstract/document/4781121/authors)；[作者全文](https://yifanhu.net/PUB/cf.pdf)：隱式回饋、偏好與信心權重的 ALS 基礎。
- [`implicit` 官方程式庫](https://github.com/benfred/implicit)及 [CPU ALS API](https://benfred.github.io/implicit/api/models/cpu/als.html)：離線 ALS 實作來源。可重購情境明確設定 `filter_already_liked_items=False`。

本版沒有實作 Factorization Machines、SLIM 或其他深度推薦模型，也沒有將文獻的準確率套用到中化裕民資料。

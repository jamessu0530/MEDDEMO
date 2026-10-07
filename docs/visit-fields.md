# 拜訪紀錄六個欄位定義

機器可讀的版本是 [visit_fields.schema.json](../backend/app/schemas/visit_fields.schema.json)。語音抽取、確認頁驗證和測試都照它；兩邊不一致時以 schema 為準，改欄位要兩邊一起改。

## 欄位

| 欄位 | 意思 | 格式 | 例子 | 寫到哪套系統 |
| --- | --- | --- | --- | --- |
| `competitor` | 本次提到的競品，以及對方做了什麼 | `[{name, detail}]` | `[{"name": "御松田", "detail": "條件比我們好"}]` | CRM |
| `complaint` | 客戶對我方產品、配送、價格或服務的不滿 | 字串 | `補貨延遲三天` | CRM |
| `intent` | 客戶想進的品項 | `[{product_text, sku, qty, unit, promo_code}]` | `[{"product_text": "魚油", "sku": "HS-FO30", "qty": 20, "unit": "盒", "promo_code": null}]` | CRM、SAP 報價草稿 |
| `commitment` | 這次談定、有期限的一件事 | `{by, text, due}`，`by` 為 `us` 或 `customer` | `{"by": "us", "text": "回報檔期", "due": "2026-10-24"}` | CRM |
| `follow_up_date` | 業務說要再去追的日期 | `YYYY-MM-DD` | `2026-10-24` | CRM、追蹤提醒 |
| `notes` | 下次要帶的東西（bring）與跟客戶講過的促銷（told） | `[{kind, text, date}]` | `[{"kind": "bring", "text": "骨營的 DM", "date": null}]` | 拜訪備忘（客戶檔案、今日路線、日曆） |

OA 出差單不讀這些欄位，只用客戶和拜訪日期。

## 規則

1. **沒講到就填 null，不補也不猜。** 這是 FR-5.2。陣列欄位沒講到也填 null，不填空陣列，「沒提到」才只有一種寫法。
2. **有值的欄位要附原文片段，片段必須逐字出現在逐字稿裡。** 片段存在 `field_sources`，確認頁拿它做來源對照（FR-5.4）。對不上的片段就當作抽取錯誤，這是擋住模型自己編內容的第一道檢查。
3. **相對日期以拜訪日換算成絕對日期。** 例如「下週三」要換成 `2026-10-28`，原文片段則保留口語的講法。
4. **只講了承諾期限、沒講什麼時候再去追，`follow_up_date` 就留空。** 追蹤提醒改用 `commitment.due` 建立。這樣 FR-5.2 不推測、FR-6.4 要有提醒，兩條都能滿足。
5. **品項用 `product.aliases` 對到 sku。** 對不到或對到不只一個品項時，`sku` 填 null、保留 `product_text`，由業務在確認頁選。
6. **沒講數量，`qty` 就填 null。** SAP 報價草稿每一行都需要 sku 和數量，缺的要先在確認頁補齊才能寫入 SAP。
7. **競品的「首次」標記不是抽取欄位。** 由系統比對這家客戶過去的拜訪紀錄來判斷。口述裡不會講「這是第一次」，讓模型判斷等於讓它猜。
8. **抱怨只收針對我方的不滿。** 店況觀察（例如「魚油最近賣得比較慢」）不放進欄位，留在逐字稿裡；數字查詢會去搜逐字稿。
9. **講到促銷的口才填 `promo_code`。** 業務講了小口、中口、大口或某一口的搭贈，而且對得到這一期唯一的一口，`promo_code` 填促銷品項編號，`qty` 是口數、`unit` 是「口」；只講「開小口」沒講幾口算 1 口。沒講口就填 null，照第 5、6 條填數量。講了口卻對不到唯一的一口（例如「小口眼藥水」，好幾種眼藥水都有小口），`sku` 與 `promo_code` 都填 null，由業務在確認頁選。回寫 SAP 時一口照每口售價記（見 `docs/superpowers/specs/2026-10-07-quote-promotion-packs-design.md`）。
10. **備忘收兩種。** `bring` 是下次要帶給客戶的東西（DM、POP、海報、試用包、樣品、衛教單張、比價表…），`told` 是跟客戶講過的促銷、實銷、搭贈、活動條件。`date` 只在業務講了哪天要帶、或下次哪天去時才填，講過的一律 null。可以跟承諾、意向重複。確認時寫進拜訪備忘：要帶的沒講日期就放追蹤日，講過的放拜訪日（見 `docs/superpowers/specs/2026-10-07-calendar-notes-design.md`）。

11. **講「跟上次一樣」不是欄位，是 `repeat_last`。** AI 在六個欄位旁邊另外輸出 `repeat_last`：`all` 是有沒有講「跟上次一樣」「照上次」「老樣子」，`except_skus` 是這次不要的品項，`relative` 是跟上次比的加減（`delta` 是口數或數量，少是負數，「照上次」是 0）。講了確定的總數（「魚油這次 40 盒」）才填 `intent`。要抄哪幾列、這期對應哪一口、變了什麼都由後端照上次訂的算（`services/repeat_order.py`），展開後的結果寫進 `intent`，快照存在 `visit.repeat_last`（見 `docs/superpowers/specs/2026-10-07-repeat-last-order-design.md`）。

    | 業務說 | 抽出來 |
    |---|---|
    | 跟上次一樣就好 | `all` true |
    | 跟上次一樣，魚油改 40 盒 | `all` true；`intent` 魚油 30 入 × 40 盒 |
    | 老樣子，威鎮這次先不要 | `all` true；`except_skus` 威鎮凝膠 |
    | 跟上次一樣，再加一口小口 Premium | `all` true；`relative` Premium眼藥水小口 +1 |
    | 跟上次一樣，Premium 再加一口 | `all` true；`relative` Premium眼藥水 +1（沒講哪一口，對到上次那一口） |
    | 魚油比上次少 5 盒 | `all` false；`relative` 魚油 30 入 −5 |
    | 人工淚液照上次，其他不用 | `all` false；`relative` 人工淚液 0 |

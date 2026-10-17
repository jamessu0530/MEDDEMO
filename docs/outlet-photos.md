# 公開通路的外觀照片查找

對象是 `data/public-outlets/cenra-20261016.json` 的 4,642 筆公開通路。照片目標為店面外觀或招牌；使用者選擇繼續從官網和公開網頁查找。

最新筆數與可點選的逐店來源見 [照片查找進度](../data/public-outlets/photo-sources-summary.md)，完整每店資料見 `data/public-outlets/photo-sources.json`。依使用者授權，照片候選直接匯入資料庫並顯示，不經人工審核。

## 資料庫照片與零 Places 呼叫

`outlet_storefront` 以公開通路 ID 保存照片來源網址、來源頁、攝影者／授權標示，以及 Google Place ID。現有目錄共 4,642 間，其中 2,472 間有 4,229 個非 Google 照片網址；全部候選直接匯入，不以 `identity_verified` 或外觀複核狀態擋住。已核對身分的候選優先顯示，原有匹配狀態仍保留供追溯。這是保存網址與來源資料，沒有下載或重製圖片檔。

```sh
backend/.venv/bin/python backend/scripts/import_storefront_photos.py
```

匯入在交易中執行，重跑只更新有變動的紀錄，不建立或修改業務客戶。部署時 `upgrade_schema.py` 保留原資料新增此表，`sync_customer_search.py` 一併匯入照片目錄。

客戶清單與客戶檔案直接使用 API 回傳的 `storefront_photo`。有圖、缺圖、圖片失效與離線情況都不自動讀取 Maps 設定、不載入 Places SDK，也不回退至 Places 查詢。Google 地圖連結僅在使用者點擊時開啟外部網頁。

「選擇拜訪客戶」未搜尋時會先列出有照片的店家，同組維持 API 原有順序；搜尋時保留 API 相關度排序。每次顯示 100 筆，頁尾可按「顯示更多客戶」繼續瀏覽，搜尋或清除搜尋後回到前 100 筆。原先直接截取按 ID 排序的前 100 筆，全部落在沒有真實照片的示範客戶，導致預設畫面看不到已匯入的店家照片。

Google 查詢結果只保存可永久保存的 Place ID／候選 ID，不保存 Google 照片內容或照片參照。[Google 官方照片文件](https://developers.google.com/maps/documentation/places/web-service/place-photos) 說明照片名稱會過期且不得快取。只有 Google 照片的店家，仍需另有非 Google 照片來源才能在此流程顯示。

### 2026-10-17 正式站發布

已透過既有 GCP 連線，在 `care-vm` 的 `meddemo` namespace 直接新增照片表並匯入：4,642 間目錄、2,472 間有圖、4,229 個照片網址、804 個已配對 Place ID。重跑異動為 0，原有 4,895 筆客戶保留。正式 API 實測回傳 2,472 間照片資料，客戶清單與檔案皆已驗證能顯示來源網站圖片，沒有載入 Google Maps SDK。

發布以正式版本 `489ef695c6aab0cdf96405390f73b4fc24c1535f` 為基底，只覆蓋照片功能；前端來源逐檔比對確認只有客戶 API 型別、照片工具、照片元件、客戶清單與客戶檔案五個檔案變更。API 使用 `docker.io/library/meddemo-storefront-api:20261017-db`，網頁使用 `docker.io/library/meddemo-storefront-web:20261017-db2`，映像已載入該 VM 的 k3s。

完整 schema 升級未執行，正式站 `schema_version` 保留 `04fd21a6ec6e`；照片表已獨立新增，API 正常使用。後續正常整站發布可使用程式中已測試的保留資料升級路徑。此手動發布尚未改動 Helm 的映像設定；再次執行 Helm 發布前須包含照片功能原始碼，以免切回舊照片流程。

### 2026-10-17 客戶清單首批顯示修正

正式站預設前 100 筆原本全部是沒有照片的示範客戶，已改為有照片店家優先並增加「顯示更多客戶」。以當時正式版本 `fd9e439190e15fb999d9d1e41121637985274c78` 為基底，只增加客戶清單頁及排序工具，使用映像 `docker.io/library/meddemo-picker-web:20261017-photos`；API 與資料庫未變更。發布前核對原網頁雜湊，僅追加 582 KB 的網頁資產差異，保留同時上線的對話輸入列更新。15 項相關測試、型別檢查、Lint 與打包通過；正式站確認首批店家照片已載入，「顯示更多」可由 100 筆增加到 200 筆，共 4,895 位客戶。後續正常部署須包含本次清單頁與 `frontend/src/lib/customer-picker.ts`。

### 2026-10-17 分頁與入口快取修正

移除清單上的筆數與「有照片的店家優先」說明。拜訪清單改用 `/api/customers/picker?limit=100&offset=0`，先選取這一批客戶 ID，再查照片與拜訪摘要；回傳 `next_offset`，沒有下一批則為 null。搜尋維持相關度排序。原有 `/api/customers` 供行事曆等完整清單使用，行為不變。

畫面先顯示首批，300 毫秒後預載下一批，依使用者、搜尋字與頁數暫存 30 秒、最多八批。前四張照片優先抓取並非同步解碼，其餘維持延後載入；已儲存的完整行事曆離線清單保留。此次採分頁與預載減少傳輸量，沒有增加額外 API 或瀏覽器 Worker。

正式站同次實測：完整清單 4,895 筆、2,620,137 bytes；首批 100 筆、63,510 bytes，資料量減少約 97.6%，分頁 API 在伺服器內約 50 毫秒。這是 API 量測，不含使用者網路與來源網站照片時間。前端 21 項與後端 11 項相關測試、型別檢查、Lint、打包及頁面操作驗證通過。

正式映像為 `docker.io/library/meddemo-picker-api:20261017-pages` 與 `docker.io/library/meddemo-picker-web:20261017-pages-v2`，沿用前述 `fd9e439` 與照片修正，只更換客戶 API、網頁資產與 HTML 快取設定。入口 `index.html` 設定 `Cache-Control: no-store` 並關閉 ETag／修改時間的條件回應，避免同大小入口檔因舊 ETag 而繼續載入舊版程式。雜湊資產維持原本的瀏覽器快取。後續一般部署需包含這次前後端與 Nginx 設定。

## 已使用來源

- 屈臣氏官方網站的門市頁與門市相簿。以完整分店名、縣市行政區、道路與門牌核對，保留照片原始來源頁。
- [健保署藥局名冊](https://data.gov.tw/dataset/39284)：只用機構代碼、名稱、電話和地址作為查找線索，不用它判斷現行營業或合作狀態。保存的精簡名冊在 `data/public-outlets/pharmacy-registry-20261017.json`，附下載來源與原檔 SHA-256。
- PPI 公開醫療目錄：先閱讀 robots.txt 與 sitemap，只取對應藥局頁自己 JSON-LD 中的封面，核對名稱和完整門牌；不使用附近店家推薦區的圖片。部分封面可見街景標記，來源連結及再利用授權狀態仍分別保留。
- 少量公開圖片搜尋試查。搜尋結果只列為候選，沒有當成已確認的店面照。
- Wikimedia Commons：只使用檔案自身說明中可對上店名與完整門牌的照片，保留攝影者、拍攝日期、檔案頁及授權標示。沒有下載影像檔。

## 比對與狀態

台／臺、全半形、郵遞區號、樓層與段別數字可正規化；並列門牌以第一個主要門牌核對。`103、105號` 的主要門牌是 `103號`，不是 `103105號`。`83-1號`／`83之1號` 相同，不能變成 `831號`。來源省略里名時，還須核對電話。不同道路、主要門牌或分店不自動套圖。

`candidate_images` 只表示有照片連結；`identity_verified` 只表示來源頁店名與地址符合；`verified_exterior_images` 才表示已檢視圖中外觀。人工複核紀錄另存 `photo-manual-review.json`。現行來源名稱、地址有差異時保留待核對，沒有改動原始客戶地址。

公開可見和可再利用是不同欄位，目前沒有完成重製／再發布授權查驗。應用程式直接顯示來源網站的照片網址並保留來源標示，沒有下載或永久快取 Google Places 照片。

## 接續查找

Google Places 缺圖補查使用 `backend/scripts/collect_google_outlet_photos.py`，以目前追蹤檔中沒有 `candidate_images` 的店家為範圍。每筆完成即保存至 `data/public-outlets/google-storefronts.json`，重跑跳過已完成店家；認證、服務未啟用、配額或網路錯誤會停止整批，尚未查詢的店家不會被標為沒有照片。記錄僅保留 Place ID 與查找狀態，不保存 Google 照片名稱、網址或影像，也不將「找到照片」標成「已檢查外觀」。

2026-10-17 已完成全部 2,170 間缺圖店家的 Google 查詢，並重核名稱寫法差異：676 間店名／店址比對通過且有照片、128 間比對通過但沒有照片、1,358 間身分或店址待核對、8 間沒有搜尋結果。已發布 804 個比對通過的 Place ID，包含沒有照片但可使用店址／街景的店家。原始通路名單與 Google 的門牌或分店衝突時保留待核對，沒有自動修改客戶地址或套用其他分店照片。

```sh
backend/.venv/bin/python backend/scripts/collect_google_outlet_photos.py --limit 2170 --workers 4 --publish
```

金鑰由執行環境的 `GOOGLE_MAPS_SERVER_KEY` 提供，不寫入結果。Google Cloud 必須先在對應專案啟用 Places API（New），並允許該金鑰呼叫。店名、行政區與主要門牌都必須相符；里名或單側括號註記有差異時另查電話，電話不能覆蓋道路／門牌衝突；Watsons／Cosmed 品牌英文可正規化，分店名稱仍須核對。多個結果符合時只保留待核對的 Place ID。`--retry-review` 可重新核對先前待確認的結果。

`--publish` 可產生歷史查找用的 `frontend/src/lib/storefront-place-ids.ts`，只包含已比對通過的客戶 ID／Place ID；目前客戶照片流程已改讀資料庫，不再使用此索引即時查 Google。執行 `import_storefront_photos.py` 即可把現有結果中的 Place ID 與候選 ID 存入資料庫。

先從既有結果恢復，無網路請求：

```sh
backend/.venv/bin/python backend/scripts/collect_outlet_photo_sources.py
```

重新核對已快取的醫療目錄資料，並繼續尚未完成的頁面：

```sh
backend/.venv/bin/python backend/scripts/collect_public_pharmacy_photos.py --limit 5000 --workers 3 --recheck-cached
```

套用已人工檢視、且已在清單內核對過店址的照片：

```sh
backend/.venv/bin/python backend/scripts/collect_outlet_photo_sources.py --manual-review data/public-outlets/photo-manual-review.json
```

剩餘公開搜尋的具體清單在 `photo-search-approval-plan.json`。原訂 1,548 間的 Firecrawl 搜尋批次被自動核准審查拒絕，尚未執行。使用者選擇改用一般網頁搜尋，後續補查不使用這批 Firecrawl 額度。計畫檔保留原估算與未核准狀態，供追溯。

一般網頁搜尋結果以小批次保存在暫存研究目錄，離線匯入追蹤檔：

```sh
backend/.venv/bin/python backend/scripts/import_standard_photo_search.py /private/tmp/meddemo-standard-search
```

每店的 `standard_search` 記錄查詢與完成時間；只憑搜尋標題找到的照片，店址和外觀都仍是未確認。一般搜尋也覆蓋原預備清單以外、尚無照片的店家。

Commons 中繼資料可按下列流程恢復。`--fetch` 依序讀取各查詢的第一批結果，保留是否仍有後續頁，沒有宣稱已查完 Commons 所有檔案。`--apply` 從現有追蹤檔合併，避免蓋掉其他搜尋進度。

```sh
backend/.venv/bin/python backend/scripts/collect_commons_pharmacy_photos.py --fetch
backend/.venv/bin/python backend/scripts/collect_commons_pharmacy_photos.py --apply
```

檢查只需執行照片比對測試，無須啟動資料庫：

```sh
backend/.venv/bin/python -m pytest --noconftest backend/tests/report_interactions/test_outlet_photo_sources.py backend/tests/report_interactions/test_public_pharmacy_photos.py backend/tests/report_interactions/test_standard_photo_search.py backend/tests/report_interactions/test_commons_pharmacy_photos.py -q
```

這組比對測試不需要載入後端 API、資料庫或其他功能的相依套件；使用 `--noconftest` 可獨立驗證照片研究程式。

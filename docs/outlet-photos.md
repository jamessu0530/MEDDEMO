# 公開通路的外觀照片查找

對象是 `data/public-outlets/cenra-20261016.json` 的 4,642 筆公開通路。照片目標為店面外觀或招牌；使用者選擇繼續從官網和公開網頁查找。

最新筆數與可點選的逐店來源見 [照片查找進度](../data/public-outlets/photo-sources-summary.md)，完整每店資料見 `data/public-outlets/photo-sources.json`。照片候選尚未全部通過外觀檢查，沒有自動加入客戶畫面。

## 已使用來源

- 屈臣氏官方網站的門市頁與門市相簿。以完整分店名、縣市行政區、道路與門牌核對，保留照片原始來源頁。
- [健保署藥局名冊](https://data.gov.tw/dataset/39284)：只用機構代碼、名稱、電話和地址作為查找線索，不用它判斷現行營業或合作狀態。保存的精簡名冊在 `data/public-outlets/pharmacy-registry-20261017.json`，附下載來源與原檔 SHA-256。
- PPI 公開醫療目錄：先閱讀 robots.txt 與 sitemap，只取對應藥局頁自己 JSON-LD 中的封面，核對名稱和完整門牌；不使用附近店家推薦區的圖片。部分封面可見街景標記，來源連結及再利用授權狀態仍分別保留。
- 少量公開圖片搜尋試查。搜尋結果只列為候選，沒有當成已確認的店面照。
- Wikimedia Commons：只使用檔案自身說明中可對上店名與完整門牌的照片，保留攝影者、拍攝日期、檔案頁及授權標示。沒有下載影像檔。

## 比對與狀態

台／臺、全半形、郵遞區號、樓層與段別數字可正規化；並列門牌以第一個主要門牌核對。`103、105號` 的主要門牌是 `103號`，不是 `103105號`。`83-1號`／`83之1號` 相同，不能變成 `831號`。來源省略里名時，還須核對電話。不同道路、主要門牌或分店不自動套圖。

`candidate_images` 只表示有照片連結；`identity_verified` 只表示來源頁店名與地址符合；`verified_exterior_images` 才表示已檢視圖中外觀。人工複核紀錄另存 `photo-manual-review.json`。現行來源名稱、地址有差異時保留待核對，沒有改動原始客戶地址。

公開可見和可再利用是不同欄位，目前沒有完成重製／再發布授權查驗。照片未批次匯入應用程式，也沒有下載或永久快取 Google Places 照片。

## 接續查找

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

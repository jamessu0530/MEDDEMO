# 中化裕民業務 AI 助理系統

決賽版本開發中。拜訪紀錄五個欄位的定義見 [docs/visit-fields.md](docs/visit-fields.md)。

根目錄的 `index.html` 是提案階段的可點原型，推 main 時會部署到 GitHub Pages。正式系統的前端在 `frontend/`。

## 本機開發

需要 Docker、[uv](https://docs.astral.sh/uv/) 與 Node 24。本機的 Docker 只拿來跑開發用的資料庫與 Redis，正式環境在雲端 VM 的 K3s 上。

```bash
docker compose up -d --wait db redis                # Postgres 16 + pgvector（5433）、Redis（6379）
uv run --project backend python data/seed/seed.py   # 重建 schema 並灌假資料，會清掉整個資料庫
uv run --project backend pytest backend/tests       # 測試另建 meddemo_test、用 Redis 第 15 號庫，不動開發環境

uv run --project backend uvicorn app.main:app --app-dir backend --reload                  # API：http://127.0.0.1:8000
uv run --project backend rq worker visits --path backend --worker-class rq.SimpleWorker   # 背景工作
cd frontend && npm install && npm run dev                                                 # 前端：http://localhost:5173
```

背景工作在 macOS 上要加 `--worker-class rq.SimpleWorker`：RQ 預設每個工作 fork 一次，macOS 上容易出問題；正式環境是 Linux，用預設即可。

`--app-dir backend`、`--path backend` 是把 backend 直接加進 Python 的搜尋路徑。repo 放在 iCloud 同步的桌面時，`.venv` 會一再被標成隱藏檔，Python 就會略過可編輯安裝的路徑設定，出現 `No module named 'app'`。測試和 `data/seed`、`backend/scripts` 裡的程式已經自己處理了這件事。

同一台電腦上要同時跑兩份測試時，用 `TEST_DB_NAME`、`TEST_REDIS_URL` 各自指定測試用的資料庫與 Redis，才不會互相清掉資料。

## 金鑰與供應商

本機：把 `backend/.env.example` 複製成 `backend/.env` 再填值，這個檔案不會進 git。正式環境：金鑰填在 GitHub Secrets（見下方部署的表格）；用哪家服務、哪個模型寫在 [deploy/helm/meddemo/values.yaml](deploy/helm/meddemo/values.yaml) 的 `config`，改完推 main 就會部署生效。

四項外部服務目前都接 Gemini，各自設定。金鑰到 [Google AI Studio](https://aistudio.google.com/apikey) 申請；AI 模型選 Gemini 時，其他三項沒填自己的金鑰，就沿用 `LLM_API_KEY` 那把，所以通常只要填一把。

| 功能 | 要填的設定 | 模型留空時用 |
| --- | --- | --- |
| 語音辨識 | `ASR_PROVIDER=gemini`、`ASR_API_KEY`；或 `local`（CARE 的服務，另填 `ASR_URL`），見下方「語音辨識」 | `gemini-3.8-flash` |
| AI 模型（抽欄位、問答） | `LLM_PROVIDER=gemini`、`LLM_API_KEY` | `gemini-3.8-flash` |
| 語意檢索 | `EMBEDDING_PROVIDER=gemini`、`EMBEDDING_API_KEY` | `gemini-embedding-001` |
| 語音問答 | `VOICE_API_KEY`（沒填就沿用 `LLM_API_KEY`） | `gemini-2.5-flash-native-audio-preview-12-2025` |
| 網路搜尋 | `FIRECRAWL_API_KEY` | — |
| 精排 | `COHERE_API_KEY` | `rerank-v4.0-pro` |

沒設定也能用：錄音會停在「轉文字失敗」，業務可以手動輸入逐字稿；欄位會留白，讓業務手動填。整條「口述 → 確認 → 寫回三套系統」照樣走得完。沒設定 embedding 時，知識檢索只走關鍵字。

## 口述到回寫

1. 選客戶 → 客戶檔案 → 錄音 → 上傳。轉文字和整理欄位在背景做（RQ 佇列），畫面每秒問一次進度。
2. 確認頁逐格修改五個欄位，逐字稿裡會標出每個欄位的原文；AI 整理出來卻對不到原文的欄位會提示核對。
3. 確認後平行寫入 CRM、SAP、OA 三張模擬表，各自成敗，失敗的可以單獨重送；有追蹤日或承諾期限就建追蹤提醒。

- **錄音時即時顯示文字（FR-4.2）**：
  - 錄音時，聲音同時送給 Gemini 的即時轉錄模型（`gemini-3.5-transcribe-live`），畫面上邊講邊出現文字。
  - 這段文字只給業務看；正式的逐字稿還是錄完整段上傳後，由語音辨識產生。
  - 金鑰用語音辨識那把（沒填就沿用 `LLM_API_KEY`），後端一樣只發臨時金鑰。
  - 指定台灣華語和英文，專有名詞放這家客戶的名稱、競品與通路術語、品項名稱，照官方建議最多 100 個。
  - 拿不到金鑰或沒有網路時，錄音照常進行，只是沒有即時文字。
- **沒網路也不會掉錄音（FR-4.3、NFR-6）**：
  - 錄完先存進手機（瀏覽器的 IndexedDB）再上傳。
  - 上傳不了就顯示「錄音已存在手機」；首頁列出待送出的錄音，底部「拜訪」分頁顯示筆數。
  - 恢復連線或每 30 秒自動重送。伺服器用錄音編號（client_ref）去重，重送不會多出一筆。
  - 送出後首頁提示「已送出，去確認」。

展示部分失敗時，把某一套模擬系統設成停機：

```bash
curl -X PUT localhost:8000/api/mock-systems/oa -H 'Content-Type: application/json' -d '{"down": true}'
```

## 語音辨識：Gemini 與 CARE 的服務

錄音轉文字有兩個來源，`ASR_PROVIDER` 選主要的那個，另一個有設定就當備援；主要來源連不上、逾時或回錯誤時改用備援。

- **Gemini**（`gemini-3.8-flash`）：提示裡附熱詞（這家客戶的名稱、品項與口語別名、競品、通路術語），照熱詞寫專有名詞。
- **CARE 的語音辨識服務**：跟 CARE 共用 care-vm 上的 `local-asr`（faster-whisper small），不花錢；兩個專案的請求會排隊，CARE 部署時會重啟。網址是 `values.yaml` 的 `config.ASR_URL`，本機連不到。
  - 服務沒有熱詞參數，輸出是簡體，專有名詞常錯成同音字。所以先轉台灣正體，再用拼音比對熱詞修同音字，規則寫在 `backend/app/services/asr_cleanup.py`。
- 正式環境現在是 Gemini 為主、CARE 備援；`config.ASR_PROVIDER` 改成 `local` 就反過來。
- 9/15 用 macOS 的台灣華語合成語音念術語句子，送 CARE 的服務實測（真人口音與環境噪音會更差）：

| | 字錯率 |
| --- | --- |
| 只轉正體 | 20.7% |
| 轉正體＋熱詞修同音字（沒看過的十句） | 7.4% |
| 同上，但是調規則時看的那十句（偏樂觀） | 0.7% |
| Gemini（9/14，一段 19 秒口述，參考用） | 2.7% |

- 等待時間：66 秒的錄音等 21 秒；6～9 秒的短句每句也要 5～8 秒。逾時設 90 秒，理由寫在 `transcription.py`。

## 今日路線（首頁）

打開 App 先看今天要跑哪幾家、順序、以及每一家為什麼排進來。原型的第一個畫面。

- **選身分**：這次不做登入（FR-12／13），所以第一次打開時自己選是哪位業務，記在手機裡（localStorage），標頭的「換人」可以改。五位業務各管 50 家客戶。
- **排順序的是學出來的模型**，不是規則：
  - 訓練資料是資料庫裡的 5,223 筆拜訪紀錄。特徵六個，都是出門前就知道的事——進貨間隔的變化、距上次進貨多久、距上次拜訪多久、帳齡、合約還剩多久、客戶等級。標籤是那次拜訪有沒有留下競品、客訴、下單意向或承諾。
  - 模型是 logistic regression（純 Python 實作，不用額外套件），權重存在 `backend/app/resources/route_model.json`，跟程式一起進 git。
  - 成績（最後四分之一的拜訪當測試期，照時間切）：

    | | AUC |
    | --- | --- |
    | 模型 | 0.720 |
    | 現行規則（距上次拜訪幾倍 × 等級權重） | 0.534 |

    分數由高到低切五等分，每一等實際有收穫的比例是 29.9%、17.6%、8.0%、8.4%、3.8%。也就是模型排最前面的兩成，命中率是排最後兩成的八倍。
  - 改了假資料或重灌之後要重新訓練（資料一樣就不必，種子固定、產出相同）：

    ```bash
    uv run --project backend python backend/scripts/train_route_model.py
    ```

- **逾期的承諾不交給模型決定**：答應客戶的事過了期限、而且到期之後還沒再去過，就直接排進今天，最多兩家（假資料沒有結案紀錄，逾期的承諾會累積，不設上限整條路線都是它）。
- **每一站都寫為什麼排它**。判斷的門檻沿用客戶檔案那組：帳齡 60 天、進貨間隔拉長兩成、合約前 3 個月，業務在兩個畫面看到的標準才一樣。不用模型自己的特徵貢獻來寫理由：貢獻值受標準化影響，權重接近 0 的特徵只要那家客戶特別極端，算出來的貢獻照樣最大，講出來的理由會跟排序的真正原因對不上。
- **最上面「需立即處理」那張卡**，說明文字直接取客戶檔案的「進門前三分鐘」，不另外生成。只有真的有事才出現；今天沒有特別急的（最急的只是「很久沒去」）就不給卡片。
- **三顆鈕**（插入下一站／暫緩／誤判）：
  - 結果只存在這支手機（localStorage），不上伺服器。沒有登入，存伺服器的話決賽現場多位評審選到同一位業務會互相改到對方的畫面。
  - 插入下一站：排到最前面，同類提醒之後排前面一點。暫緩：三天內不排這家。誤判：同類提醒之後少排一點，這家也先暫緩。
  - 業務按了暫緩就不排，逾期的承諾也一樣：他知道自己今天去不去得了，按了沒反應更難解釋。同理，某類提醒被按過誤判，那類就不再硬排。
  - 每按一次，該類提醒的分數調整一成，上下限五次，免得按久了完全蓋過模型。
  - **回饋沒有拿去重新訓練模型**（監督式學習權重不在這次範圍）。決賽被問到就照實說：回饋已經在收，調的是這支手機上的排序。
- 路線拿到後存在手機裡，沒訊號時顯示上次那份並標明。

## 客戶檔案與談判卡

首頁點客戶會先進客戶檔案（FR-2），連鎖客戶多一張談判卡（FR-3）。內容只來自資料庫的數字和內部文件的原文，不讓 AI 生成。

- **進門前三分鐘**：照數字套規則寫出的重點，最多四句。會提的狀況包括進貨間隔拉長、逾期承諾、近期提到的競品、客訴、帳齡超過 60 天、合約 3 個月內到期。
  - 進貨間隔比之前拉長兩成以上才提醒：目前 250 家客戶裡，刻意設計的五家以外九成的變化在 8% 以內、最多 13%，那五家拉長 41%～63%。
  - 帳齡 60 天、續約前 3 個月，這兩個數字照內部文件。
- **交易概況**：近 3 月進貨、進貨間隔（之前 → 現在）、帳齡，加上近六個月每月的進貨間隔長條圖。
- **待處理事項**：未結案的報價草稿、近 90 天的客訴、近 90 天內到期或已過期的承諾。系統沒有結案紀錄，所以只列近期的。
- **競品紀錄**：過去拜訪提到過的競品、次數，和最近一次的說法。
- **談判卡**：
  - 我方主要品項近 90 天每月進貨幾次，對照同區同類型客戶的平均，低於平均標紅。
  - 這家客戶的毛利結構：上架費、通路獎勵、淨毛利率，對照同區平均。淨毛利率用加總相除。
  - 內部文件建議的切入點：看客戶符合哪種情況（提到競品、進貨間隔拉長、合約快到期、帳款過久、連鎖通路），到內部文件找最相關的一段原文列出來。
  - 情況和關鍵字寫在 `backend/app/resources/negotiation_topics.json`，改這個檔就能調整；改完跑 `tests/test_customer_profile.py`，確認每組都找到想要的段落。
- 原型上有兩樣這裡沒有：檔期成效，資料庫裡沒有這份資料；切入點的提出者與採用次數，屬於這次不做的方法卡片。

## 問答：數字查詢與知識查詢（第四週）

- **查數字**：把問題轉成 SQL，只能查四個語意層 View，並用唯讀角色執行。結果不夠回答，就自己決定下一條查詢，最多查三輪；查到上限還答不出來，就回報已經查到的部分和卡住的原因。
- **查規定**：`data/documents/` 的內部文件，一個小節切成一段。整套照搬 CARE 的 CRAG 回答路徑（`backend/app/services/crag/`），跟 CARE 不同的有四點：網路搜尋不限網站（CARE 限定政府網域）、知識庫答案沒有對得上的出處就當查無依據、用藥這類醫療問題不上網、只有公司內部才有答案的問題也不上網（後三點見下面）。
  - 檢索：關鍵字（中文兩字一組的全文檢索）與語意（pgvector）兩路並行，各 5 秒逾時，一路失敗或逾時就只用另一路；分數依「向量 0.6、關鍵字 0.4」的凸組合合併，取前 40 段。
  - 精排：送 Cohere（`rerank-v4.0-pro`）取前 5 段，同一份文件最多留 2 段；沒有 Cohere 金鑰就直接用合併分數排序。
  - 評估這 5 段夠不夠回答的同時，並行先用它們生成答案、也先把問題改寫成知識庫問句與中英搜尋詞，省下前後等待的時間。
  - 評估分三級：**夠**→用先生成好的答案；**不確定**→已經用掉超過 12 秒改寫預算就用第一輪結果，沒超過就用改寫後的問句重查一次、再評一次；**無關**，或重查後依舊不確定／無關→轉上網查；評估本身出錯就只留 Cohere 分數 0.3 以上的段落生成，一段都不留一樣轉上網。
  - 上網用 Firecrawl：中文一路最多查 8 筆、英文一路（有改寫出英文關鍵字才查）最多 3 筆，交錯合併取前 3 份；搜尋摘要不到 20 字才抓整頁（每頁最多擷取 8,000 字）。網路答案開頭標「以下參考網路公開資料」，出處列網頁標題與網址，打不開的網址不列出。
  - 答案要標出處編號、最多 450 字、最多列 3 個出處；模型判斷答不出來時要寫固定標記，系統只認標記為拒答，不再比對「不知道」之類的字眼。
  - 知識庫的答案一個對得上的出處都沒有，就當作查無依據（CARE 照樣回答，只是不附出處）。知識庫答案的出處編號也認全形的［1］、【1】和一組括號列好幾個編號的 [1, 2]，畫面上統一改成 [1][2]；網路答案的編號照模型寫的原樣顯示。
  - 用藥、劑量、療效這類醫療問題：有設 Firecrawl 時，知識庫答不出來也不上網查，回覆請業務詢問醫師或藥師，畫面上也不給「轉給主管」。「不上網、請詢問醫師或藥師」這兩點跟語音問答一致；不同的是語音遇到醫療問題一律不查，打字問答則是內部文件答得出來就照答。是不是醫療問題，由改寫問句的那次模型呼叫一起判斷，不多一次呼叫（推估不會多等，還沒量過）。
  - 只有公司內部才有答案的問題（公司自己的規定、人事獎金、本公司的報價、供貨價與調價計畫、客戶跟我們的交易條件、競品給客戶的價格與條件）：一樣是知識庫答不出來也不上網查，回覆說明網路資料代表不了公司，可以轉給主管確認。健保給付價、藥價公告、市售價是公開資訊，照常上網。判斷也在改寫問句那次呼叫裡。
  - 整條流程 45 秒總逾時。沒有 Firecrawl 金鑰就不上網，知識庫答不出來直接回「查無依據」，業務可以轉給主管；網路搜尋本身出錯或整體逾時，畫面會顯示處理失敗、請業務稍後再問。
- 兩條線都在背景跑（RQ），每一步都寫進 `query_trace`，畫面上可以展開查詢過程。
- AI 模型用 Gemini：`LLM_PROVIDER=gemini`，模型預設 `gemini-3.8-flash`；遇到 429、5xx 這類暫時性錯誤會自動重試兩次。知識查詢裡評估、改寫問法用 thinking level `low`，生成答案用 `medium`。embedding 用 `gemini-embedding-001`，文件段落和提問分開算向量；沒設定時只走關鍵字檢索。
- 改了 `data/documents/` 的文件，或是設定、更換了 embedding，要重建文件索引。下面這個指令只重建文件段落，不動其他資料：

```bash
uv run --project backend python backend/scripts/index_documents.py
```

評測（第四週出場條件）：數字題在 `data/eval/data_questions.json`，知識題與庫外題在 `data/eval/knowledge_questions.json`。

```bash
uv run --project backend python backend/scripts/eval_ask.py
```

## 語音問答（Gemini Live）

底部分頁的「語音」：用講的問，AI 先查資料再用講的回答，查到的表格和出處同時列在畫面上。

- 手機直接連 Gemini Live，聲音不經過我們的伺服器。後端的 `POST /api/voice/session` 每次發一把臨時金鑰，限制如下；正式的金鑰不會離開伺服器。
  - 只能開一段對話。
  - 1 分鐘內要連上，30 分鐘後失效。
  - 系統指示和工具都鎖在金鑰裡，手機端改不了。
- 模型手上只有兩個工具：`query_data`（查數字）和 `search_knowledge`（查規定）。
  - 模型呼叫工具時，手機把問題送進問答 API，跟打字問答走同一套反覆查詢與 CRAG，查完再把結果交回模型講出來。
  - 查無依據就照實說，卡片上可以轉給主管；用藥題不給轉主管，請業務詢問醫師或藥師。
  - 因為查詢走問答 API，`LLM_PROVIDER` 也要設定。
- 預設模型是 `gemini-2.5-flash-native-audio-preview-12-2025`，查資料時一定等結果回來才開口（同步函式呼叫），而且規定模型先呼叫工具、呼叫前不說話。9/14 實測過兩種會出事的做法：
  - 「邊查邊聊」：查詢結果還沒回來，模型就自己先講答案。
  - 讓模型先說「我查一下」：常常說完就直接編答案，沒有真的去查。
- `gemini-3.1-flash-live-preview` 反應比較快，但實測會編答案、逐字稿是簡體字，所以不當預設。兩個都是預覽版，要換就改 `VOICE_MODEL`（正式環境在 `values.yaml` 的 `config`）。
- 9/14 起正式環境改用 3.1，還沒用語音實測驗證。上線後要注意：AI 講了數字或規定，畫面上卻沒有出現查詢卡片，就是它沒查就答。要改回 2.5，把 `config.VOICE_MODEL` 留空再推 main。
- AI 說話時暫停收音（半雙工）：手機外放時，模型才不會聽到自己的聲音、把自己打斷。要插話就按「打斷」。
- 查資料時循環播放提示音，查完就停；這段時間也暫停收音，免得提示音被麥克風收進去。音效的來源與授權見 `frontend/public/sounds/README.md`。
- 畫面上業務說的那一句，是 Gemini 另外做的語音轉文字，常有同音錯字，所以標了「語音辨識，僅供參考」。AI 查資料用的是它自己聽懂的問題，寫在查詢卡片上。
- 一分鐘沒有對話會自動掛斷，免得麥克風一直開著、音訊一直計費。Gemini 單次連線大約 10 分鐘就會結束，畫面會提示重新開始。

## 首次使用引導（FR-11）

第一次打開 App 時蓋一層說明，一次一個，講三個主要操作：進門前先看客戶檔案、走出店門講一分鐘、想到就問。看過就記在手機裡（瀏覽器的 localStorage），之後從首頁右上的「使用說明」再打開。主管端不顯示。

## 轉給主管與主管回覆（FR-8.4 延伸）

- 問答查無依據時，業務按「轉給主管回答」。
- **主管端**在 `/manager`（首頁右上「主管端」）：看待回覆的提問和系統當時的回覆，選自己是哪一位主管之後回覆。沒有登入（FR-12／13 不在這次範圍），誰都打得開這頁。
- **業務收到提醒**：首頁每分鐘問一次有沒有新回覆，有的話鈴鐺上顯示則數，客戶清單上方也出現提醒。點進「轉給主管的提問」看回覆，看過就不再提醒；主管改了回覆會再提醒一次。
- 提醒只在 App 開著時看得到。手機網頁要推播，得先裝成 App 並接推播服務，這次沒做。

## 個資與保存期限（NFR-8）

- **確認送出時把逐字稿去識別**：email、身分證字號、電話換成［email］［身分證字號］［電話］；系統裡業務與主管的姓名，以及「姓＋稱謂」（王藥師、陳小姐、林店長）遮成 ○。客戶名稱、品項、競品不遮。送出前業務看的是原文，才能核對。
  - 送出之後的用途都只拿得到遮過的版本：AI 數字查詢讀的 `v_visit_signal`（這個 View 也只收已確認的拜訪）、拜訪紀錄頁。
  - 認不出來的：只講名字（「小明說」）、客戶聯絡人的全名。
- **保存期限**（James 9/14 定），每天台北時間 03:00 由 K8s CronJob `retention` 清理：

| 資料 | 期限 | 理由 |
| --- | --- | --- |
| 錄音 | 確認送出後 60 天 | 涵蓋每月對帳的異議期：《發票與對帳》規定每月 5 日寄出上個月的對帳單、14 天內提異議、業務 5 個工作天內查明 |
| 逐字稿 | 確認送出後 6 個月（184 天） | 系統最長只回頭看 6 個月；個資法第 11 條要求蒐集目的消失就刪除 |
| 沒送出的紀錄 | 建立後 60 天整筆刪除 | 跟錄音同一個期限 |

- 五個欄位寫進 CRM／SAP／OA 之後是那三套系統的紀錄，由它們保存，這裡不刪。
- 期限與遮罩規則在 `backend/app/services/privacy.py`。清理時也會對已送出的逐字稿再跑一次遮罩，規則改了舊的也會跟著遮。本機手動清理：`cd backend && uv run python -m app.jobs.retention`。

## 用量上限（第六週）

沒有登入，網址給出去誰都能用，所以會呼叫 Gemini 的入口都限次數（`backend/app/usage.py`）。超過就回 429 並寫明原因；錄音碰到上限會先存在手機，過了時間自動送出。只算成功的請求，欄位驗證失敗這類不算。

| 項目 | 入口 | 每個 IP 每小時 | 全系統每天 |
| --- | --- | --- | --- |
| 提問（打字與語音問答查資料都算） | `POST /api/asks` | 50 | 200 |
| 語音問答 | `POST /api/voice/session` | 10 | 40 |
| 錄音時的即時文字 | `POST /api/transcription/session` | 15 | 60 |
| 錄音整理（語音辨識＋整理欄位） | `POST /api/visits/audio`、`…/transcript`、`…/reprocess` | 15 | 60 |

- 全系統每天的量，是決賽當天估計用量的約兩倍（推估：排練、簡報，加上約 10 位評審試用，提問約 100 題、語音問答約 20 次、錄音約 30 段）。每個 IP 每小時是每天的四分之一：一個來源至少要四小時才用得完一天的量。
- IP 用 Cloudflare 填的 `CF-Connecting-IP`。決賽現場大家連同一個 Wi-Fi 會共用一個 IP 的額度，簡報的手機建議用行動網路。
- 四項每天都被用滿時，照 2026-09-14 官方價格推估最多約 US$35：

| 項目 | 單次推估 | 每天上限用滿 |
| --- | --- | --- |
| 提問 | gemini-3.8-flash 每題 4～6 次呼叫，約 2 萬輸入、4 千輸出 token，約 US$0.03 | 約 US$6 |
| 語音問答 | 原生語音每秒 25 個 token，輸入 US$3、輸出 US$12／百萬 token；一段最長 15 分鐘約 US$0.34 | 約 US$14 |
| 錄音時的即時文字 | gemini-3.5-transcribe-live 每分鐘約 US$0.009；一段 15 分鐘約 US$0.14 | 約 US$8 |
| 錄音整理 | 一分鐘的口述約 US$0.01；錄音檔上限 20MB（約 80 分鐘）時約 US$0.1 | 約 US$7 |

- 語音問答照 `gemini-2.5-flash-native-audio` 的價格算；`gemini-3.1-flash-live-preview` 在官方價格頁只列了免費層。
- 知識查詢另外會用到 Cohere 精排（每題 1～2 次）和 Firecrawl 網路搜尋（要上網的題目每題 1～3 次）。200 題全部上網的最壞情況，一天約 400 次 Cohere、600 次 Firecrawl，額度看各自的方案。
- Redis 連不上時放行：問答與錄音整理本來就要靠 Redis 排背景工作，Redis 停了也花不到錢。

## 測試語料評測（第二週出場條件）

十句測試語料與標準答案在 [data/eval/voice_corpus.json](data/eval/voice_corpus.json)。照著唸的錄音放在 `data/eval/audio/01.m4a`〜`10.m4a`，這個資料夾不進 git（真人錄音屬於個資）。

```bash
uv run --project backend python backend/scripts/eval_voice.py
```

有錄音就先算語音辨識的字錯率，再算五個欄位的抽取正確率；沒有錄音就只評抽取。會真的呼叫外部服務，費用照用量計。

## 假資料

- 系統的「今天」固定在 2026-10-28（決賽日），存在 `app_setting.as_of_date`，SQL 裡用 `app_today()` 取。評測題庫的答案才不會隨真實日期漂移。灌資料時可用 `--as-of` 改。
- 規模：250 家客戶（連鎖 76、獨立藥局 112、診所 62），5 位業務各負責 50 家；40 個品項、12 個月交易。
- 拜訪紀錄 5,223 筆：照「一位業務一天跑 3～5 家」排，只排平日，一年裡每個平日都有出門。每天先去「距離上次拜訪的天數 × 等級權重」最大的幾家，A 級約 12 天去一次、B 級約 17 天、C 級約 32 天。
- 大部分拜訪是例行拜訪。提到競品、客訴、下單意向、承諾、約再訪的機率照拜訪次數調低，每家客戶一年裡出現這些內容的次數跟原本一年只有 1.9 次拜訪時一樣。
- 拜訪內容的機率跟客戶當下的狀態有關：進貨間隔拉長的比較容易聊到競品，帳款拖著的比較容易有客訴與催款承諾，很久沒進貨的比較容易補到單，合約快到期的比較會談續約。倍率算完再整體縮回原本的平均機率，所以每種內容一年出現幾次不變，變的只是出現在哪些客戶身上。沒有這層關聯，拜訪紀錄裡就沒有「哪種狀態的客戶值得先去」這個訊號，今日路線的排序模型學不到東西（實測 AUC 0.51，跟丟銅板一樣）。
- 原本 80 家的交易與帳款跟之前一模一樣；補的 170 家和拜訪各用另一條亂數產生。補的連鎖分店每次進貨量是原本分店的一半，免得它們剛好少進一次貨的波動，蓋過下面「北區保健品下滑」這個設計好的案例。
- 刻意設計的案例：五家「進貨間隔拉長、單次進貨金額持平」的客戶，名單在 `data/seed/generate.py` 的 `SCENARIO_CUSTOMERS`。其中北區三家連鎖的保健品下滑，縮最多的是魚油；三家裡有兩家近期的拜訪紀錄提到競品御松田。這五家除了寫死的最近一次拜訪，其他都是例行拜訪。
- 數字查詢只能讀四個語意層 View：`v_monthly_sales`、`v_customer_summary`、`v_visit_signal`、`v_margin_breakdown`。唯讀角色是 `semantic_reader`。

## 部署到雲端 VM（K3s）

```
手機 ─HTTPS→ Cloudflare（橘雲）─HTTPS→ VM 上 K3s 的 Traefik ─→ web（Nginx：React 網頁，/api 轉給 FastAPI）─→ api ─→ db
                                                                                                        └→ redis ←─ worker（背景工作）
```

語音問答的聲音是手機直接連到 Gemini Live，不經過 VM；VM 上的 api 只負責發臨時金鑰和執行查詢。

推到 main 之後，GitHub Actions 會依序做這些事：

1. 跑前後端的測試。
2. 建 `api` 和 `web` 兩個映像檔，推到 GHCR。
3. VM 上 MEDDEMO 專用的 GitHub Actions runner 把映像拉進 K3s，用 Helm 部署 `deploy/helm/meddemo`（`helm upgrade --install`，等所有服務就緒才算成功）。做法跟 CARE 一樣，兩個 repo 各有自己的 runner。

以下情況部署時會自動重灌假資料（VM 上的資料庫會清空）：

- 第一次部署
- `models.py` 或 `semantic_layer.sql` 有改動
- 假資料的產生程式 `data/seed/generate.py` 或 `data/seed/catalog.py` 有改動（評測題庫的答案照新資料寫，VM 上的資料要跟著換）

chart 裡另有一個每天台北時間 03:00 跑的 CronJob `retention`，清掉到期的錄音與逐字稿（見上方「個資與保存期限」）。

其他時候要重灌，就到 Actions 手動執行「CI/CD」，並勾選「重灌假資料」。換了金鑰也是手動執行一次，API 和 worker 會重啟以讀到新的值。

要退回舊版，就到 Actions 找之前成功的那次紀錄，按 Re-run all jobs，會重新建出同一版映像再部署。不用 `helm rollback`：部署完會清掉沒在用的映像，GHCR 又是私有的，VM 上的 K3s 自己拉不回舊版。

HTTPS 由 Cloudflare 處理：瀏覽器到 Cloudflare 用 Cloudflare 的憑證；Cloudflare 到 VM 也走 HTTPS，用 Cloudflare Origin 憑證（K3s 內建 Traefik 的預設憑證，涵蓋整個網域），VM 的 443 只對 Cloudflare 的 IP 開放。一定要走 HTTPS，因為手機瀏覽器只在 HTTPS 下允許網頁用麥克風。

### 第一次設定（只做一次）

MEDDEMO 跟 CARE 共用 GCP 上的 care-vm：K3s、Helm、Traefik、HTTPS 憑證和防火牆都已經設好。不要在這台跑 [deploy/bootstrap-vm.sh](deploy/bootstrap-vm.sh)，那支是給全新 VM 用的，遇到已經有 K3s 的機器會直接結束。

1. **在 VM 上裝 MEDDEMO 的 runner**：GitHub 的 Settings → Actions → Runners → New self-hosted runner，複製設定指令裡的 token（一次性，一小時內有效）。把 [deploy/setup-runner.sh](deploy/setup-runner.sh) 複製到 VM，執行 `sudo bash setup-runner.sh --token <token>`。它會建 `meddemo-runner` 帳號、裝在 `/opt/meddemo-runner`，不會動到 CARE 的 runner（`/opt/actions-runner`）。這個帳號在 `k3s` 群組裡讀得到 kubeconfig；sudo 只能把映像拉進 K3s、清掉沒在用的映像。
2. **外部 PR 一律要核准才跑**：Settings → Actions → General，fork PR 的 workflow 核准設定選「Require approval for all external contributors」。這個 repo 是公開的，runner 又裝在正式機上；GitHub 官方建議公開 repo 幾乎不要用 self-hosted runner，因為任何人都能開 PR，在那台機器上執行程式。
3. **在 Cloudflare 加 DNS 記錄**：類型 A、名稱 `meddemo`、內容填 VM 的外部 IP，Proxy 狀態開啟（橘雲）。網址對到哪個服務寫在 [deploy/helm/meddemo/templates/ingress.yaml](deploy/helm/meddemo/templates/ingress.yaml)。
4. **填 GitHub 設定**（Settings → Secrets and variables → Actions）：

| 名稱 | 類型 | 內容 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | secret | 隨機字串，例如 `openssl rand -hex 24` 產生的。第一次部署後就不要再改：Postgres 只在第一次建資料庫時設定密碼。 |
| `SITE_URL` | variable | `https://你的網址`，部署完會打它的 `/health` 確認網站正常 |
| `ASR_API_KEY` | secret | 選填：語音辨識用的 Gemini 金鑰，沒填就沿用 `LLM_API_KEY` |
| `LLM_API_KEY` | secret | 選填：Gemini 的金鑰，到 Google AI Studio 申請 |
| `EMBEDDING_API_KEY` | secret | 選填：embedding 用的 Gemini 金鑰，沒填就沿用 `LLM_API_KEY` |
| `VOICE_API_KEY` | secret | 選填：語音問答用的 Gemini 金鑰，沒填就沿用 `LLM_API_KEY` |
| `FIRECRAWL_API_KEY` | secret | 選填：知識查詢上網搜尋 |
| `COHERE_API_KEY` | secret | 選填：知識查詢精排 |

### 改參數（用哪家服務、哪個模型）

不放 GitHub，寫在 [deploy/helm/meddemo/values.yaml](deploy/helm/meddemo/values.yaml) 的 `config`，跟 CARE-infra 的做法一樣：改檔、commit、推 main，部署時 pod 就會換上新值。

- `config` 底下寫什麼鍵，就產生同名的環境變數，新增參數不必改模板。留空就用程式裡的預設值（見上方「金鑰與供應商」的表格）。
- 換 embedding 模型之後，要手動執行一次部署並勾選「重灌假資料」，文件段落才會重算向量。
- 金鑰不要寫進 `config`：這個 repo 是公開的。

## 目錄

```
backend/app/main.py                 API 入口（FastAPI）
backend/app/api/                    API 路由：客戶、品項、拜訪紀錄、問答、轉給主管、語音問答、模擬系統開關
backend/app/services/               轉文字、抽欄位、背景處理、回寫三套系統、追蹤提醒、問答、語音問答設定、去識別與保存期限
backend/app/services/route_model.py  今日路線的排序模型：特徵、權重、分數
backend/app/services/today_route.py  今日路線：挑今天要去哪幾家、為什麼、三顆鈕的回饋
backend/app/resources/route_model.json  訓練好的權重與成績
backend/app/services/crag/          知識查詢的 CRAG（照搬 CARE 的回答路徑）
backend/app/usage.py                用量上限：會呼叫 Gemini 的入口限次數
backend/app/jobs/                   排程工作：每天清掉到期的錄音與逐字稿
backend/app/gemini.py               Gemini 用戶端（embedding、語音辨識、語音問答共用）
backend/app/tasks.py                Redis 連線、RQ 佇列、處理進度
backend/app/models.py               資料表（SQLAlchemy 2.0 ORM）
backend/app/db.py                   連線、重建 schema、資料表與假資料的指紋
backend/app/sql/semantic_layer.sql  app_today() 與四個語意層 View，建完表後執行
backend/app/schemas                 五欄位 JSON Schema
backend/app/resources/hotwords.txt  語音辨識熱詞表（通路術語與競品；品項從資料庫讀）
backend/scripts/eval_voice.py       第二週：測試語料評測
backend/scripts/eval_ask.py         第四週：數字題、知識題、庫外題評測
backend/scripts/index_documents.py  重建內部文件的索引（關鍵字＋向量）
backend/scripts/train_route_model.py 訓練今日路線的排序模型
backend/tests                       測試
frontend/                           React + Vite + Tailwind + shadcn/ui
frontend/src/voice                  語音問答：收音與播放、Gemini Live 連線
frontend/nginx.conf                 Nginx：放打包好的網頁，/api 轉給 FastAPI
data/seed                           假資料產生器
data/documents                      內部文件（知識查詢的唯一依據，展示用虛構內容）
data/eval                           測試語料、評測題與標準答案
deploy/helm/meddemo                 Helm chart：K3s 上的 api、worker、web、Postgres、Redis、Ingress
deploy/bootstrap-vm.sh              全新 VM 的初始化：安裝 K3s 與 Helm（care-vm 不用跑）
deploy/setup-runner.sh              在 VM 上安裝 MEDDEMO 專用的 GitHub Actions runner
.github/workflows/ci-cd.yml         測試、建映像、部署
docs                                規格文件
```

改資料表就改 `models.py`，本機再跑一次 seed 重建。目前沒有用 Alembic，因為資料全是假資料，每次都從 seed 重建。等到 VM 上的資料需要保留時，再加上 Alembic。

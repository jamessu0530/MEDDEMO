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

本機：把 `backend/.env.example` 複製成 `backend/.env` 再填值，這個檔案不會進 git。正式環境：填在 GitHub 的 Secrets 與 Variables（見下方部署的表格）。

四項外部服務目前都接 Gemini，各自設定。金鑰到 [Google AI Studio](https://aistudio.google.com/apikey) 申請；AI 模型選 Gemini 時，其他三項沒填自己的金鑰，就沿用 `LLM_API_KEY` 那把，所以通常只要填一把。

| 功能 | 要填的設定 | 模型留空時用 |
| --- | --- | --- |
| 語音辨識 | `ASR_PROVIDER=gemini`、`ASR_API_KEY` | `gemini-3.8-flash` |
| AI 模型（抽欄位、問答） | `LLM_PROVIDER=gemini`、`LLM_API_KEY` | `gemini-3.8-flash` |
| 語意檢索 | `EMBEDDING_PROVIDER=gemini`、`EMBEDDING_API_KEY` | `gemini-embedding-001` |
| 語音問答 | `VOICE_API_KEY`（沒填就沿用 `LLM_API_KEY`） | `gemini-2.5-flash-native-audio-preview-12-2025` |

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

## 客戶檔案與談判卡

首頁點客戶會先進客戶檔案（FR-2），連鎖客戶多一張談判卡（FR-3）。內容只來自資料庫的數字和內部文件的原文，不讓 AI 生成。

- **進門前三分鐘**：照數字套規則寫出的重點，最多四句。會提的狀況包括進貨間隔拉長、逾期承諾、近期提到的競品、客訴、帳齡超過 60 天、合約 3 個月內到期。
  - 進貨間隔比之前拉長兩成以上才提醒：目前 80 家客戶裡九成的變化在 7% 以內，刻意設計的五家拉長 41%～63%。
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
- **查規定**：`data/documents/` 的內部文件，一個小節切成一段。關鍵字（中文兩字一組）和語意（pgvector）兩路檢索，用 RRF 融合排序。模型先評估找到的段落夠不夠回答：夠了才回答並附出處；不夠就改寫問法重查，最多兩次；還是不夠就回「查無依據」，業務可以轉給主管。
- 兩條線都在背景跑（RQ），每一步都寫進 `query_trace`，畫面上可以展開查詢過程。
- AI 模型用 Gemini：`LLM_PROVIDER=gemini`，模型預設 `gemini-3.8-flash`；遇到 429、5xx 這類暫時性錯誤會自動重試兩次。embedding 用 `gemini-embedding-001`，文件段落和提問分開算向量；沒設定時只走關鍵字檢索。
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
  - 查無依據就照實說，卡片上可以轉給主管。
  - 因為查詢走問答 API，`LLM_PROVIDER` 也要設定。
- 預設模型是 `gemini-2.5-flash-native-audio-preview-12-2025`，查資料時一定等結果回來才開口（同步函式呼叫），而且規定模型先呼叫工具、呼叫前不說話。9/14 實測過兩種會出事的做法：
  - 「邊查邊聊」：查詢結果還沒回來，模型就自己先講答案。
  - 讓模型先說「我查一下」：常常說完就直接編答案，沒有真的去查。
- `gemini-3.1-flash-live-preview` 反應比較快，但實測會編答案、逐字稿是簡體字，所以不當預設。兩個都是預覽版，要換就改 `VOICE_MODEL`。
- AI 說話時暫停收音（半雙工）：手機外放時，模型才不會聽到自己的聲音、把自己打斷。要插話就按「打斷」。
- 查資料時循環播放提示音，查完就停；這段時間也暫停收音，免得提示音被麥克風收進去。音效的來源與授權見 `frontend/public/sounds/README.md`。
- 畫面上業務說的那一句，是 Gemini 另外做的語音轉文字，常有同音錯字，所以標了「語音辨識，僅供參考」。AI 查資料用的是它自己聽懂的問題，寫在查詢卡片上。
- 一分鐘沒有對話會自動掛斷，免得麥克風一直開著、音訊一直計費。Gemini 單次連線大約 10 分鐘就會結束，畫面會提示重新開始。

## 測試語料評測（第二週出場條件）

十句測試語料與標準答案在 [data/eval/voice_corpus.json](data/eval/voice_corpus.json)。照著唸的錄音放在 `data/eval/audio/01.m4a`〜`10.m4a`，這個資料夾不進 git（真人錄音屬於個資）。

```bash
uv run --project backend python backend/scripts/eval_voice.py
```

有錄音就先算語音辨識的字錯率，再算五個欄位的抽取正確率；沒有錄音就只評抽取。會真的呼叫外部服務，費用照用量計。

## 假資料

- 系統的「今天」固定在 2026-10-28（決賽日），存在 `app_setting.as_of_date`，SQL 裡用 `app_today()` 取。評測題庫的答案才不會隨真實日期漂移。灌資料時可用 `--as-of` 改。
- 規模：80 家客戶（連鎖 24、獨立藥局 36、診所 20）、40 個品項、12 個月交易、150 筆拜訪紀錄。
- 刻意設計的案例：五家「進貨間隔拉長、單次進貨金額持平」的客戶，名單在 `data/seed/generate.py` 的 `SCENARIO_CUSTOMERS`。其中北區三家連鎖的保健品下滑，縮最多的是魚油；三家裡有兩家近期的拜訪紀錄提到競品御松田。
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
| `ASR_PROVIDER`、`ASR_MODEL` | variable | 選填：語音辨識。供應商填 `gemini`，模型留空就用 `gemini-3.8-flash` |
| `ASR_API_KEY` | secret | 選填：語音辨識用的 Gemini 金鑰，沒填就沿用 `LLM_API_KEY` |
| `LLM_PROVIDER`、`LLM_MODEL` | variable | 選填：AI 模型（抽欄位與問答共用）。供應商填 `gemini`，模型留空就用 `gemini-3.8-flash` |
| `LLM_API_KEY` | secret | 選填：Gemini 的金鑰，到 Google AI Studio 申請 |
| `EMBEDDING_PROVIDER`、`EMBEDDING_MODEL` | variable | 選填：語意檢索。供應商填 `gemini`，模型留空就用 `gemini-embedding-001`。設定後要手動執行一次並勾選「重灌假資料」，文件段落才會有向量 |
| `EMBEDDING_API_KEY` | secret | 選填：embedding 用的 Gemini 金鑰，沒填就沿用 `LLM_API_KEY` |
| `VOICE_MODEL` | variable | 選填：語音問答的 Live 模型，留空就用 `gemini-2.5-flash-native-audio-preview-12-2025` |
| `VOICE_API_KEY` | secret | 選填：語音問答用的 Gemini 金鑰，沒填就沿用 `LLM_API_KEY` |

## 目錄

```
backend/app/main.py                 API 入口（FastAPI）
backend/app/api/                    API 路由：客戶、品項、拜訪紀錄、問答、語音問答、模擬系統開關
backend/app/services/               轉文字、抽欄位、背景處理、回寫三套系統、追蹤提醒、問答、語音問答設定
backend/app/gemini.py               Gemini 用戶端（embedding、語音辨識、語音問答共用）
backend/app/tasks.py                Redis 連線、RQ 佇列、處理進度
backend/app/models.py               資料表（SQLAlchemy 2.0 ORM）
backend/app/db.py                   連線、重建 schema、資料表指紋
backend/app/sql/semantic_layer.sql  app_today() 與四個語意層 View，建完表後執行
backend/app/schemas                 五欄位 JSON Schema
backend/app/resources/hotwords.txt  語音辨識熱詞表（通路術語與競品；品項從資料庫讀）
backend/scripts/eval_voice.py       第二週：測試語料評測
backend/scripts/eval_ask.py         第四週：數字題、知識題、庫外題評測
backend/scripts/index_documents.py  重建內部文件的索引（關鍵字＋向量）
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

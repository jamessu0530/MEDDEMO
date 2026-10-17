# Grafana Cloud、Loki 與 k6

Stack：<https://zealousdaffodil871.grafana.net/>。

已建立 [MEDDEMO 系統監控儀表板](https://zealousdaffodil871.grafana.net/d/meddemo-api/meddemo-api) 與 [Cloud k6 的 MEDDEMO 專案](https://zealousdaffodil871.grafana.net/a/k6-app/projects/8492083)。Stack ID 為 `1848419`，k6 project ID 為 `8492083`，Cloud Prometheus username 為 `3621062`。這些 ID 不是金鑰。

2026-10-16 已完成五個 GitHub Secrets 與兩個 Variables 的設定，並驗證指標與壓測結果可送進 Cloud。監控政策 `meddemo-metrics` 僅限此 Stack 的 `metrics:write`，token 於 **2027-01-14** 到期；k6 使用 `MEDDEMO CI` Stack token。當日驗收來源標為 `local-validation`，來自暫時的本機 API。

2026-10-17 已建立 `meddemo-metrics-read` 政策與 `MEDDEMO IT Metrics Read` 金鑰，僅限此 Stack、`job="meddemo/api"` 的 `metrics:read`，於 **2027-01-15** 到期。已存入 `jamessu0530/MEDDEMO` 的 GitHub Actions Secret `GRAFANA_CLOUD_READ_TOKEN`，並使用實際儀表板的摘要、趨勢、路由與實例查詢驗證讀取成功；Cloud 已有 `production` 樣本。新的 IT 頁面與五秒收集設定仍須部署這批程式才會生效。

API 的 Prometheus 指標由同一個 Pod 裡的 Grafana Alloy 每 5 秒抓一次，透過 HTTPS remote write 送進 Grafana Cloud Metrics。不需要在 VM 另外安裝 Prometheus，也不需要給 Alloy Kubernetes API 權限。

## 繁體中文呈現

目前帳號的 Grafana 個人偏好已設為「中文（繁體）」。儀表板的十張圖表、指標說明、環境欄位、收集狀態與功能圖例使用繁體中文；Grafana 官方尚未翻譯的部分外掛文字仍可能顯示英文。其他帳號可在「個人資料 → 偏好設定 → 語言」選擇中文（繁體）。

k6 腳本後續建立的測試使用「MEDDEMO 基本檢查」與「MEDDEMO 登入後查詢壓測」，新測試的回應檢查文字也使用中文。現有測試紀錄仍保留原本英文名稱。環境代碼、HTTP 方法、API 路徑與 Prometheus 指標名稱維持原本識別方式。

## Grafana Cloud Metrics

到 Grafana Cloud Portal 的 Stack → Prometheus → Details，取得 remote write URL 與數字 username。Stack 網址與 remote write URL 是兩個不同網址，請使用 Portal 顯示的完整 `/api/prom/push` URL。

在 GitHub repository 的 Settings → Secrets and variables → Actions 設定以下 **Secrets**：

| 名稱 | 內容 |
| --- | --- |
| `GRAFANA_CLOUD_PROMETHEUS_URL` | `https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/push` |
| `GRAFANA_CLOUD_PROMETHEUS_USERNAME` | `3621062` |
| `GRAFANA_CLOUD_TOKEN` | 限定此 Stack、具 `metrics:write` 的 Cloud Access Policy token |
| `METRICS_TOKEN` | 自行產生的隨機字串，僅供 Alloy 抓取 API |

`METRICS_TOKEN` 可以用 `openssl rand -hex 32` 產生。所有 token 都只放 Secret，不放 `values.yaml`、dashboard JSON 或版控檔案。Cloud Access Policy token 與 Grafana service account token 不同，後者不能代替 remote write token。

四個 Secret 都設定後，執行 CI/CD 部署；流程會建立 `meddemo-monitoring` Secret 並啟用 `monitoring.enabled`。只填一部分會中止部署並列出缺少的名稱。都沒填時維持停用。手動部署時先在 namespace 建立同名 Secret，再加 `--set monitoring.enabled=true`。

在 Stack 的 Dashboards → New → Import 上傳 [`deploy/observability/grafana-dashboard.json`](../deploy/observability/grafana-dashboard.json)，選擇 Cloud Prometheus 資料來源。Dashboard 顯示抓取健康、請求數、5xx 比率、p95 延遲、各路由狀態碼、API process CPU／記憶體與處理中的請求。

驗收：

```bash
kubectl -n meddemo rollout status deployment/api
kubectl -n meddemo logs deployment/api -c alloy --tail=50
```

在 Grafana Explore 查 `up{job="meddemo/api"}` 應為 `1`；操作網站後查 `meddemo_http_requests_total{job="meddemo/api"}` 應持續增加。初次上線的延遲圖需要累積數次抓取；`/health` 和 `/metrics` 不計入流量。

指標只記 HTTP 方法、路由樣板及狀態碼；不記原始 URL、query、客戶編號、帳號、請求內容或 token。未知路由統一記 `unmatched`。網站 Nginx 封鎖 `/metrics`，後端端點另外要求 `Authorization: Bearer <METRICS_TOKEN>`；沒設定 token 時回 404。

目前 Dockerfile 每個 API 容器只有一個 Uvicorn process；若未來加 `--workers`，需先導入 Prometheus multiprocess 模式，並重新設計共用檔案日誌的多行程寫入。CPU／記憶體是 Linux API process 的指標，macOS 本機不提供 `/proc` 指標。目前未收集 worker、資料庫、整台 VM 或 traces；API 日誌需另外啟用下節的 Loki。Alloy WAL 使用暫存磁碟，Pod 重建會遺失尚未送出的資料。

## Loki：API 診斷日誌

流程：**API → Pod 內的 JSONL 共用檔案 → 既有 Alloy → Grafana Cloud Logs（Loki）→ Grafana**。使用現有 Stack 的 Cloud Logs，不在 VM 加裝另一個 Loki server，也不需要 Kubernetes API 權限或主機目錄掛載。

程式與 Helm 已提供此整合；三個 Loki Secrets 未設定時，日誌輸出與收集維持停用，指標監控照常運作。**2026-10-17 已建立三個 GitHub Secrets，仍須部署這批程式才會正式啟用。**

### 連線設定

從 Grafana Cloud Portal 的此 Stack → **Loki / Logs → Details** 取得 push URL 與數字使用者名稱。Loki username 與 Prometheus username 是各自的服務識別值，請分別取得。建立限定此 Stack、僅有 **`logs:write`** 的 Cloud Access Policy token；既有的 `metrics:write` 金鑰不能代替。

新增以下 GitHub Actions Secrets：

| 名稱 | 內容 |
| --- | --- |
| `GRAFANA_CLOUD_LOKI_URL` | Portal 顯示的完整 `https://…grafana.net/loki/api/v1/push` |
| `GRAFANA_CLOUD_LOKI_USERNAME` | 此 Stack 的 Loki 數字使用者名稱 |
| `GRAFANA_CLOUD_LOKI_TOKEN` | 僅具 `logs:write` 的 Cloud Access Policy token |

2026-10-17 已於 `jamessu0530/MEDDEMO` 設定完成上述三個 Secrets。此 Stack 的 push URL 為 `https://logs-prod-030.grafana.net/loki/api/v1/push`、Loki username 為 `1806199`（這兩項不是金鑰）。政策 **`meddemo-loki-write`** 限定 Stack `1848419`、僅有 `logs:write`；金鑰名稱為 **MEDDEMO Loki Write**，有效期 90 天，於 **2027-01-15** 到期。金鑰值只存入 GitHub Secrets，未寫進版控或本文。

已使用這把金鑰向 Cloud Loki Push API 寫入一筆 `environment="local-validation"` 的合成連線驗收日誌，回應 **204**。該筆只含測試欄位、不含客戶資料；這個結果確認雲端端點與寫入權限可用，不代表正式 API 已開始收集。

CI/CD 在三個 Secrets 齊全，且既有四個指標監控 Secrets 也齊全時，建立 `meddemo-logging` Secret 並設定 `monitoring.logs.enabled=true`。部分缺漏或非 Cloud HTTPS push URL 都會中止部署，不會靜默略過。日誌 Secret 僅注入 Alloy，API 與前端都拿不到 Cloud 日誌金鑰。

手動部署時先建立相同 Secret，再使用 `--set monitoring.enabled=true --set monitoring.logs.enabled=true`。日誌不能在 Alloy 指標收集停用時單獨啟用。更換金鑰後需重新啟動 API Pod，讓 Alloy 重讀環境變數。

### 日誌內容與範圍

每個 HTTP 請求完成或發生例外後，寫一筆結構化 JSON，欄位為 UTC `timestamp`、`event`、`level`、HTTP 方法、**路由樣板**、狀態碼、耗時（毫秒）、伺服器產生的 `request_id`、回應是否完整送出。正常請求為 `info`，4xx 為 `warn`，5xx 與未捕捉例外為 `error`。例外另外附類型與最多八個程式位置（檔名、函式、行號），不附原始錯誤訊息、原始碼行或區域變數。

不輸出原始 URL、query、動態路徑值、IP、帳號、客戶編號、請求／回應內容、標頭、Cookie 或 token。不直接轉送 Uvicorn access log 或任意 Python logger 的內容。未知路徑統一記為 `unmatched`，`/health`、`/metrics` 與 WebSocket 不記錄。這是 **HTTP 請求診斷日誌**，不是全部業務事件、背景工作或服務啟動日誌。

Alloy 只把 `job`、`service_name`、`environment`、`namespace`、Pod `instance` 與日誌等級作為主要標籤；路由、狀態碼、request ID 留在 JSON 內查詢，避免大量標籤組合。Alloy 使用事件內的時間戳記，不把檔案讀取時間當成請求發生時間。

API 檔案每 5 MiB 輪替，保留兩份備份，與 Alloy 共用 32 MiB 的 `emptyDir`，Alloy 以唯讀方式掛載。讀取位置存在原有的 Alloy 資料目錄。磁碟寫入失敗時，API 仍可回應，程序只提醒一次。檔案與讀取位置都是暫存儲存，Pod 重建會遺失未送出的日誌；雲端斷線過久也可能因輪替丟失資料，此配置不提供日誌不遺失保證。

### 在 Grafana 查看

匯入 [`deploy/observability/grafana-logs-dashboard.json`](../deploy/observability/grafana-logs-dashboard.json)，選擇此 Stack 的 Loki 資料來源。儀表板名稱為 **MEDDEMO API 日誌**，提供分等級日誌量、所選期間錯誤數、錯誤明細與全部請求；可切換環境並連到既有的系統指標儀表板。

2026-10-17 已匯入[線上日誌儀表板](https://zealousdaffodil871.grafana.net/d/meddemo-api-logs/meddemo-api-e697a5-e8aa8c)，使用 `grafanacloud-zealousdaffodil871-logs` 資料來源，並確認可查到上述合成連線驗收日誌。目前只有 `local-validation` 日誌時，環境選單會選取該環境；正式 API 部署後選擇 `production` 即可查看正式樣本。

也可以在 Grafana **Explore → Loki** 使用：

```logql
# 所有正式環境 API 診斷日誌
{job="meddemo/api", environment="production"} | json

# 錯誤與串流中斷
{job="meddemo/api", environment="production", level="error"} | json

# 超過一秒的請求
{job="meddemo/api", environment="production"} | json | duration_ms > 1000

# 藉由 request ID 尋找某個請求
{job="meddemo/api", environment="production"} | json | request_id = "要查的ID"
```

部署後操作網站，確認上述查詢出現近期樣本。`X-Request-ID` 在 middleware 正常送出的回應標頭中提供；若例外發生在回應標頭送出前，由框架產生的 500 回應可能沒有該標頭，可用時間與路由搜尋。這裡沒有新增 Cloud 告警規則。

本機可將 `REQUEST_LOG_PATH` 指向暫存的 JSONL 檔案驗證輸出；留空停用。Alloy 元件依照官方 [`loki.source.file`](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.file/) 與 [`loki.write`](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.write/) 文件設定。

2026-10-17 本機驗證：監控、HTTP 日誌與 Cloud Metrics 共 **31 項測試通過**；Helm 三種有效組合通過渲染，禁止單獨開日誌的組合正確失敗；部署腳本的完整、部分缺漏與非 HTTPS 端點檢查通過。Alloy v1.20.1 已實際將測試 API 的 200／404／500 三筆日誌送到本機 Loki Push API 接收端，驗證 Basic auth、標籤、JSON 與敏感值排除。這是本機傳送驗證，尚未驗收正式 Cloud Logs。

## IT 頁面的 Cloud 數值

IT「組織管理」頁的系統監控中心直接讀取 Cloud Metrics，提供：

- 12 張數值卡：範圍內請求量、每秒請求數、2xx／3xx 成功比例、p95／p99／平均回應時間、4xx／5xx 錯誤率、CPU、記憶體、處理中請求與成功收集實例數。
- 6 組可互動趨勢：流量、p50／p95／p99 延遲、4xx／5xx、處理中請求、CPU、記憶體。可用滑鼠或左右鍵查看樣本、切換多條曲線的顯示。
- API 路徑搜尋與請求量／慢速／5xx 排行、HTTP 狀態碼分布、逐一實例的收集與資源狀態、程序運行時間。
- 15 分鐘、1 小時、6 小時、24 小時範圍，投影展示模式（Esc 離開）、暫停畫面、手動更新與 JSON 快照匯出。匯出內容不含金鑰。

### 與 Grafana 對齊更新

Alloy 收集、IT 頁面查詢及匯入用 Grafana dashboard 預設均為 **5 秒**。Helm 的 `monitoring.intervalSeconds` 同時設定 Alloy 與 API 回傳的刷新節奏；前端讀取 API 的 `refresh_seconds`，依五秒時鐘邊界查詢，不再保留三十秒快取。後端以時間範圍分開快取，每個時鐘邊界重新查詢；相同範圍的多位 IT 共用該次結果，頁面隱藏時停止查詢。Alloy 的上傳批次最多等待 1 秒。

2026-10-17 已將更新後的 `deploy/observability/grafana-dashboard.json` 重新匯入 Grafana Cloud，以相同 UID 覆寫既有儀表板，並確認線上顯示 **5s**。日後修改 JSON 時也須重新匯入。JSON 預設 `refresh=5s`，流量、錯誤率與延遲統一用最近 `1m` 的樣本，避免 Grafana 的動態 rate interval 與 IT 頁面算出不同數值。IT 的「Grafana」按鈕帶入同一個環境、時間範圍和刷新節奏。

五秒是收集與刷新節奏；資料仍須經過 Alloy 傳送與 Cloud 入庫，兩個畫面不是同一瞬間的原子更新。頁面分別顯示 **Cloud 最新樣本時間**、樣本已經過幾秒及頁面查詢時間，不以新查詢冒充新樣本。樣本超過 20 秒會提示延遲；5xx 達 1% 或 p95 達 1 秒會顯示觀測提示，這些是本頁門檻，不代表已建立 Cloud 告警規則。五秒收集的樣本量是原本三十秒設定的六倍。

`GET /api/admin/metrics?window=15m|1h|6h|24h` 僅限 IT，後端以三個固定、並行的 PromQL 查詢取得摘要、趨勢、路由／狀態碼／實例細項；不接受任意 PromQL 或 Cloud 目的地。曲線最多約 361 點，依時間範圍採 5／15／60／300 秒步長。

### 讀取連線

GitHub Actions Secret **`GRAFANA_CLOUD_READ_TOKEN` 已於 2026-10-17 設定完成**。更換金鑰時，使用限定此 Stack 與 `job="meddemo/api"`、僅有 `metrics:read` 的 Cloud Access Policy token，更新同名 Secret。目前的 `meddemo-metrics` token 僅有 `metrics:write`，不能用來讀取。部署流程將讀取金鑰與既有 `GRAFANA_CLOUD_PROMETHEUS_USERNAME` 注入後端；查詢網址與 dashboard 連結在 Helm `config`，環境沿用 `monitoring.environment`。Cloud token 不會交給前端。查詢使用 [Grafana 官方 Cloud Metrics HTTP API](https://grafana.com/docs/grafana-cloud/send-data/metrics/metrics-prometheus/query-http-api/)。

本機在 `backend/.env` 設 `GRAFANA_CLOUD_QUERY_URL`（Cloud Portal 顯示的 query endpoint，例如 `https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom`）、`GRAFANA_CLOUD_PROMETHEUS_USERNAME` 與 `GRAFANA_CLOUD_READ_TOKEN`；`GRAFANA_CLOUD_REFRESH_SECONDS=5`。預設只看 `production`，要查看驗收資料時可設 `GRAFANA_CLOUD_ENVIRONMENT=local-validation`；不混入正式環境。

未設定、權限不足、Cloud 連線失敗及沒有近期樣本都會說明。缺值顯示 `—`，沒有流量時不估算成功率或錯誤率；CPU 是使用核心數，記憶體為 MiB，僅涵蓋 API process。HTTP 狀態碼分布、請求總量、路由錯誤數採所選時間範圍；即時比率與路由 p95 採最近一分鐘。Grafana 入口仍需自己的 Grafana 登入。

## k6 本機執行

安裝 [官方 k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)；CI 固定使用 `grafana/k6:2.3.0`。先依 README 啟動本機 API。腳本預設只打 `localhost`、`127.0.0.1` 或 `::1`。

```bash
# 公開端點：1 個 VU，10 秒。
k6 run tests/k6/api.js

# 登入後讀取：20 個 VU，1 分鐘。使用專用測試帳號。
read -r K6_EMAIL
read -rs K6_PASSWORD
export K6_EMAIL K6_PASSWORD
SCENARIO=read k6 run tests/k6/api.js
unset K6_EMAIL K6_PASSWORD
```

也能使用環境變數 `K6_TOKEN` 代替帳密。登入只在 setup 做一次，避免每個 VU 互相踢掉登入；同一次測試的 VU 共用該 session，因此模擬的是並行請求，並非不同帳號的權限或在線人數。測試期間不要在別台裝置登入這個帳號。

`read` 測試 `/api/auth/me`、客戶清單／單筆、商品、頻道清單、未讀數；只讀取，不呼叫 AI、Google Maps、錄音或寫入 API。使用帳密時，setup 的登入會更新該測試帳號的 session version。舊有 Python 壓測繼續負責點站、位置上傳與 WebSocket／訊息寫入情境。

可用 `BASE_URL`、`VUS`（1～100）、`DURATION`、`THINK_TIME` 調整。預設每輪停 1 秒。通過條件：所有內容檢查成功、HTTP 錯誤率低於 1%、p95 小於 1 秒，而且確實完成請求與 iteration。門檻不通過時 k6 以非零代碼結束。

```bash
# 明確選擇遠端網站，先用 1 VU 做 smoke。
BASE_URL=https://meddemo.jamessu2016.com ALLOW_REMOTE=true \
  VUS=1 DURATION=10s k6 run tests/k6/api.js

# JSON 結果可供後續比較。
mkdir -p output/k6
k6 run --summary-export=output/k6/summary.json tests/k6/api.js
```

遠端必須明確設 `ALLOW_REMOTE=true` 且使用 HTTPS。不要拿正式人員日常使用的帳號做壓測。

## Grafana Cloud k6 與 GitHub Actions

在 Stack 的 Testing & synthetics → Performance → Settings 取得 Cloud k6 Stack token 與 Stack ID。腳本預設使用 MEDDEMO project ID `8492083`，可用 `K6_CLOUD_PROJECT_ID` 改選其他專案。Stack token 能存取這個 Stack 所有 k6 專案，且不會自動到期；只存於受保護的 Secrets，不放程式碼。CLI 在本機送流量，結果上傳 Cloud：

```bash
# 先在環境中設定 K6_CLOUD_TOKEN、K6_CLOUD_STACK_ID；預設使用 MEDDEMO 專案。
k6 cloud run --local-execution --include-system-env-vars \
  --no-archive-upload --no-cloud-logs --no-cloud-secrets --no-usage-report tests/k6/api.js
```

使用 [`Grafana 官方 Cloud CLI 說明`](https://grafana.com/docs/k6/latest/reference/cloud-commands/) 的 `--local-execution`，本機 API 不必開到外網。上述指令只傳效能資料，不上傳腳本封存檔或 console log。k6 正常請求以路由樣板分組並關閉 URL 標籤；Cloud 必要的 `error` 標籤可能在網路錯誤時帶 URL，因此測試帳號應只存取測試資料。不要啟用 HTTP debug 或將 token 寫進腳本。

每次 PR／推送的 CI/CD 會在獨立的 CI 資料庫灌假資料，跑公開端點與登入後讀取的 k6 smoke（各 2 VU、5 秒），失敗就不建置／部署；摘要留在 Actions artifact `k6-results`。

要測遠端，在 Actions 手動執行 **k6 load test**：選 URL、scenario、VU、時間。它預設 1 VU、10 秒、公開端點；`read` 使用 GitHub Secret `K6_TOKEN` 或 `K6_EMAIL`＋`K6_PASSWORD`。勾選 Cloud 時另需 Secret `K6_CLOUD_TOKEN` 與 Variable `K6_CLOUD_STACK_ID`；Variable `K6_CLOUD_PROJECT_ID` 選填。結果保存在 Actions artifact，Cloud 模式也會顯示於該 Stack。遠端負載測試只由手動觸發，避免每次 push 都對正式站加壓。

Alloy 設定依照 [官方 Prometheus 收集文件](https://grafana.com/docs/alloy/latest/collect/prometheus-metrics/)；測試通過條件依照 [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)。

## 2026-10-16 本機驗證

- 監控、登入與用量上限共 51 項 pytest 通過。
- Helm 開啟／關閉監控皆通過 lint 和渲染；渲染後的設定通過 Alloy v1.20.1 `validate`。
- k6 v2.3.0 公開端點：2 VU、5 秒，20 個請求，錯誤率 0%，p95 約 223 ms。
- k6 登入後唯讀查詢：20 VU、10 秒，699 個請求，錯誤率 0%，p95 約 452 ms。
- API 真實 `/metrics` 回應可由 Prometheus parser 解析；客戶路徑以樣板分組，不含測試金鑰或健康探針。
- 未允許的遠端目標、無效 VU／scenario／think time 會在執行前失敗；兩份工作流程的 shell 區段通過 `bash -n`。
- Cloud Metrics：Alloy 已成功寫入，儀表板顯示 `up=1`、請求率、0% 5xx 與 p95。來源為 `local-validation`；macOS 的 process CPU／memory 圖無資料屬預期。
- [正式站 Cloud k6 smoke](https://zealousdaffodil871.grafana.net/a/k6-app/runs/8824057)：1 VU、5 秒，8 個請求、0 錯誤，5 項門檻與 8 項檢查全過；CLI p95 約 252 ms，Cloud 的彙整圖約 265 ms。
- [本機唯讀查詢上傳 Cloud](https://zealousdaffodil871.grafana.net/a/k6-app/runs/8824060)：2 VU、10 秒，111 個請求、0 錯誤，CLI p95 約 75 ms。

這些數字來自本機隔離資料庫與短時間測試，不能推論正式站容量。摘要放在被 git 忽略的 `output/k6/2026-10-16-*.json`；GitHub Actions 的實際執行仍要等提交後驗證。

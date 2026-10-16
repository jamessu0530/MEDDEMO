# Grafana Cloud 與 k6

Stack：<https://zealousdaffodil871.grafana.net/>。

已建立 [MEDDEMO 系統監控儀表板](https://zealousdaffodil871.grafana.net/d/meddemo-api/meddemo-api) 與 [Cloud k6 的 MEDDEMO 專案](https://zealousdaffodil871.grafana.net/a/k6-app/projects/8492083)。Stack ID 為 `1848419`，k6 project ID 為 `8492083`，Cloud Prometheus username 為 `3621062`。這些 ID 不是金鑰。

2026-10-16 已完成五個 GitHub Secrets 與兩個 Variables 的設定，並驗證指標與壓測結果可送進 Cloud。監控政策 `meddemo-metrics` 僅限此 Stack 的 `metrics:write`，token 於 **2027-01-14** 到期；k6 使用 `MEDDEMO CI` Stack token。正式站的持續收集要等這批程式提交並部署後才啟用；驗收時的指標來源標為 `local-validation`，來自暫時的本機 API。

API 的 Prometheus 指標由同一個 Pod 裡的 Grafana Alloy 每 30 秒抓一次，透過 HTTPS remote write 送進 Grafana Cloud Metrics。不需要在 VM 另外安裝 Prometheus，也不需要給 Alloy Kubernetes API 權限。

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

目前 Dockerfile 每個 API 容器只有一個 Uvicorn process；若未來加 `--workers`，需先導入 Prometheus multiprocess 模式。CPU／記憶體是 Linux API process 的指標，macOS 本機不提供 `/proc` 指標。此版本未收集 worker、資料庫、整台 VM、日誌或 traces。Alloy WAL 使用暫存磁碟，Pod 重建會遺失尚未送出的資料。

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

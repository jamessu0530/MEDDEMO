# 一般行事曆

新版 `/calendar` 在原本的客戶備忘旁加入獨立的一般日曆。活動不必綁客戶；個人日曆屬於實際登入的帳號，代理示範業務或切換 Demo 身分不會共用私人的行程。日曆的今天採真實台北日期，原本的拜訪資料仍維持自己的展示日期規則。

## 功能與操作

| 功能 | 操作 |
| --- | --- |
| 完整行程 | 右上新增：標題、日曆、開始／結束、時區、全天、地點、附註、網址、提醒與受邀者 |
| 日／週／月／清單 | 切換時日曆淡入淡出並輕微滑動，選取底色同步滑動；約 0.28 秒，快速連點採最後一次選擇，系統「減少動態效果」開啟時直接切換。日期選擇器可跳到指定日期，「今天」回到現在 |
| 大量行程 | 日期歸組、全天行程、重疊排版與搜尋分組由獨立 Web Worker 計算；預先整理整月，選日期或切換檢視重用結果。快速切換只處理最新待辦，離開頁面釋放 worker；不支援或載入失敗時分批計算並讓出主執行緒 |
| 全天與跨日 | 全天的結束日期在畫面上包含當天，資料儲存為隔天午夜；一般活動可以跨午夜 |
| 重複活動 | 每天、每週、每月、每年；可調整間隔、每週的星期，以及結束日期／次數 |
| 編輯重複 | 只改這次、這次及之後、整個系列；單次例外、取消與額外日期可透過 ICS 保留 |
| 拖曳 | 拖曳活動右側到日期或時段；六點圖示全站隱藏，操作區仍保留。日／週檢視拖曳底部把手可調整結束時間 |
| 重疊活動 | 日／週時間軸將重疊活動並排，週檢視在手機內部橫向捲動 |
| 複製／刪除 | 打開活動使用底部按鈕；刪除需再確認套用範圍 |
| 搜尋 | 搜尋標題、地點、附註，跨月份查找，也包含單次修改的內容 |
| 彩色分類 | 設定中新增／改名／改色，側邊欄個別顯示或隱藏；顯示偏好儲存在帳號 |
| 共享日曆 | 擁有者搜尋站內帳號，邀請可檢視或可編輯；對方接受後取得權限，可隨時移除 |
| 單一活動邀請 | 填 Email；站內帳號可接受、暫定或拒絕，只能看到獲邀活動 |
| 外部邀請 | 儲存後下載標準 ICS 邀請；設定 SMTP 後也能明確按下「傳送 Email 邀請」 |
| 外部回覆 | 郵件附私密回覆連結，外部對象不需帳號也能查看活動並接受、暫定、拒絕；刪除活動／受邀者會使連結失效 |
| 提醒 | 每個活動最多五次；登入期間站內提醒全站顯示，可啟用裝置的背景推播 |
| 舊的紀錄 | 勾選「拜訪與客戶備忘」後可查看當日紀錄、直接修改備忘或新增客戶備忘 |

## 日曆交換與同步

- **ICS 匯入／匯出**：在設定選擇一本日曆。同一本內用 UID 去重並更新原活動。上限 2 MB／2000 個 VEVENT，保留時區、全天、RRULE、RDATE、EXDATE、RECURRENCE-ID、提醒與邀請回覆。支援日以上的重複頻率，不接受秒／分鐘／小時級重複或 THISANDFUTURE 格式的例外。
- **提供訂閱**：擁有者產生私密唯讀 ICS 連結，貼到 Apple／Google 等行事曆訂閱。連結持有者可讀取整本日曆，撤銷或重設後舊連結立即失效；後端只儲存 token 雜湊。
- **訂閱外部 ICS**：設定 → 連接外部日曆 → ICS 唯讀訂閱，貼入 HTTPS／webcal 網址；提供台灣節日訂閱範例。唯讀活動在原服務編輯，不能在這裡回覆邀請。Google 可用其秘密 ICS 網址訂閱，這不是 Google OAuth 雙向同步。
- **CalDAV 雙向**：設定 → 連接外部日曆 → CalDAV。iCloud 使用 `https://caldav.icloud.com/`、Apple 帳號與 App 專用密碼；取得清單後選擇一本日曆再連接。也可填管理員允許的其他 CalDAV 集合網址。
- **更新與衝突**：每五分鐘同步，可手動立即同步。使用 ETag 與 If-Match／If-None-Match 防止覆蓋外部修改；衝突時保留本機內容，擁有者可選擇採用外部或保留本機。未同步的刪除先保留 tombstone，成功同步後才視為已送出。
- **憑證**：以 Fernet 加密保存；可用 `CALENDAR_ENCRYPTION_KEY`，未填時由穩定的 `JWT_SECRET` 衍生。兩者都沒有設定時不儲存 CalDAV 帳號。不要輪替這把金鑰而未重新連接外部帳號。
- **網址限制**：僅允許 HTTPS、公開 IP、`CALENDAR_REMOTE_HOSTS` 中的主機；不接受網址內夾帶帳號密碼。其他供應商需由管理員加入允許清單。CalDAV 伺服器須提供 ETag。

## 安裝與保留資料升級

### 日曆示範資料

```sh
uv run --project backend python data/seed/seed_calendar.py --all-users
# 也可只替一個帳號新增，或指定基準日期
uv run --project backend python data/seed/seed_calendar.py --user U01 --today 2026-10-17
```

依真實台北今天建立工作、團隊、生活三本標示「示範」的日曆，每個帳號十筆行程系列，包含今天的行程、時間重疊、每週重複與全天跨日。可正常編輯、拖曳或刪除，也能在側欄隱藏整本示範日曆。資料不含提醒或邀請。此指令只新增資料，可重複執行，不改寫既有行程或使用者對示範資料的修改；重灌資料庫後需重新執行。

2026-10-17 已在正式站為當時的 19 個帳號各自新增 10 筆，共 190 筆示範行程。

### 日曆資料表

```sh
uv sync --project backend
backend/.venv/bin/python backend/scripts/create_planner_tables.py
```

第二行只新增六張日曆表，不重灌、不刪除既有資料，也不改原有 schema_version。正式部署的 `upgrade_schema.py` 另有從上一版到新版的保留資料升級路徑。既有非日曆的資料表若版本落後，仍需使用該版本原本的升級流程。

## 背景提醒與排程

共用工作位於 `backend/app/jobs/calendar.py`：每分鐘建立去重提醒並發送 Web Push，每五分鐘同步外部日曆。站內每 30 秒檢查提醒，即使背景工作暫時不可用也可補建站內通知。通知保留七天；已結束的行程不補發。

本機另開一個終端機，從專案根目錄啟動獨立的 APScheduler 程序：

```sh
PYTHONPATH=backend uv run --project backend python -m app.jobs.calendar_scheduler
```

- 啟動時立即檢查提醒及同步，之後在每分鐘整分處理提醒、每五分鐘整分同步。
- 兩項工作分別執行，慢速同步不阻塞提醒；同一項工作不重疊執行。暫時失敗會記錄錯誤，下一輪仍會繼續。
- 電腦休眠後恢復，只補執行一次符合寬限時間的排程，避免累積大量工作；提醒依資料庫中尚未結束的活動重新檢查。
- `Ctrl+C` 或 `SIGTERM` 會等待執行中的工作完成再關閉。API 熱重載不會另開排程，API 使用多個 worker 也不會重複註冊。
- 工作定義每次啟動重新註冊，行程、提醒與去重紀錄仍保存在原資料庫，不需要新增 APScheduler 的資料表或額外的 Redis。

正式環境保留 Helm 的 `calendar-reminders` CronJob，無需啟動常駐程序。同一環境選用一種啟動方式；資料庫的工作鎖和日曆列鎖另可防止誤開第二個程序時重疊處理。

```sh
backend/.venv/bin/python backend/scripts/generate_calendar_keys.py
```

把輸出的 `CALENDAR_ENCRYPTION_KEY`、`CALENDAR_VAPID_PRIVATE_KEY` 存入 `.env` 或同名 GitHub Secrets；`CALENDAR_VAPID_SUBJECT` 填管理員的 `mailto:` 或 HTTPS 聯絡網址。不要將實際金鑰提交到 Git。正式部署已將這些 Secret 接到 API 與背景工作。

瀏覽器需允許通知，且網站需 HTTPS（本機 localhost 可用）。iPhone 的網站推播需先加入主畫面，從主畫面開啟後啟用。推播訂閱綁定登入版本，登出、改密碼或新登入讓舊工作階段失效後，舊訂閱會停用。未設定 VAPID 時，畫面明確顯示只有站內提醒。

若只需手動檢查一次提醒（並在五分鐘整分同步），可執行原本的單次入口：

```sh
PYTHONPATH=backend backend/.venv/bin/python -m app.jobs.calendar
```

## Email 邀請設定

設定 `CALENDAR_SMTP_HOST`、`CALENDAR_SMTP_PORT`、`CALENDAR_SMTP_FROM`、`CALENDAR_PUBLIC_BASE_URL`（公開 HTTPS 網站）。需登入的 SMTP 另填 `CALENDAR_SMTP_USERNAME`、`CALENDAR_SMTP_PASSWORD`。預設 465／TLS；使用 587 時設 `CALENDAR_SMTP_STARTTLS=true`。正式部署的 SMTP 帳密放同名 GitHub Secrets，其餘放 Helm `config`。

未設定 SMTP 時仍可站內邀請及下載 ICS。設定後，使用者儲存活動、重新開啟，明確按「傳送 Email 邀請」才寄送已儲存的版本；不會因新增或背景同步自動寄信。同一組受邀者五分鐘內不可重複寄送，不設帳號或全站每日寄送額度。寄送結果逐人回報成功或失敗。

## 驗證

- 前端：`planner.test.ts`、原本 `calendar.test.ts` 與桌面版面測試，驗證時區／夏令時間、跨日邊界、完整週、重疊排版與拖曳長度。
- 後端：`test_planner_unit.py`、`test_planner_api.py`、`test_planner_connections.py`，以及既有備忘與保留資料升級測試。`test_calendar_scheduler.py` 驗證排程時間、啟動、工作失敗／重疊與正常停止；`test_calendar_jobs.py` 使用 Postgres 驗證跨程序鎖及同步失敗隔離。
- CalDAV、SMTP 與推播採可控制的模擬服務測試，驗證條件寫入、衝突處理、加密、Email 內容、公開回覆的轉義與推播工作階段檢查；不使用真實外部帳密。
- 手動操作：手機與桌面新增重複活動、日／週／月／清單切換、搜尋、拖曳改期、分類管理。

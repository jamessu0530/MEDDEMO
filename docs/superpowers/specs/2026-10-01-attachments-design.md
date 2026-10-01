# 附件、看圖與圖片搜尋

2026-10-01

問答與頻道可以傳照片和 PDF；AI 看得懂附件，頻道的 AI 主理整理記憶時把圖片一起納入，
整個系統換成 `gemini-embedding-2`，用同一個向量空間做圖片搜尋（文字找圖、圖找文件、以圖找圖）。

這份接在〈頻道與 AI 主理記憶〉（2026-09-28）之後。那份的第 2–4 階段（記憶、AI 主動、問答頁查記憶）
**這次一起做**，照原設計，這份只寫因為有附件而增加或改變的地方，以及原 spec「第一階段做完後留給之後的事」怎麼處理。
兩份衝突時以這份為準。

## 已定案的決定

1. **檔案存在 Postgres**（bytea），跟 `VisitAudio` 一樣，不另外掛 volume：API 與 worker 不必共用磁碟，
   刪帳號、刪訊息靠 CASCADE 一起清掉，不會有資料庫刪了、檔案還在的情況。
2. **只收圖片與 PDF**。這兩種 Gemini 看得懂、embedding-2 算得了向量；Office 檔不收。
3. **上傳時看一次、算一次向量**，之後重複用：每個附件由 Gemini 寫一段說明（含圖上的字），並算 embedding-2 向量。
   搜尋走向量加關鍵字；需要真的看圖時（問答附的圖、整理記憶的那一批）才送原檔，其他時候給說明。
4. **全部換成 `gemini-embedding-2`**：知識庫段落、記憶重點、附件、提問共用一個向量空間。
   它跟 `gemini-embedding-001` 的向量不相容，段落要重算。
5. **圖片搜尋四個地方都做**：問答用照片找知識庫、問答的頻道記憶找得到照片、頻道的搜尋頁、以圖找圖。
6. **AI 可以挑圖跟著重點往上傳，組內可以撤回**。往上傳的圖全公司看得到（跟往上傳的重點一樣）。
7. **示範用的圖由程式畫**，產出 commit 進 repo，灌資料不需要字型也不呼叫 AI。

## 資料模型

### `attachment`

一個檔案一列。

| 欄位 | 內容 |
|---|---|
| `id` | bigint identity |
| `message_id` | FK `channel_message`，`ON DELETE CASCADE` |
| `ask_id` | FK `ask_record`，`ON DELETE CASCADE` |
| `uploader_id` | FK `app_user`，`ON DELETE CASCADE`；實際登入的帳號，不是代理的那位 |
| `kind` | `image`／`pdf` |
| `filename` | 原檔名 |
| `mime_type` | `image/jpeg`／`image/png`／`application/pdf` |
| `size_bytes` | 處理後的大小 |
| `content` | 處理後的檔案（bytea） |
| `thumbnail` | 長邊 480px 的 JPEG（bytea）；PDF 是 NULL |
| `width`、`height` | 圖片才有 |
| `page_count` | PDF 才有 |
| `caption` | Gemini 寫的說明；還沒處理或處理失敗是 NULL |
| `search_tokens` | TSVECTOR，GIN 索引；從檔名、說明、所屬訊息的文字（提問的附件用問題）切出來（切法同 `services/retrieval.py`） |
| `status` | `pending`／`ready`／`failed` |
| `created_at` | |

CHECK：`message_id` 與 `ask_id` 剛好一個有值。

### `attachment_vector`

| 欄位 | 內容 |
|---|---|
| `id` | bigint identity |
| `attachment_id` | FK `attachment`，`ON DELETE CASCADE`，有索引 |
| `page_from`、`page_to` | PDF 這一段的頁數（1 起算）；圖片是 NULL |
| `embedding` | `Vector()`，不固定維度，不建近似索引（附件量級逐筆比對就夠） |

圖片一張一列；PDF 每 6 頁一列（embedding-2 一次最多 6 頁）。

### 改既有的表

- `memory_item`（原 spec 的記憶）多兩欄：
  - `attachment_ids bigint[]`：這條重點的來源附件；
  - `shared_attachment_ids bigint[]`：跟著往上傳的附件，一定是 `attachment_ids` 的子集。
- `channel_message` 多 `deleted_at`、`deleted_by`（FK `app_user`）：IT 刪訊息用，見〈IT 刪訊息〉。
- `MessageInput.body` 有附檔案時可以是空字串；沒附檔案時照舊 1–2,000 字。

## 上傳

### 端點

不做「先上傳、再附上」的兩段式，所以不會有沒人要的檔案。

- `POST /api/channels/{id}/messages`：除了現在的 JSON，也接受 multipart（`body` 加最多 4 個 `files`）。
- `POST /api/asks`：除了現在的 JSON，也接受 multipart（`kind`、`question` 加 1 個 `file`）。

### 前端先壓

- 照片用 canvas 縮到長邊 2048px、JPEG 品質 0.85 再上傳；原本就比較小的不放大。
- `<input type="file" accept="image/*,application/pdf">`；iPhone 選照片時 HEIC 會自動轉成 JPEG。
  瀏覽器解不開的圖（例如桌機 Chrome 選到 HEIC）就原檔送，讓後端回 415。
- PDF 不動。

### 後端再處理一次（不信任前端）

- 圖片用 Pillow：
  1. 打開並驗證，打不開或格式不在 JPEG／PNG／WebP 裡就 415「請改用 JPEG 或 PNG」。
  2. 依 EXIF 轉正（`ImageOps.exif_transpose`）。
  3. **清掉全部的 EXIF**：照片常在客戶店裡拍，GPS 位置不能留著。
  4. 長邊超過 2048px 就縮。
  5. 重新存：有透明背景存 PNG，其他存 JPEG 品質 85（embedding-2 只收 JPEG 與 PNG）。
  6. 另存長邊 480px 的 JPEG 縮圖。
- PDF 用 pypdf：打不開、有加密、超過 60 頁就 415，訊息寫出原因。
- 大小：單檔超過 15MB 回 413；整個請求由 Nginx 的 `client_max_body_size 20m` 擋。
- 一則訊息超過 4 個檔案、一次提問超過 1 個檔案回 422。

### 用量上限

`usage.py` 多兩個桶，`ROUTES` 加對應的路徑，`tests/test_usage.py` 與 README 的表一起改：

| 桶 | 名稱 | 每個帳號每小時 | 全系統每天 |
|---|---|---|---|
| `attachment` | 上傳附件 | 30 | 500 |
| `attachment_search` | 搜尋附件 | 60 | 1,000 |

`attachment` 掛在發言與提問的 POST 上，但只算 `Content-Type` 是 `multipart/form-data` 的請求
（中介層在讀內容之前就計數，只看得到標頭；同一個請求也照舊算 `channel_post` 或 `ask`）；
`attachment_search` 掛在 `POST /api/channels/search`。

## 看附件

### 簽名網址

前端的 `<img>` 帶不了 Bearer token，所以 API 回傳附件時附上簽過名的網址：

- `url`：`/api/attachments/{id}?sig=…`
- `thumb_url`：`/api/attachments/{id}/thumb?sig=…`（PDF 沒有）

`sig` 用 `jwt_secret` 簽，內容是附件編號、使用者編號、到期時間（一小時）。

### 誰看得到

`can_see_attachment(user, attachment)`，下面任一條成立就看得到：

1. 附件在頻道訊息上，而且這個人看得到那個頻道（`services/channels.py` 的 `can_see`）。
2. 附件在提問上，而且是提問的人；或這題轉給主管了，而且這個人看得到那筆轉介（主管端的規則）。
3. 附件在某條 `shared`、沒撤回、沒刪除的重點的 `shared_attachment_ids` 裡（全公司都看得到）。

### 取檔

- 先驗簽名（沒過期、使用者存在），**再用 `can_see_attachment` 查一次權限**：撤回往上傳、IT 刪訊息都要立刻生效。
- 看不到一律 404。
- 回應 `Cache-Control: private, max-age=300`，`Content-Type` 用 `mime_type`；
  PDF 加 `Content-Disposition: inline; filename*=UTF-8''…`。
- 縮圖端點對 PDF 回 404。

## 背景處理附件

### 頻道附件

發言寫入後，每個附件排一個 `process_attachment(attachment_id)` 到 `channels` 佇列，
RQ `Retry(max=2, interval=30)`。工作內容：

1. **寫說明**：`LLM.atext`，附原檔。提示要求：繁體中文、200 字以內；
   寫出這是什麼（店內陳列、海報、價目表、仿單、報價單、DM…）與圖上看得到的字（品名、品牌、價格、標語）；
   **不描述人的長相、不猜是誰**；PDF 只寫標題與前幾頁的重點。
2. **算向量**：圖片一個；PDF 用 pypdf 每 6 頁切一份各算一個。
3. 用檔名、說明、所屬訊息的文字重算 `search_tokens`，`status` 設 `ready`。

重試完還是失敗就設 `failed` 並記 log：圖照樣看得到，只是向量搜不到（關鍵字還搜得到檔名與訊息文字）。
沒設定 LLM 時跳過說明、沒設定 embedding 時跳過向量，兩個都沒有也設 `ready`。

### 提問附件

不排工作，在 `run_ask` 一開始當場做同樣的事（回答馬上要用）。失敗就不用說明與向量，照常回答。

## embedding-2

- `DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2"`，維度用預設的 3072。
- embedding-2 沒有 `task_type`，改成加在文字前面：
  - 文件段落：`title: {文件標題｜小節} | text: {內文}`
  - 提問：`task: search result | query: {問題}`
  - 實作時照官方文件（ai.google.dev/gemini-api/docs/embeddings）再核對一次格式與一次能送幾段。
- `Embedder` 介面：
  - `embed_documents(texts)`：不變（前綴改了）。
  - `embed_query(text, media=None)`：`media` 是一串 `(bytes, mime_type)`；文字與圖片放進**同一個** `Content`，
    合成一個向量（「這個盒子的藥怎麼賣」要一起算）。只有圖片時就只放圖片。
  - `embed_media(items)`：一個檔案一個向量，每個檔案各包成一個 `Content`；圖片一次最多 6 張，PDF 一次一份。
- 沒設定或呼叫失敗：照現在的做法退回只用關鍵字。
- 換模型後知識庫段落要重算。這次 `models.py` 一定會改，`schema_version` 的指紋跟著變，部署時自動重灌，段落跟著重算。
- `values.yaml` 的 `EMBEDDING_MODEL` 註解改寫：預設是 embedding-2；改回 001 只剩文字檢索，附件與以圖找圖都會失敗退回關鍵字。

## LLM 看得到圖

- `LLM.json`／`ajson`／`atext` 多一個參數 `media: Sequence[tuple[bytes, str]] = ()`。
- `GeminiLLM` 把每個檔案包成 `types.Part.from_bytes(data=…, mime_type=…)`，放在提示文字前面，
  寫法同 `services/transcription.py` 的 `GeminiTranscriber`。
- **一次呼叫附的原檔加起來最多 18MB**（inline 的請求上限是 20MB）。由呼叫的地方挑：照順序放，放不下的改在提示裡給說明。
  有這個上限就不必走 `files.upload`。
- 測試裡的假模型（`ScriptedLLM`、`tests/crag_fakes.py` 的 `TextLLM` 等）都加上這個參數。

## 問答附圖

### 畫面

- 問答輸入框旁加迴紋針按鈕（拍照、選照片、選 PDF），一次 1 個，選好後在輸入框上方顯示縮圖，可以拿掉。
- 送出後，提問的泡泡裡顯示縮圖（`conversation.ts` 的使用者發言多一個附件欄位）。
- `AskDetail` 多 `attachment`（id、kind、filename、url、thumb_url）。
- 轉給主管的題目，主管端顯示同一張圖。

### 流程

`run_ask` 第一步處理附件，`QueryTrace` 記一步 `attachment`，`decision` 放說明，查詢過程的面板看得到 AI 從圖上讀出什麼。

- **數字**（`data_agent.answer_data`）：每一輪與最後一次的 `llm.json` 都附原檔，提示多一行「使用者附的檔案：{說明}」。
- **知識**（CRAG）：
  - 向量檢索：`embed_query(問題, media=[原檔])`。
  - 關鍵字檢索：問題加說明。
  - 評分（grader）與改寫（rewriter）只給說明；產生答案時附原檔。
  - 上網搜尋只用文字查詢，不送圖。
  - 其他流程不變。
- **頻道記憶**（原 spec 的 `kind = memory`）：見〈問答查頻道記憶〉。

語音問答不能附圖。

## 頻道

### 發言與訊息泡泡

- 輸入框旁加迴紋針，一次最多 4 個檔案；選好後在輸入框上方顯示縮圖，可以拿掉。有附檔案時文字可以空白。
- 送出時顯示上傳進度；失敗就留在輸入框（文字與檔案都在），讓人重送。
- `MessageItem` 多 `attachments`（id、kind、filename、page_count、width、height、url、thumb_url）。
- 圖片：1 張顯示大圖；2–4 張排成格子。點了全螢幕看，可以左右滑、點一下關掉。
- PDF：圖示、檔名、頁數的卡片，點了在新分頁開。
- 附件還沒處理完不另外標示。

### 跳回原訊息

`GET /api/channels/{id}/messages?around={message_id}`：回傳那則前後各 20 則，前端捲過去並標亮。
原 spec 看板「點一下捲到原始訊息並標亮」和搜尋頁共用。那則看不到或不在這個頻道就 404。

### IT 刪訊息

`DELETE /api/channels/messages/{id}`，只有 IT 能用：

- 附件整列刪掉（向量跟著 CASCADE）。
- 訊息內容換成「（這則訊息已被 IT 刪除）」，記 `deleted_at`、`deleted_by`；畫面上換成灰字。
- 從這則整理出來的重點留著，IT 要刪就用原 spec 的 `DELETE /api/memory/{id}`。
  重點的 `attachment_ids`、`shared_attachment_ids` 裡已經不存在的附件，讀的時候略過。
- 發言的人自己還是不能刪、不能改（原 spec 的決定不變）。

## AI 主理與記憶

原 spec 的整理記憶、看板、@AI、週摘要、逾期提醒、風險通報照原設計，以下是改的地方。

### 整理記憶

- 給模型的訊息格式：`[#123] 王小明：文字〔附件 #456：說明〕`；說明還沒好就寫「〔附件 #456：圖片〕」。
- 這一批訊息的附件照順序附原檔，到 18MB 為止。
- 模型回傳的 `add`、`update` 多兩個欄位（`update` 照舊可省略）：
  - `attachment_ids`：這條重點的來源附件；
  - `share_attachment_ids`：要跟著往上傳的附件。
- 寫入前多檢查（不合的那一條丟掉並記 log，其他照寫）：
  - `attachment_ids` 只能是這一批訊息的附件，或這條重點原本 `source_message_ids` 那些訊息的附件；
  - `share_attachment_ids` 必須是 `attachment_ids` 的子集，而且這條的 `share` 是 true；
  - 全國頻道的 `share_attachment_ids` 一律清空；
  - 撤回過的重點不能再帶圖往上傳；
  - 人改過的重點（`updated_by` 不是 NULL）AI 不能改 `shared_attachment_ids`。
- 提示裡寫明**哪些圖不能往上傳**：報價單、議價條件、合約（在 `SHARING_LEVEL` 是 `SELF`）；拍得到人臉的照片；
  處方、病歷、病人資料；客戶內部文件。只挑對其他組有用的（競品海報、陳列、產品問題）；拿不準就只傳文字、不帶圖。

### 看板

- `own`：每條附來源附件的縮圖（`attachment_ids`）。
- `below`：每條只附 `shared_attachment_ids` 的縮圖；照舊不回 `text` 與 `source_message_ids`。

### 撤回與人工修改

- 撤回一條重點：它的圖跟著從所有上層消失（看不到靠〈誰看得到〉第 3 條自然成立，不必另外處理）。
- `PATCH /api/memory/{id}` 多接受 `shared_attachment_ids`，**只能拿掉、不能加**（跟「只有 AI 判斷往上傳」一致）。

### @AI 與週摘要

- @AI：提問那一則的附件附原檔；最近 50 則訊息裡的附件只給說明。
- 週摘要：只給說明，不附原檔。
- 風險通報沒有附件。

## 問答查頻道記憶

原 spec 的 `kind = memory`，候選多了附件：

1. 重點：照原 spec（自己看得到的頻道裡沒刪除的，加上全公司往上傳的）。
2. 附件：`can_see_attachment` 看得到、`status = ready` 的頻道附件。
3. 有向量就各取前幾名：重點 30 條、附件 6 個（用附件最像的那一段算）；沒有向量就取最近的。
   提問也附了圖時，用 `embed_query(問題, media=[原檔])` 的向量去找，就是問答頁的以圖找圖。
4. 給模型的附件只有說明，不附原檔；每句標出處編號。
5. `evidence` 多 `attachments`（頻道名稱、日期、說明、url、thumb_url），答案下面列出縮圖，點了開大圖。
6. `QueryTrace` 記「從 N 條記憶、M 個附件挑出 30 條、6 個」。

## 搜尋頁

### 畫面 `/channels/search`

- 入口：頻道列表右上角的放大鏡（搜所有看得到的頻道）；頻道頁右上角的放大鏡（預設勾「只搜這個頻道」，可以取消）。
- 可以打字、附一張照片（以圖找圖），或兩個一起。
- 結果是縮圖格子，下面寫頻道名稱、誰發的、日期、說明的第一行。
  - 點了跳回原訊息並標亮（`around`）。
  - 跟著重點往上傳、自己看不到原頻道的附件：只開大圖，下面顯示那條重點的往上傳文字。

### API `POST /api/channels/search`

multipart：`q`（文字）、`image`（一張圖）、`channel_id`，都可省略，但 `q` 與 `image` 至少一個，否則 422。

1. 先算這個人看得到的頻道編號（`can_see` 逐一判斷），加上往上傳的附件編號，在 SQL 的 WHERE 裡篩，不是先搜再過濾。
   有 `channel_id` 就只留那個頻道（看不到就 404）。
2. 向量：`embed_query(q, media=[image])` 對 `attachment_vector` 算 cosine，同一個附件取最像的那段。
3. 關鍵字：`q` 對 `attachment.search_tokens`。
4. 合併照知識檢索的 `rank_fusion`（向量權重 0.6），取前 30。只有圖時只走向量；沒有 embedding 時只走關鍵字。
5. 搜尋用的照片走同樣的 Pillow 檢查，但不存。

**只搜附件，不搜文字訊息**。附件的 `search_tokens` 包含所屬訊息的文字，所以打「忠孝店補貨」，那則訊息附的照片也找得到。

## 原 spec 留下的事

〈頻道與 AI 主理記憶〉「第一階段做完後留給之後的事」這次這樣處理：

1. **訊息編號順序**：`post()` 先對頻道那一列 `SELECT … FOR UPDATE`。AI 回答、風險通報、週摘要、逾期提醒都走同一個寫入函式。
2. **時鐘**：頻道相關功能一律用真實的台灣日期（`timeutil.local_date(now)`），包括週摘要的「過去七天」與逾期判斷
   （`due_date < 今天`），不用 `app_today()`。訊息與示範對話本來就用灌資料當下的真實時間，AI 從訊息讀出的到期日也是真實日期。
3. **主管重新升回來會看到舊小組的對話**：當作預期行為，寫進 README，不另外開新頻道。
4. **濫用的訊息刪不掉**：做〈IT 刪訊息〉。
5. 補「停用主管 → 小組頻道封存」的測試。

## 示範資料

- `backend/scripts/draw_seed_images.py` 用本機的中文字型（macOS 的蘋方或 Noto Sans TC）以 Pillow 畫圖，
  產出寫到 `data/seed/attachments/` 並 commit。灌資料只讀檔，不需要字型。
- 六個檔案：
  - 御松田的促銷海報（競品，示範帶圖往上傳）；
  - 忠孝店貨架陳列（延續補貨延遲的情境）；
  - 一張價目表（示範**不能**往上傳：只傳文字）；
  - 自家產品盒（給問答「拍盒子問銷量」用）；
  - 競品 DM；
  - 2 頁的衛教單張 PDF。
- `catalog.CONVERSATIONS` 的對話行多一個附件欄位；每個附件的說明手寫在 `catalog.py`，灌資料不呼叫 AI，
  `status` 直接設 `ready`。
- 向量照知識庫的做法：灌資料時有設定 embedding 才算，沒有就留空。
- 原 spec 預先整理好的重點加上 `attachment_ids`／`shared_attachment_ids`：御松田海報那條帶圖往上傳，價目表那條只傳文字。

## 部署

- `worker.yaml`：`rq worker visits channels --with-scheduler`（原 spec 已經規劃）；README 的本機指令同步改。
- 新增週摘要、逾期提醒兩個 CronJob（原 spec），寫法照 `retention.yaml`。
- `pyproject.toml` 加 `pillow`、`pypdf`，`uv.lock` 更新。
- `values.yaml` 的 `EMBEDDING_MODEL` 註解改寫（見〈embedding-2〉）。
- README：費用估算加上附件說明與 embedding-2（圖片每張 $0.00012、文字每百萬 token $0.20）、用量上限表、隱私段落。
- 隱私權頁（`frontend/src/pages/privacy.tsx`）補上：附件跟著訊息與提問保存，刪除帳號時一起刪；照片上傳時會清掉位置等資訊。
- 部署前看一下 VM 剩多少磁碟（跟 CARE 共用；`db.storage` 的 5Gi 在 local-path 不會真的限制）。
- 沒有 migration：這次與之後每次改 `models.py`，部署時正式資料庫重建，**附件也會清空**，跟現在的訊息與提問一樣。

## 測試

照原 spec 的測試清單，另外加：

- **上傳**：清掉 EXIF（含 GPS）；依 EXIF 轉正；有透明背景存 PNG、其他存 JPEG；縮圖長邊 480；
  不是圖片或 HEIC 回 415；超過 15MB 回 413；超過 4 個（發言）或 1 個（提問）回 422；PDF 加密或超過 60 頁回 415；
  有附檔案時文字可以空白、沒附時不行。
- **看附件**：簽名過期、竄改、換人都不能用；看不到頻道的人 404；撤回往上傳後立刻 404；IT 刪訊息後 404；
  往上傳的附件全國的人都看得到；轉介的主管看得到提問的附件。
- **背景處理**：用 `gemini_offline` 確認寫說明時真的送了圖片；PDF 依 6 頁切段、向量列數對；失敗設 `failed`；沒設定時設 `ready`。
- **embedding**：前綴格式；`embed_query` 文字加圖合成一個 `Content`；`embed_media` 每個檔案各一個；失敗退回關鍵字。
- **LLM**：`media` 包成 `Part.from_bytes` 放在提示前；超過 18MB 改給說明。
- **問答**：數字、知識、頻道記憶三種附圖的流程；`QueryTrace` 有 `attachment` 那一步；上網搜尋不帶圖。
- **整理記憶**：不在這一批的附件、不是子集的 `share_attachment_ids`、全國頻道要分享、人改過的要改分享，都被丟掉；
  `PATCH` 只能拿掉分享的圖。
- **搜尋**：看不到的頻道的附件搜不到；往上傳的搜得到；只有圖時只走向量；沒有 embedding 時只走關鍵字；`channel_id` 看不到時 404。
- **IT 刪訊息**：非 IT 403；附件與向量刪掉；訊息內容換掉；重點留著。
- **訊息編號**：兩個寫入同時進同一個頻道，編號順序等於寫入完成順序。
- **前端**（vitest）：壓縮的尺寸計算（長邊 2048、不放大）；上傳佇列的狀態（選檔、拿掉、失敗留著、成功清空）。

## 分階段

每個階段做完都能單獨用，各自 push。原 spec 的第 2–4 階段排在這裡的第 4–6 階段。

1. **附件基礎**：`attachment`、上傳與 Pillow／pypdf 處理、簽名網址與 `can_see_attachment`、頻道傳圖與看圖、
   IT 刪訊息、訊息編號上鎖、用量上限、隱私權頁、示範用的圖與對話。這個階段還沒有背景處理，新上傳的附件停在 `pending`，
   `search_tokens` 先用檔名與訊息文字算。
2. **embedding-2 與看圖**：換模型、`Embedder` 新介面、`LLM` 的 `media`、`attachment_vector`、`process_attachment`、
   worker 改成 `visits channels --with-scheduler`。
3. **問答附圖**：multipart 提問、數字與知識兩種問題附圖、主管端看得到圖。
4. **記憶**（原第 2 階段）：`memory_item` 含附件欄位、帶圖整理、看板、往上傳與撤回、人工修改、`around`、預先整理好的重點。
5. **AI 主動**（原第 3 階段）：@AI、週摘要、逾期提醒、風險通報、CronJob、時鐘的決定。
6. **搜尋**（原第 4 階段）：問答的頻道記憶含附件、搜尋頁、以圖找圖。

## 不在這次範圍

- Office 檔、影片、語音訊息。
- 語音問答附圖、語音問答查頻道記憶。
- 發言的人自己刪或改訊息、撤回單一張已分享的圖（人工修改可以拿掉，但不另做撤回按鈕）。
- 人手動把圖加進往上傳。
- 物件儲存（GCS、R2）：量大到幾十 GB 再說。
- 附件的保存期限：跟訊息、提問一樣保留到刪帳號。
- PDF 預覽圖。

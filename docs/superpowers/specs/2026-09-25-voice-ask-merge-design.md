# 語音與打字問答合併成一條對話

2026-09-25

把 `/voice` 與 `/ask` 兩頁合成一頁：同一條對話，下方同時有輸入框與麥克風，打字問完可以接著用講的。

## 為什麼改

兩頁已經是同一件事的兩個入口，只是被切開：

- **後端完全共用。** 語音的工具呼叫就是打進 `POST /api/asks`，跟打字問答走同一套反覆查詢與 CRAG（README「語音問答」一節）。
- **畫面也幾乎共用。** `AskThread`（ask.tsx）與 `ToolCard`（voice.tsx）都只是包著 `AskAnswer` + `TracePanel`，對話氣泡、header、底部固定區的結構一模一樣。
- 切開的代價落在使用者身上：想換一種輸入方式就要換分頁，而且**歷史留在原來那一頁**。「我剛打字問了北區，現在想用講的追問康泰」做不到。

## 設計決定

四個已定案的決定：

1. **同一條對話，兩種輸入** — 不是「一頁兩模式分開切」，也不是在 `/ask` 加一個跳去 `/voice` 的捷徑。
2. **語音會話進行中時，打字送進 Live 會話**（`sendClientContent`），模型保有上下文並用講的回答。沒有會話時，打字維持走 `POST /api/asks` 回文字。
3. **加靜音鈕** — 解掉「我打字就是因為不方便出聲」。AI 照常回答、逐字稿與查詢卡片照常出現，只是不播音訊。
4. **驗證靠 vitest 只測新的 store**，其餘靠 `npm run build` 與實際跑 App。前端目前完全沒有測試設定，這次只為最容易出錯的那塊純邏輯建立最小的網，不擴大成全面測試。

## 架構：對話的所有權要搬家

現在 `VoiceController`（`frontend/src/voice/voice-controller.ts`，389 行）自己擁有 `entries`，`useVoiceSession` 用 `useSyncExternalStore` 讀它。

這擋住合併，原因是 lazy 載入：`src/voice/` 整包（Gemini Live SDK、音訊處理，`audio.ts` 220 行）目前靠 `App.tsx:29` 的 `lazy()` 留在主 chunk 之外。如果對話住在 controller 裡，那麼「打字」就得先載入整個語音模組——只打字的人白白多載。

所以拆出一層：

**新檔 `frontend/src/ask/conversation.ts`（eager）**

只做一件事：存 `entries`，提供 `add` / `replace` / `subscribe`。沒有音訊、沒有網路、沒有 React。

不提供 `clear`：現在兩頁都沒有清空對話的入口，重新整理就沒了，加一個沒人呼叫的方法只是替未來猜測。

**`VoiceController`（維持 lazy）**

不再擁有 `entries`，改成寫進 store。保留的責任：Live 連線、麥克風擷取與播放、工具呼叫、閒置逾時。這是刪掉所有權並改寫入目標，不是重寫。

邊界一句話：**store 是「畫面上有什麼」，controller 是「現在這通 Live 會話」。** 兩者可以各自理解、各自測試；store 沒有 controller 也能用（純打字就是這個情況）。

## Entry 模型

現有型別剛好接得上，不發明新的：

```ts
Utterance = { id, kind: "user" | "model", text, source: "voice" | "typed" }
ToolRun   = { id, kind: "tool", askKind, question, ask, error, cancelled }
Entry     = Utterance | ToolRun
```

**打字的一問一答 = 一個 `user` entry + 一個 `tool` entry**，中間沒有 model 語音。這不是硬套：`ToolRun` 攤開來就是「問題 + `Ask` + 錯誤 + 取消狀態」，正好是打字問答需要的全部。`AskThread` 因此可以整個刪掉，`ToolCard` 成為唯一的查詢卡片渲染。

唯一新增的欄位是 `Utterance.source`。現在語音那句底下寫死了「語音辨識，僅供參考」，打字的句子不能標那行字——那是 Gemini 轉出來的、可能有同音錯字才要標，打字的是使用者原文。

`ToolRun` 不需要 `source`：查詢卡片不管從哪裡來都長一樣，這是它值得共用的原因。

## 打字的兩條路

| 情況 | 走哪裡 | 回答形式 |
|---|---|---|
| 沒有語音會話 | `createAsk(kind, text)`，維持現在每秒輪詢 `getAsk` | 文字 |
| 語音會話進行中 | `session.sendClientContent({ turns: text, turnComplete: true })` | 語音 + 逐字稿 + 查詢卡片 |

`sendClientContent` 已存在於 `@google/genai` 2.22（`LiveSendClientContentParameters`），SDK 文件把「送文字訊息」列為它相對於 `sendRealtimeInput` 的主要用途之一。controller 要多一個方法把文字送進去，並在 store 裡補上對應的 `user` / `typed` entry。

送進 Live 的那一題**不會**產生 `AskRecord`，除非模型決定呼叫工具。這是對的：模型可能直接回答而不查資料，跟語音問同樣的問題一致。

### 「查數字／查規定」切換的去處

那組切換只對第一條路有意義——`createAsk` 需要 `AskKind`，而 Live 是模型自己選工具（`route_model.py` 是今日路線的排序模型，跟問題分類無關，不能拿來自動判斷）。

所以**語音會話開著的時候把那組切換收起來**。留在畫面上會讓人以為它對語音也有作用。

## 合併引入的一個 bug，要一起處理

`voice-controller.ts` 有 `IDLE_LIMIT_MS = 60_000`：一問一答之間一分鐘沒動靜就自動掛斷，理由是「麥克風開著就一直把聲音送去 Gemini，音訊照秒數計費」。

合併之後，**使用者在語音會話進行中打一段比較長的字，會在打到一半時被掛斷**——打字不會產生音訊活動，閒置計時器不知道人還在。

修法：把「使用者正在輸入」也算成活動。閒置計時器在 controller 裡、輸入框在頁面上，所以 controller 要多一個 `noteActivity()`，由輸入框的 `onChange` 呼叫；沒有會話時它不存在，頁面要能容忍。

不是加長逾時——省錢的理由仍然成立，只是「沒動靜」的定義要涵蓋打字。

## 靜音

一個 toggle，預設關閉（照常出聲）。開啟時逐字稿與查詢卡片照常，只是聽不到模型的聲音。

聲音要照樣即時播放進 `PcmPlayer`（`audio.ts`），靜音只能動輸出端：半雙工的收音判斷（`onChunk` 看 `player.playing`）、「打斷」鈕會不會出現、狀態列是「聆聽中」還是「回答中」，全都是看 player 有沒有東西在播，不是看有沒有靜音。在 controller 端就不把音訊丟進 player，會連這三個一起停擺——模型還在講、還在計費，畫面卻停在「聆聽中」，使用者也按不到「打斷」。**做法是 `PcmPlayer` 內部加一顆 `GainNode`：靜音時把它的音量歸零**，聲音仍然照原本的時間軸即時播放，取消靜音時接的是當下播到的位置，不會有積壓的音訊。

模型仍然會產生音訊（Live 原生語音模型不能只回文字），所以**靜音不省錢**。這點要寫在 UI 的說明或 README 裡，不要讓人以為靜音是省錢開關。

## lazy 邊界

麥克風那一區抽成 `<VoiceDock>`，用 `lazy()` 包起來，**第一次按麥克風才掛載**。在那之前 `src/voice/` 整包不進 bundle。

第一次按下去的流程：頁面本來顯示的是一個普通的麥克風按鈕（不屬於 `src/voice/`），按下後觸發動態 import 並顯示載入中，載完由 `<VoiceDock>` 接手並**自動開始會話**——使用者按麥克風就是表達了要講話的意思，不該讓他再按一次。

離開頁面時掛斷、關麥克風的行為維持現在 `useVoiceSession` 的 `attach`/`detach`。

## 路由、導覽與文件

- `/voice` 改成 redirect 到 `/ask`（舊書籤、導覽說明都指得到）。
- `pages/voice.tsx` 刪除，內容拆進 `<VoiceDock>` 與共用的 entry 渲染。
- 頁面標題維持「問答」，不改成「語音問答」或「AI 助理」——它現在是兩種輸入的同一件事，名字該是那件事。
- 底部分頁從四格變三格：今日、客戶、問答。`AudioLines` 圖示不再需要。
- `Onboarding`（FR-11 的三步說明）若提到「語音」分頁要跟著改。
- README 的「語音問答（Gemini Live）」與「問答」兩節要合併敘述，並說明靜音不省錢。

## 測試

裝 vitest，**只為 `conversation.ts` 寫測試**：

| 測試 | 驗什麼 |
|---|---|
| `add` 依序附加，`id` 不重複 | entry 順序是畫面順序的唯一真相來源 |
| 語音與打字的 entry 交錯後順序正確 | 合併的核心：兩個來源寫同一條串 |
| `replace` 換掉指定 `ToolRun` 的 `ask`，不動其他 entry | 輪詢更新只能改那一格 |
| `replace` 對不存在的 id 是 no-op，不丟例外 | 會話結束後遲到的輪詢結果不能讓畫面炸掉 |
| `add` 與 `replace` 都通知 `subscribe` 的訂閱者 | `useSyncExternalStore` 要的契約 |
| 連續讀兩次 `getSnapshot`、中間沒有變動時回傳同一個參考 | 回傳新陣列會讓 `useSyncExternalStore` 無限重繪 |

其餘（版面、lazy 載入、Live 連線、靜音）靠 `npm run build` 與實際把 App 跑起來操作驗證。

不為 `VoiceController` 寫測試：它幾乎全是與 Gemini Live 和 WebAudio 的互動，測起來會是測 mock 而不是測行為。

## 不在這次範圍

- **不做對話持久化。** 重新整理就清空，跟現在兩頁的行為一致。
- **不做自動判斷「查數字／查規定」。** 打字仍由使用者選。
- **不補其他前端測試。** vitest 只為這次的 store 進來；`scope.ts`、`offline-queue` 這些既有純邏輯模組留著以後再說。
- **不動後端。** 兩條路都用現有 API，`POST /api/asks` 與 `POST /api/voice/session` 都不改。

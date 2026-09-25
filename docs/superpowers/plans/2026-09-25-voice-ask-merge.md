# 語音與打字問答合併 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/voice` 與 `/ask` 合成一頁，同一條對話裡可以打字也可以用講的。

**Architecture:** 對話的所有權從 `VoiceController` 搬到一個沒有音訊、沒有網路、沒有 React 的小 store。store 與 entry 渲染是 eager 的；Gemini Live 與音訊處理維持 lazy，第一次按麥克風才載入。打字在沒有語音會話時走 `POST /api/asks` 回文字，會話進行中則送進 Live 會話由模型用講的回答。

**Tech Stack:** React 19、react-router 8、Vite 8、TypeScript 6、`@google/genai` 2.22、Tailwind 4、vitest（這次新增）。

規格見 [docs/superpowers/specs/2026-09-25-voice-ask-merge-design.md](../specs/2026-09-25-voice-ask-merge-design.md)。

## Global Constraints

- **不動後端。** `POST /api/asks` 與 `POST /api/voice/session` 都不改，`backend/` 不進任何 diff。
- **`src/voice/` 維持 lazy。** 任何 eager 模組（store、entry 渲染、頁面）都不准 import `src/voice/audio.ts`、`voice-controller.ts` 或 `@google/genai`。唯一的 import 點是 `lazy()` 包起來的 `<VoiceDock>`。
- **`conversation.ts` 不准有音訊、網路或 React。** 它是純資料結構，這是它值得測試的原因。
- **對話不跨頁面持久化。** store 由頁面建立（`useState(() => createConversation())`），離開頁面就沒了，跟現在兩頁的行為一致。不要做成模組層級的 singleton。
- **註解與 UI 文案用繁體中文**，註解說明「為什麼」不是「做什麼」。commit 訊息用英文祈使句。
- **commit 訊息結尾**加上（前面空一行）：`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **每個 task 結束前三個都要綠**（`build` 不含型別檢查，CI 分成兩個 job，所以兩個都要跑）：
  ```
  cd frontend && npm run build
  cd frontend && npm run typecheck
  cd frontend && npx vitest run      # Task 1 之後才有
  ```
- **後端測試不該受影響**，但 Task 4 改 README 之後跑一次確認沒事：`uv run --project backend pytest backend/tests -q`（基準 597 passed）。

## File Structure

| 檔案 | 責任 | eager／lazy |
|---|---|---|
| `frontend/src/ask/conversation.ts` | **新檔.** 對話的 entry 串：`add*` / `appendText` / `replace` / `subscribe` / `getSnapshot`。純資料。 | eager |
| `frontend/src/ask/transcript.ts` | **搬家.** 從 `src/voice/transcript.ts` 移來（8 行純函式），store 要用它整理逐字稿。 | eager |
| `frontend/src/ask/use-conversation.ts` | **新檔.** `useSyncExternalStore` 的薄包裝，把 React 隔離在 store 之外。 | eager |
| `frontend/src/ask/run-ask.ts` | **新檔.** `createAsk` + 輪詢到完成，把結果寫回 store。打字與語音工具呼叫共用。 | eager |
| `frontend/src/components/ask/entry-view.tsx` | **新檔.** 單一 entry 的渲染（user／model 氣泡、tool 卡片）。從 `pages/voice.tsx` 搬出來。 | eager |
| `frontend/src/components/ask/voice-dock.tsx` | **新檔.** 麥克風控制、靜音鈕、`VoiceController` 的擁有者。 | **lazy** |
| `frontend/src/voice/voice-controller.ts` | 改：不再擁有 entries，改寫進 store；新增 `sendText` / `noteActivity` / `setMuted`。 | lazy |
| `frontend/src/voice/use-voice-session.ts` | 改：接收 store，不再回傳 entries。 | lazy |
| `frontend/src/pages/ask.tsx` | 改：合併後的頁面。 | eager |
| `frontend/src/pages/voice.tsx` | **刪除.** | — |
| `frontend/src/components/bottom-nav.tsx` | 改：四格變三格。 | eager |
| `frontend/src/App.tsx` | 改：`/voice` redirect 到 `/ask`，移除 lazy 的 VoicePage。 | eager |

## 任務順序的理由

四個 task，每一個結束時三個檢查都必須綠，而且**每一個 task 結束時 App 都要是可用的**——不能有「合併做到一半，語音壞掉」的中間狀態。

1. **Task 1 只加東西**：store + vitest，沒有任何現有程式碼消費它。零風險。
2. **Task 2 是純重構**：controller 改成寫進 store，`voice.tsx` 與 `ask.tsx` 的行為完全不變。最容易出錯的一步單獨隔離。
3. **Task 3 才真的合併**：頁面、路由、導覽。此時打字在會話中仍走 `/api/asks`（還不是 spec 的最終行為，但是一個連貫可用的狀態）。
4. **Task 4 補 Live 文字輸入、閒置修正、靜音、文件**：spec 的最終行為。

---

### Task 1: 對話 store 與 vitest

**Files:**
- Create: `frontend/src/ask/conversation.ts`
- Create: `frontend/src/ask/use-conversation.ts`
- Create: `frontend/src/ask/conversation.test.ts`
- Move: `frontend/src/voice/transcript.ts` → `frontend/src/ask/transcript.ts`
- Modify: `frontend/src/voice/voice-controller.ts:21`（import 路徑跟著搬）
- Modify: `frontend/package.json`（devDependency + `test` script）
- Modify: `frontend/vite.config.ts`（vitest 設定）

**Interfaces:**
- Consumes: `Ask`、`AskKind`（`@/api/asks`）
- Produces:
  - `type Utterance = { id: number; kind: "user" | "model"; source: "voice" | "typed"; text: string }`
  - `type ToolRun = { id: number; kind: "tool"; askKind: AskKind | null; question: string; ask: Ask | null; error: string | null; cancelled: boolean }`
  - `type Entry = Utterance | ToolRun`
  - `type Conversation` with `getSnapshot(): Entry[]`、`subscribe(l: () => void): () => void`、`addUtterance(kind, source, text?): number`、`addToolRun(askKind, question): number`、`appendText(id: number, chunk: string): void`、`replace(id: number, patch: Partial<Omit<ToolRun, "id" | "kind">>): void`
  - `createConversation(): Conversation`
  - `useConversation(conversation: Conversation): Entry[]`
  - `tidyTranscript(text: string): string`（從 `@/ask/transcript`）

- [ ] **Step 1: 裝 vitest**

```bash
cd frontend && npm install -D vitest@^5
```

vitest 5 是唯一支援 Vite 8 的線（peer 是 `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`）；vitest 3 不支援，不要降版。

`@types/node` 是 vitest 的**選用** peer，但它要 `^22 || >=24` 而專案裝的是 `^20`。如果 npm 因此報 ERESOLVE，把 `frontend/package.json` 的 `"@types/node": "^20"` 改成 `"^24"` 再裝一次，並確認 `npm run typecheck` 仍然通過——這是 devDependency，只影響型別。

- [ ] **Step 2: 設定 vitest 並加 script**

`frontend/vite.config.ts`，在 `server` 區塊後面加一段（檔案最上面的 `defineConfig` import 改成從 `vitest/config` 來，這樣 `test` 欄位才有型別）：

把第一行的
```ts
import { defineConfig } from "vite"
```
改成
```ts
import { defineConfig } from "vitest/config"
```

並在 `server: { ... }` 之後加：

```ts
  // 只測純邏輯模組（目前是 src/ask 的對話 store）：元件與 Live 連線靠 build 與實際操作驗
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
```

`frontend/package.json` 的 `scripts` 加一行（放在 `"typecheck"` 後面）：

```json
    "test": "vitest run",
```

- [ ] **Step 3: 把 transcript.ts 搬到 src/ask**

```bash
cd frontend && mkdir -p src/ask && git mv src/voice/transcript.ts src/ask/transcript.ts
```

`frontend/src/voice/voice-controller.ts` 第 21 行的 import 改成：

```ts
import { tidyTranscript } from "@/ask/transcript"
```

- [ ] **Step 4: 寫失敗的測試**

新檔 `frontend/src/ask/conversation.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest"

import { createConversation, type Entry } from "@/ask/conversation"

/** 測試用的最小 Ask；store 不看裡面的內容，只負責原樣放進 ToolRun */
const ask = (id: string) => ({ id }) as unknown as import("@/api/asks").Ask

describe("conversation", () => {
  it("依序附加，id 不重複", () => {
    const c = createConversation()
    const a = c.addUtterance("user", "typed", "北區為什麼掉？")
    const b = c.addToolRun("data", "北區為什麼掉？")
    expect(a).not.toBe(b)
    expect(c.getSnapshot().map((e) => e.id)).toEqual([a, b])
  })

  it("語音與打字的 entry 交錯後順序正確", () => {
    const c = createConversation()
    // 打字問一題（user + tool），再用講的問一題（user + model）
    c.addUtterance("user", "typed", "北區為什麼掉？")
    c.addToolRun("data", "北區為什麼掉？")
    c.addUtterance("user", "voice", "那康泰呢？")
    c.addUtterance("model", "voice", "康泰這一季…")
    expect(c.getSnapshot().map((e) => [e.kind, e.kind === "tool" ? "tool" : e.source])).toEqual([
      ["user", "typed"],
      ["tool", "tool"],
      ["user", "voice"],
      ["model", "voice"],
    ])
  })

  it("appendText 累加並整理中文字之間的空白", () => {
    const c = createConversation()
    const id = c.addUtterance("model", "voice", "")
    c.appendText(id, "近效期 品項")
    c.appendText(id, " 退貨")
    const entry = c.getSnapshot()[0]
    expect(entry.kind === "model" && entry.text).toBe("近效期品項退貨")
  })

  it("replace 只換掉指定的 ToolRun，不動其他 entry", () => {
    const c = createConversation()
    const first = c.addToolRun("data", "第一題")
    const second = c.addToolRun("data", "第二題")
    c.replace(second, { ask: ask("A2") })
    const [one, two] = c.getSnapshot() as [Entry, Entry]
    expect(one.id).toBe(first)
    expect(one.kind === "tool" && one.ask).toBeNull()
    expect(two.kind === "tool" && two.ask?.id).toBe("A2")
  })

  it("replace 對不存在的 id 是 no-op，不丟例外", () => {
    // 對話結束後遲到的輪詢結果不能讓畫面炸掉
    const c = createConversation()
    const id = c.addToolRun("data", "第一題")
    const before = c.getSnapshot()
    expect(() => c.replace(id + 999, { ask: ask("A9") })).not.toThrow()
    expect(c.getSnapshot()).toBe(before)
  })

  it("replace 用在 Utterance 的 id 上也是 no-op", () => {
    const c = createConversation()
    const id = c.addUtterance("user", "typed", "問題")
    const before = c.getSnapshot()
    c.replace(id, { ask: ask("A9") })
    expect(c.getSnapshot()).toBe(before)
  })

  it("add 與 replace 都通知訂閱者，取消訂閱之後不再通知", () => {
    const c = createConversation()
    const listener = vi.fn()
    const unsubscribe = c.subscribe(listener)
    const id = c.addToolRun("data", "第一題")
    expect(listener).toHaveBeenCalledTimes(1)
    c.replace(id, { ask: ask("A1") })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    c.addUtterance("user", "typed", "再一題")
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("沒有變動時 getSnapshot 回傳同一個參考", () => {
    // 每次回傳新陣列會讓 useSyncExternalStore 無限重繪
    const c = createConversation()
    c.addUtterance("user", "typed", "問題")
    expect(c.getSnapshot()).toBe(c.getSnapshot())
  })
})
```

- [ ] **Step 5: 跑測試確認它失敗**

Run: `cd frontend && npx vitest run`
Expected: FAIL — `Failed to resolve import "@/ask/conversation"`

- [ ] **Step 6: 寫 store**

新檔 `frontend/src/ask/conversation.ts`：

```ts
/**
 * 一條問答對話裡有哪些東西。打字與語音都寫進同一條串，畫面才會是一條對話而不是兩條。
 *
 * 這裡刻意不碰音訊、網路與 React：語音模組（src/voice）是 lazy 載入的，只打字的人不該
 * 為了顯示對話而載入 Gemini Live 與音訊處理。
 */

import { tidyTranscript } from "@/ask/transcript"
import type { Ask, AskKind } from "@/api/asks"

export type UtteranceSource = "voice" | "typed"

/** 業務或 AI 說的一句話。source 決定要不要標「語音辨識，僅供參考」——打字的是原文，不必標 */
export type Utterance = { id: number; kind: "user" | "model"; source: UtteranceSource; text: string }

/** 一次查詢：打字問答與語音的工具呼叫長得一樣，所以共用同一種 entry */
export type ToolRun = {
  id: number
  kind: "tool"
  askKind: AskKind | null
  question: string
  ask: Ask | null
  error: string | null
  cancelled: boolean
}

export type Entry = Utterance | ToolRun

export type Conversation = {
  getSnapshot: () => Entry[]
  subscribe: (listener: () => void) => () => void
  addUtterance: (kind: "user" | "model", source: UtteranceSource, text?: string) => number
  addToolRun: (askKind: AskKind | null, question: string) => number
  appendText: (id: number, chunk: string) => void
  replace: (id: number, patch: Partial<Omit<ToolRun, "id" | "kind">>) => void
}

export function createConversation(): Conversation {
  let entries: Entry[] = []
  let lastId = 0
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const commit = (next: Entry[]) => {
    entries = next
    emit()
  }

  return {
    // 同一個參考回傳到下次變動為止：useSyncExternalStore 靠這個判斷要不要重繪
    getSnapshot: () => entries,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    addUtterance: (kind, source, text = "") => {
      const id = ++lastId
      commit([...entries, { id, kind, source, text }])
      return id
    },

    addToolRun: (askKind, question) => {
      const id = ++lastId
      commit([...entries, { id, kind: "tool", askKind, question, ask: null, error: null, cancelled: false }])
      return id
    },

    appendText: (id, chunk) => {
      const target = entries.find((entry) => entry.id === id)
      if (!target || target.kind === "tool") return
      commit(entries.map((e) => (e.id === id && e.kind !== "tool" ? { ...e, text: tidyTranscript(e.text + chunk) } : e)))
    },

    replace: (id, patch) => {
      // 會話結束後遲到的輪詢結果會打在已經不存在的 id 上，靜靜忽略就好
      const target = entries.find((entry) => entry.id === id)
      if (!target || target.kind !== "tool") return
      commit(entries.map((e) => (e.id === id && e.kind === "tool" ? { ...e, ...patch } : e)))
    },
  }
}
```

- [ ] **Step 7: 寫 React 包裝**

新檔 `frontend/src/ask/use-conversation.ts`：

```ts
import { useSyncExternalStore } from "react"

import type { Conversation, Entry } from "@/ask/conversation"

/** 把 React 隔離在 store 之外：store 本身不 import react，才能單獨測試 */
export function useConversation(conversation: Conversation): Entry[] {
  return useSyncExternalStore(conversation.subscribe, conversation.getSnapshot)
}
```

- [ ] **Step 8: 跑測試確認通過**

Run: `cd frontend && npx vitest run`
Expected: 8 passed

- [ ] **Step 9: 確認建置與型別都還好**

```bash
cd frontend && npm run build && npm run typecheck
```
Expected: 兩個都成功（`transcript.ts` 搬家之後 `voice-controller.ts` 的 import 已改）

- [ ] **Step 10: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/ask frontend/src/voice/voice-controller.ts
git commit -m "$(cat <<'EOF'
Add a conversation store that typed and spoken turns can share

The store holds no audio, no network and no React, so the typed path can
render a conversation without pulling in the lazily loaded voice module.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: VoiceController 改成寫進 store（行為不變）

驗收標準：**`/voice` 頁的行為跟改之前完全一樣**。這一步不合併任何東西。

**Files:**
- Modify: `frontend/src/voice/voice-controller.ts`
- Modify: `frontend/src/voice/use-voice-session.ts`
- Modify: `frontend/src/pages/voice.tsx`

**Interfaces:**
- Consumes: Task 1 的 `Conversation`、`Entry`、`createConversation`、`useConversation`
- Produces:
  - `new VoiceController(conversation: Conversation)`
  - `VoiceView = { status, notice, level, pending }`（**不再有 `entries`**）
  - `useVoiceSession(conversation: Conversation)` 回傳 `{ status, notice, level, pending, start, stop, interrupt }`（**不再有 `entries` 與 `replaceAsk`**）

- [ ] **Step 1: 讓 controller 收下 store，拿掉 entries 的所有權**

`frontend/src/voice/voice-controller.ts`：

把 `VoiceView` 的 `entries` 拿掉，並把 `Utterance`、`ToolRun`、`Entry` 三個 type 的 `export` 刪掉（它們現在住在 `@/ask/conversation`）：

```ts
export type VoiceStatus = "idle" | "connecting" | "listening" | "speaking"
export type VoiceView = {
  status: VoiceStatus
  notice: string | null
  level: number
  pending: number
}
```

檔案上方加 import：

```ts
import type { Conversation } from "@/ask/conversation"
```

class 的欄位與建構子：

```ts
export class VoiceController {
  private view: VoiceView = { status: "idle", notice: null, level: 0, pending: 0 }
  private readonly listeners = new Set<() => void>()
  // 離開頁面時停止所有輪詢；對話結束但查詢還沒完成的，卡片照樣更新到查完
  private polls = new AbortController()
  private conn: Connection | null = null

  constructor(private readonly conversation: Conversation) {}
```

`private lastId = 0` 整行刪掉——id 現在由 store 發。

- [ ] **Step 2: 把四個寫 entries 的地方改成呼叫 store**

同一個檔案。`patchTool` 整個方法刪掉，改用 `this.conversation.replace`。四處改法：

`replaceAsk` 刪掉（頁面現在直接對 store 操作，見 Step 4）。

`openEntry`：

```ts
  /** 找這一輪業務（或模型）講話的那一格，沒有就開一格 */
  private openEntry(conn: Connection, kind: "user" | "model"): number {
    const current = kind === "user" ? conn.userEntry : conn.modelEntry
    if (current !== null) return current
    // 業務講話的逐字稿可能比模型的回答或工具呼叫晚到；先幫業務這一句佔位，順序才不會顛倒
    if (kind === "model") this.openEntry(conn, "user")
    const id = this.conversation.addUtterance(kind, "voice")
    if (kind === "user") conn.userEntry = id
    else conn.modelEntry = id
    return id
  }
```

`appendText`：

```ts
  private appendText(conn: Connection, kind: "user" | "model", text: string) {
    this.conversation.appendText(this.openEntry(conn, kind), text)
  }
```

`runTool` 裡建立 tool entry 的那一段（原本是 `const entryId = ++this.lastId` 加一次 `this.update({entries: [...]})`）改成：

```ts
    this.openEntry(conn, "user")
    const entryId = this.conversation.addToolRun(askKind, question)
    if (call.id) conn.toolEntries.set(call.id, entryId)
```

`runTool` 與 `onMessage` 裡所有 `this.patchTool(entryId, X)` 改成 `this.conversation.replace(entryId, X)`（共四處：`{ ask }` 兩處、`{ error: message }` 一處、`{ cancelled: true }` 一處）。

`tidyTranscript` 的 import 現在沒有用到了（整理搬進 store 了），刪掉那一行。

- [ ] **Step 3: hook 收下 store**

`frontend/src/voice/use-voice-session.ts` 整檔換成：

```ts
import { useEffect, useState, useSyncExternalStore } from "react"

import type { Conversation } from "@/ask/conversation"
import { VoiceController } from "@/voice/voice-controller"

/** 語音連線狀態；對話內容在傳進來的 store 裡。離開頁面時自動掛斷、關掉麥克風 */
export function useVoiceSession(conversation: Conversation) {
  const [controller] = useState(() => new VoiceController(conversation))
  const view = useSyncExternalStore(controller.subscribe, controller.getView)
  useEffect(() => {
    controller.attach()
    return controller.detach
  }, [controller])
  return {
    ...view,
    start: controller.start,
    stop: controller.stop,
    interrupt: controller.interrupt,
  }
}
```

- [ ] **Step 4: voice.tsx 從 store 讀 entries**

`frontend/src/pages/voice.tsx`。import 改成：

```ts
import { createConversation, type Entry } from "@/ask/conversation"
import { useConversation } from "@/ask/use-conversation"
```

並刪掉 `import type { Entry, ToolRun } from "@/voice/voice-controller"`（`ToolRun` 也從 `@/ask/conversation` 來，跟 `Entry` 併在同一行 import）。

元件開頭改成：

```ts
export default function VoicePage() {
  const [conversation] = useState(() => createConversation())
  const voice = useVoiceSession(conversation)
  const allEntries = useConversation(conversation)
  const bottomRef = useRef<HTMLDivElement>(null)
  // 模型還在講、逐字稿還沒出來的那一格先不顯示
  const entries = allEntries.filter((entry) => entry.kind === "tool" || entry.text.trim())
```

`useState` 要加進 react 的 import。

`EntryView` 的 `onAskChange` 改成直接寫 store——把 `<EntryView ... onAskChange={voice.replaceAsk} />` 改成：

```tsx
          <EntryView key={entry.id} entry={entry} onAskChange={conversation.replace} />
```

並把 `EntryView` 與 `ToolCard` 的 prop 型別從 `(entryId: number, ask: Ask) => void` 改成 `(entryId: number, patch: { ask: Ask }) => void`，呼叫處 `onAskChange(run.id, ask)` 改成 `onAskChange(run.id, { ask })`。

`EntryView` 裡 user 那一支現在要看 `entry.source`（Task 3 才會有打字的來源，但型別已經在了，先照 source 判斷）：

```tsx
  if (entry.kind === "user") {
    // 語音那句是 Gemini 另外做的語音轉文字，常有同音錯字；打字的是業務原文，不必標
    return (
      <div className="ml-10 flex flex-col items-end gap-1 self-end">
        <p className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{entry.text}</p>
        {entry.source === "voice" && <p className="text-[11px] text-muted-foreground">語音辨識，僅供參考</p>}
      </div>
    )
  }
```

- [ ] **Step 5: 三個檢查**

```bash
cd frontend && npm run build && npm run typecheck && npx vitest run
```
Expected: 三個都成功，vitest 8 passed

- [ ] **Step 6: 實際跑一次，確認行為沒變**

```bash
cd frontend && npm run dev
```

打開 `http://localhost:5173/voice`，確認：頁面載入、按「開始對話」會要麥克風權限、`idle` 狀態的介紹文字照舊出現。**沒有 Gemini 金鑰時連線會失敗並顯示錯誤提示，那也是正確的**——這一步要驗的是頁面沒被重構弄壞，不是 Live 連線本身。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/voice frontend/src/pages/voice.tsx
git commit -m "$(cat <<'EOF'
Move conversation ownership out of the voice controller

The controller now owns the live session only and writes entries into the
shared store. Behaviour on /voice is unchanged; this isolates the risky
refactor from the merge itself.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 合併成一頁

**Files:**
- Create: `frontend/src/ask/run-ask.ts`
- Create: `frontend/src/components/ask/entry-view.tsx`
- Create: `frontend/src/components/ask/voice-dock.tsx`
- Modify: `frontend/src/pages/ask.tsx`（大幅改寫）
- Delete: `frontend/src/pages/voice.tsx`
- Modify: `frontend/src/components/bottom-nav.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: Task 1 的 `Conversation`／`Entry`／`useConversation`，Task 2 的 `useVoiceSession(conversation)`
- Produces:
  - `runAsk(conversation: Conversation, entryId: number, kind: AskKind, question: string, signal: AbortSignal): Promise<void>`
  - `<EntryView entry={Entry} onAskChange={(id: number, patch: { ask: Ask }) => void} />`
  - `<VoiceDock conversation={Conversation} onClose={() => void} />`（default export，給 `lazy()` 用）

- [ ] **Step 1: 抽出共用的 entry 渲染**

新檔 `frontend/src/components/ask/entry-view.tsx`，把 `pages/voice.tsx` 裡的 `EntryView`、`ToolCard`、`TOOL_LABEL` 原樣搬過來（Task 2 已經改好 `source` 與 `onAskChange` 的型別），並把 `EntryView` 改成 `export function EntryView`。

`pages/voice.tsx` 暫時改成從新位置 import，這一步結束時它還活著：

```ts
import { EntryView } from "@/components/ask/entry-view"
```

- [ ] **Step 2: 抽出「跑一次查詢並輪詢到完成」**

新檔 `frontend/src/ask/run-ask.ts`：

```ts
/**
 * 送出一次查詢並輪詢到有結果，把每一次更新寫回對話。
 * 打字問答與語音的工具呼叫走的是同一件事，所以共用這一段。
 */

import { createAsk, getAsk, isFinished, type Ask, type AskKind } from "@/api/asks"
import type { Conversation } from "@/ask/conversation"

// 還沒答完的提問每半秒問一次進度（NFR-5），查到第幾輪會即時出現在畫面上。
// 用 500ms 而不是打字問答原本的 1000ms：語音那條路的輪詢間隔會直接加在業務的等待時間上
// （voice-controller.ts 原本的註解），統一到較慢的一邊等於讓語音變慢
const POLL_MS = 500

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

/** 回傳查完的 Ask；中途被 abort 會丟出，呼叫端自行忽略 */
export async function runAsk(
  conversation: Conversation,
  entryId: number,
  kind: AskKind,
  question: string,
  signal: AbortSignal
): Promise<Ask> {
  let ask = await createAsk(kind, question)
  conversation.replace(entryId, { ask })
  while (!isFinished(ask)) {
    await sleep(POLL_MS, signal)
    try {
      ask = await getAsk(ask.id, signal)
    } catch (error) {
      if (signal.aborted) throw error
      continue // 網路一時不通就等下一輪
    }
    conversation.replace(entryId, { ask })
  }
  return ask
}
```

`voice-controller.ts` 的 `runTool` 裡那段「`createAsk` → while 輪詢 → `replace`」換成呼叫它，並把 controller 裡的 `POLL_MS` 常數與本地的 `sleep` 函式一起刪掉（`run-ask.ts` 已經有自己的一份，間隔同樣是 500ms，語音那條路不會變慢）：

```ts
      if (!askKind) throw new Error(`沒有這個查詢工具：${call.name}`)
      if (!question) throw new Error("模型沒有給要查的問題")
      response = toolResult(await runAsk(this.conversation, entryId, askKind, question, signal))
```

- [ ] **Step 3: 做 VoiceDock**

新檔 `frontend/src/components/ask/voice-dock.tsx`。把 `pages/voice.tsx` 的 `Controls` 搬過來，外面包一層擁有 session 的元件：

```tsx
import { AudioLines, Hand, Loader2, Mic, PhoneOff } from "lucide-react"

import type { Conversation } from "@/ask/conversation"
import { Button } from "@/components/ui/button"
import { useVoiceSession } from "@/voice/use-voice-session"

/**
 * 麥克風那一區。整包 src/voice（Gemini Live SDK 與音訊處理）只從這裡進來，
 * 而這個檔案是 lazy 載入的：只打字的人不會載到它。
 */
export default function VoiceDock({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const voice = useVoiceSession(conversation)

  // 按麥克風就是表達了要講話，載完直接開始，不讓人再按一次
  useEffect(() => {
    void voice.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (voice.status === "idle") {
    // 會話結束或連線失敗：把 dock 收掉，notice 由頁面顯示
    return (
      <Button variant="outline" className="h-14 w-full gap-2 text-base" onClick={onClose}>
        <Mic className="size-5" />
        重新開始
      </Button>
    )
  }
  if (voice.status === "connecting") {
    return (
      <Button className="h-14 w-full gap-2 text-base" disabled>
        <Loader2 className="size-5 animate-spin" />
        連線中…
      </Button>
    )
  }
  const speaking = voice.status === "speaking"
  const label = speaking ? "AI 回答中" : voice.pending > 0 ? "查詢中…" : "聆聽中，直接說"
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex size-12 shrink-0 items-center justify-center" aria-hidden>
        {/* 外圈跟著麥克風音量放大，看得出有收到聲音 */}
        <span
          className="absolute inset-0 rounded-full bg-primary/25 transition-transform duration-100"
          style={{ transform: `scale(${1 + Math.min(voice.level * 6, 0.7)})` }}
        />
        <span className="relative flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {speaking ? <AudioLines className="size-5" /> : <Mic className="size-5" />}
        </span>
      </span>
      <p className="flex-1 text-sm font-medium" aria-live="polite">
        {label}
      </p>
      {speaking && (
        <Button variant="outline" className="h-11 gap-1.5" onClick={voice.interrupt}>
          <Hand className="size-4" />
          打斷
        </Button>
      )}
      <Button variant="outline" className="h-11 gap-1.5 text-destructive" onClick={voice.stop}>
        <PhoneOff className="size-4" />
        結束
      </Button>
    </div>
  )
}
```

`useEffect` 要從 react import。**`notice` 這一步先不顯示**（Task 4 會把它接到頁面上）——會話失敗時 dock 會回到 `idle` 分支顯示「重新開始」。

- [ ] **Step 4: 改寫 ask.tsx 成合併後的頁面**

`frontend/src/pages/ask.tsx` 整檔換成：

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Loader2, Mic, Send } from "lucide-react"

import { type Ask, type AskKind } from "@/api/asks"
import { createConversation } from "@/ask/conversation"
import { runAsk } from "@/ask/run-ask"
import { useConversation } from "@/ask/use-conversation"
import { EntryView } from "@/components/ask/entry-view"
import { BottomNav } from "@/components/bottom-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth"
import { askScopeText } from "@/lib/scope"
import { cn } from "@/lib/utils"

// 整包 src/voice（Gemini Live SDK 與音訊處理）只從這裡進來，按了麥克風才載
const VoiceDock = lazy(() => import("@/components/ask/voice-dock"))

const MODES: { kind: AskKind; label: string; placeholder: string; examples: string[] }[] = [
  {
    kind: "data",
    label: "查數字",
    placeholder: "例如：北區這一季保健品為什麼掉？",
    examples: ["北區這一季保健品類為什麼下滑？", "哪幾家客戶進貨間隔拉長，但單次金額持平？"],
  },
  {
    kind: "knowledge",
    label: "查規定",
    placeholder: "例如：近效期的貨要多久前申請退貨？",
    examples: ["近效期的貨要多久前申請退貨？", "我可以直接給客戶幾趴折扣？"],
  },
]

/** 問答（原型 S-07）：打字與語音在同一條對話裡，兩種問法共用同一套查詢與查詢軌跡 */
export function AskPage() {
  const user = useAuth()?.user
  const [conversation] = useState(() => createConversation())
  const [kind, setKind] = useState<AskKind>("data")
  const [question, setQuestion] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceOn, setVoiceOn] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const polls = useRef(new AbortController())
  const mode = MODES.find((m) => m.kind === kind)!
  // 模型還在講、逐字稿還沒出來的那一格先不顯示
  const entries = useConversation(conversation).filter((entry) => entry.kind === "tool" || entry.text.trim())

  // 離開頁面時停掉所有還在跑的輪詢。React 開發模式會先卸載再掛上一次，
  // 所以卸載時中止掉的 controller 要能換一個新的，否則重新掛上之後每一次查詢都會立刻被 abort
  useEffect(() => {
    if (polls.current.signal.aborted) polls.current = new AbortController()
    const controller = polls.current
    return () => controller.abort()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [entries.length])

  async function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError(null)
    conversation.addUtterance("user", "typed", trimmed)
    const entryId = conversation.addToolRun(kind, trimmed)
    setQuestion("")
    try {
      await runAsk(conversation, entryId, kind, trimmed, polls.current.signal)
    } catch (err) {
      if (polls.current.signal.aborted) return
      const message = err instanceof Error ? err.message : "送出失敗，請再試一次"
      conversation.replace(entryId, { error: message })
      setError(message)
    } finally {
      setSending(false)
    }
  }

  const replaceAsk = (id: number, patch: { ask: Ask }) => conversation.replace(id, patch)

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">先查公司資料與內部文件，查不到才參考網路公開資料（會另外標示）</p>
        <h1 className="mt-0.5 text-lg font-semibold">問答</h1>
        {/* 語音會話裡是模型自己選要查數字還是查規定，這組切換只對打字有用，開著會話時收起來 */}
        {!voiceOn && (
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {MODES.map((m) => (
              <button
                key={m.kind}
                type="button"
                onClick={() => setKind(m.kind)}
                className={cn(
                  "h-10 rounded-md text-sm font-medium",
                  kind === m.kind ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-44">
        {entries.length === 0 && !voiceOn && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">可以這樣問，或按右下角的麥克風用說的：</p>
            {mode.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => submit(example)}
                className="min-h-11 rounded-xl border bg-card px-4 py-2.5 text-left text-sm active:bg-muted"
              >
                {example}
              </button>
            ))}
          </div>
        )}
        {entries.map((entry) => (
          <EntryView key={entry.id} entry={entry} onAskChange={replaceAsk} />
        ))}
        <div ref={bottomRef} />
      </main>

      <div className="fixed inset-x-0 bottom-14 z-10 mx-auto flex max-w-md flex-col gap-1.5 border-t bg-background px-3 py-2">
        {voiceOn && (
          <Suspense
            fallback={
              <Button className="h-14 w-full gap-2 text-base" disabled>
                <Loader2 className="size-5 animate-spin" />
                載入中…
              </Button>
            }
          >
            <VoiceDock conversation={conversation} onClose={() => setVoiceOn(false)} />
          </Suspense>
        )}
        {!voiceOn && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit(question)
            }}
            className="flex flex-col gap-1.5"
          >
            {error && <p className="px-1 text-sm text-destructive">{error}</p>}
            {/* 數字查詢只查得到登入者看得到的客戶；規定題查的是公司文件，不分客戶，不必提 */}
            {user && kind === "data" && <p className="px-1 text-[11px] text-muted-foreground">{askScopeText(user)}</p>}
            <div className="flex gap-2">
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={mode.placeholder}
                aria-label="輸入問題"
                className="h-11 bg-card"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                onClick={() => setVoiceOn(true)}
                aria-label="用說的問"
              >
                <Mic className="size-4" />
              </Button>
              <Button type="submit" size="icon" className="size-11 shrink-0" disabled={sending || !question.trim()} aria-label="送出">
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </form>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
```

**這一步結束時的已知狀態**：語音會話開著的時候輸入框是收起來的，所以「會話中打字」還做不到——那是 Task 4。這一步的目標是兩種輸入在同一條對話裡、同一頁上。

- [ ] **Step 5: 刪掉 voice.tsx，改路由與導覽**

```bash
git rm frontend/src/pages/voice.tsx
```

`frontend/src/App.tsx`：刪掉 `const VoicePage = lazy(() => import("@/pages/voice"))` 那一行，並把 `/voice` 那個 `<Route>`（含它的 `Suspense` 包裝）換成：

```tsx
            {/* 語音併進問答頁了，舊書籤與導覽說明還指得到這個網址 */}
            <Route path="/voice" element={<Navigate to="/ask" replace />} />
```

`Navigate` 已經在 App.tsx 的 import 裡。`lazy` 與 `Suspense` 在 App.tsx 裡**只有 VoicePage 在用**（第 29 行與第 127-129 行），刪掉之後就是未使用的 import，第 1 行要改成：

```ts
import { useEffect, type ReactNode } from "react"
```

`frontend/src/components/bottom-nav.tsx`：`TABS` 刪掉最後一項，並移除 `AudioLines` 的 import：

```ts
const TABS = [
  { to: "/", label: "今日", icon: CalendarDays },
  { to: "/customers", label: "客戶", icon: Users },
  { to: "/ask", label: "問答", icon: MessageCircleQuestion },
]
```

- [ ] **Step 6: 改導覽說明**

`frontend/src/components/onboarding.tsx` 第 24 行把「或到『語音』用講的」改掉，因為已經沒有語音分頁了：

```ts
    body: "在「問答」打字，或按麥克風用講的，查數字和公司規定，答案附出處。查不到可以轉給主管，主管回覆了首頁會提醒你。",
```

**第 19 行的「語音記錄」不要動**——那是拜訪錄音，跟這次合併的語音問答是兩回事。

- [ ] **Step 7: 三個檢查**

```bash
cd frontend && npm run build && npm run typecheck && npx vitest run
```
Expected: 三個都成功。build 的輸出裡應該仍看得到一個獨立的 voice chunk（`VoiceDock` 那包），確認 lazy 邊界還在。

- [ ] **Step 8: 實際跑一次**

```bash
cd frontend && npm run dev
```

確認：`/ask` 有輸入框與麥克風鈕；打字送出後對話裡出現問題與查詢卡片；按麥克風後輸入框換成語音控制列；`/voice` 會自動導到 `/ask`；底部只有三格。

- [ ] **Step 9: Commit**

```bash
git add -A frontend/src
git commit -m "$(cat <<'EOF'
Merge the voice page into the Q&A page

One conversation, two inputs. The Gemini Live SDK and the audio code stay
behind a lazy boundary, so the typed path does not load them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 會話中打字、閒置修正、靜音、文件

**Files:**
- Modify: `frontend/src/voice/voice-controller.ts`
- Modify: `frontend/src/voice/use-voice-session.ts`
- Modify: `frontend/src/components/ask/voice-dock.tsx`
- Modify: `frontend/src/pages/ask.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 3 的 `<VoiceDock conversation onClose />`
- Produces:
  - `VoiceController.sendText(text: string): void`
  - `VoiceController.noteActivity(): void`
  - `VoiceController.setMuted(muted: boolean): void`
  - `VoiceView` 多一個 `muted: boolean`
  - `<VoiceDock conversation onClose onSession={(session: VoiceSession | null) => void} />`，其中 `VoiceSession = { sendText: (text: string) => void; noteActivity: () => void }`

- [ ] **Step 1: controller 加三個方法**

`frontend/src/voice/voice-controller.ts`。`VoiceView` 加 `muted`：

```ts
export type VoiceView = {
  status: VoiceStatus
  notice: string | null
  level: number
  pending: number
  muted: boolean
}
```

初始值 `private view: VoiceView = { status: "idle", notice: null, level: 0, pending: 0, muted: false }`。

加三個 public 方法（放在 `interrupt` 後面）：

```ts
  /** 打字送進同一個會話：模型保有上下文，會用講的回答 */
  sendText = (text: string) => {
    const conn = this.conn
    const trimmed = text.trim().slice(0, MAX_QUESTION_LENGTH)
    if (!conn?.session || !trimmed) return
    conn.lastActivity = Date.now()
    this.conversation.addUtterance("user", "typed", trimmed)
    conn.session.sendClientContent({ turns: trimmed, turnComplete: true })
  }

  /** 業務正在輸入框裡打字。打字不產生音訊，閒置計時器要知道人還在，否則會打到一半被掛斷 */
  noteActivity = () => {
    if (this.conn) this.conn.lastActivity = Date.now()
  }

  /** 靜音只是不播出來：Live 原生語音模型照樣會產生音訊，也照樣計費 */
  setMuted = (muted: boolean) => {
    if (muted) this.conn?.player.stop()
    this.update({ muted })
  }
```

`onMessage` 裡播放音訊那一行加上靜音判斷：

```ts
        if (audio?.data && audio.mimeType?.startsWith("audio/pcm") && !conn.dropModelAudio && !this.view.muted)
          conn.player.play(audio.data)
```

- [ ] **Step 2: hook 把三個方法傳出去**

`frontend/src/voice/use-voice-session.ts` 的回傳加三個：

```ts
  return {
    ...view,
    start: controller.start,
    stop: controller.stop,
    interrupt: controller.interrupt,
    sendText: controller.sendText,
    noteActivity: controller.noteActivity,
    setMuted: controller.setMuted,
  }
```

- [ ] **Step 3: VoiceDock 把 session 交給頁面，並加靜音鈕**

`frontend/src/components/ask/voice-dock.tsx`。props 加 `onSession`，並在 `voice.status` 變動時把可用的介面交出去（會話結束就交 `null`）：

```tsx
export type VoiceSession = { sendText: (text: string) => void; noteActivity: () => void }

export default function VoiceDock({
  conversation,
  onClose,
  onSession,
}: {
  conversation: Conversation
  onClose: () => void
  onSession: (session: VoiceSession | null) => void
}) {
  const voice = useVoiceSession(conversation)
  const live = voice.status === "listening" || voice.status === "speaking"

  useEffect(() => {
    void voice.start()
    return () => onSession(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    onSession(live ? { sendText: voice.sendText, noteActivity: voice.noteActivity } : null)
  }, [live, onSession, voice.sendText, voice.noteActivity])
```

在 `listening`／`speaking` 那個 return 的按鈕列裡，「打斷」前面加靜音鈕：

```tsx
      <Button
        variant="outline"
        size="icon"
        className="size-11 shrink-0"
        onClick={() => voice.setMuted(!voice.muted)}
        aria-label={voice.muted ? "取消靜音" : "靜音"}
        aria-pressed={voice.muted}
      >
        {voice.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </Button>
```

`VolumeX`、`Volume2` 加進 lucide-react 的 import。

- [ ] **Step 4: 頁面在會話中也顯示輸入框**

`frontend/src/pages/ask.tsx`：

加一個 state 存 session：

```ts
  const [session, setSession] = useState<VoiceSession | null>(null)
```

（`import type { VoiceSession } from "@/components/ask/voice-dock"` — type-only import 不會把 VoiceDock 拉進主 chunk。）

`<VoiceDock>` 加上 `onSession={setSession}`。

`submit` 開頭改成：會話活著就走 Live，否則走現在的路：

```ts
  async function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setError(null)
    // 語音會話開著就送進同一個會話，模型保有上下文並用講的回答；entry 由 controller 加
    if (session) {
      session.sendText(trimmed)
      setQuestion("")
      return
    }
    setSending(true)
    conversation.addUtterance("user", "typed", trimmed)
    const entryId = conversation.addToolRun(kind, trimmed)
    setQuestion("")
    try {
      await runAsk(conversation, entryId, kind, trimmed, polls.current.signal)
    } catch (err) {
      if (polls.current.signal.aborted) return
      const message = err instanceof Error ? err.message : "送出失敗，請再試一次"
      conversation.replace(entryId, { error: message })
      setError(message)
    } finally {
      setSending(false)
    }
  }
```

把輸入框那個 `form` 從 `{!voiceOn && (...)}` 裡拿出來，改成**永遠顯示**，`VoiceDock` 顯示在它上面。輸入框的 `onChange` 加上活動通知：

```tsx
              <Input
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value)
                  session?.noteActivity()
                }}
                placeholder={session ? "也可以打字問，AI 會用講的回答" : mode.placeholder}
                aria-label="輸入問題"
                className="h-11 bg-card"
              />
```

麥克風鈕只在 `!voiceOn` 時顯示（會話開著時 VoiceDock 已經有控制列了）。查詢範圍那一行的條件改成 `user && kind === "data" && !voiceOn`——會話中是模型選工具，那行文字對不上。

- [ ] **Step 5: 三個檢查**

```bash
cd frontend && npm run build && npm run typecheck && npx vitest run
```
Expected: 三個都成功

- [ ] **Step 6: 實際跑一次**

```bash
cd frontend && npm run dev
```

確認：沒有會話時打字走文字回答；按麥克風後輸入框還在，`placeholder` 換成「也可以打字問，AI 會用講的回答」；靜音鈕會切換圖示。**沒有 Gemini 金鑰時連不上 Live，會話相關的部分驗到「按下去有反應、失敗有提示」即可。**

- [ ] **Step 7: 更新 README**

`README.md`：

- 「語音問答（Gemini Live）」那一節的第一句「底部分頁的『語音』：用講的問…」改成說明它現在是問答頁上的麥克風。
- 加一句說明靜音：**AI 照常回答與計費，靜音只是不播出來**，因為 Live 原生語音模型不能只回文字。
- 「問答：數字查詢與知識查詢」那一節加一句：打字與語音在同一條對話裡，語音會話開著時打字會送進同一個會話、由 AI 用講的回答。
- 專案結構表裡 `frontend/src/voice` 的說明維持，另外加一行 `frontend/src/ask` 對話 store 與查詢輪詢。

- [ ] **Step 8: 確認後端沒被波及**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 597 passed（這次完全沒動 `backend/`，這一步只是確認）

- [ ] **Step 9: Commit**

```bash
git add frontend/src README.md
git commit -m "$(cat <<'EOF'
Let typing join the live session, and add a mute

Typing during a session goes in as a turn, so the model keeps context and
answers aloud. Typing now counts as activity, which stops the idle timer
hanging up mid-sentence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完工檢查

- [ ] `cd frontend && npm run build` 成功，且輸出裡仍有獨立的 voice chunk
- [ ] `cd frontend && npm run typecheck` 成功
- [ ] `cd frontend && npx vitest run` 全綠
- [ ] `uv run --project backend pytest backend/tests -q` 仍是 597 passed
- [ ] `grep -rn "pages/voice" frontend/src` 沒有結果
- [ ] `git log --oneline main..` 有五個 commit（spec 一個、四個 task 各一個）

## 不在這次範圍

- **不做對話持久化。** 離開頁面或重新整理就清空。
- **不做自動判斷「查數字／查規定」。** 打字仍由使用者選。
- **不補其他前端測試。** vitest 只為 `conversation.ts` 進來。
- **不動後端。**

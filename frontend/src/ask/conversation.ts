/**
 * 一條問答對話裡有哪些東西。打字與語音都寫進同一條串，畫面才會是一條對話而不是兩條。
 *
 * 這裡刻意不碰音訊、網路與 React：語音模組（src/voice）是 lazy 載入的，只打字的人不該
 * 為了顯示對話而載入 Gemini Live 與音訊處理。
 */

import { tidyTranscript } from "@/ask/transcript"
import type { UiDemoKind } from "@/lib/ui-demo"
import type { Attachment } from "@/api/attachments"
import type { Ask, AskKind } from "@/api/asks"
import type { AskPageContext } from "@/ask/page-context"

export type UtteranceSource = "voice" | "typed"
export type EntryMetadata = {
  threadId?: string
  createdAt?: string
  ghost?: boolean
}

/** 業務或 AI 說的一句話。source 決定要不要標「語音辨識，僅供參考」——打字的是原文，不必標。
 * attachment：打字提問附的照片或 PDF，送出後後端回了才有（要用後端簽過名的網址） */
export type Utterance = EntryMetadata & {
  id: number
  kind: "user" | "model"
  source: UtteranceSource
  text: string
  demo?: UiDemoKind
  demoPath?: string
  attachment?: Attachment
  page?: AskPageContext
}

/** 一次查詢：打字問答與語音的工具呼叫長得一樣，所以共用同一種 entry。
 * 打字送出前會先整理：routing 是正在整理（判斷該查哪一種、追問要不要改寫）；clarification 是等待使用者以文字補充；choices 只相容舊紀錄；
 * auto 是自動判斷好直接查的。
 * question 是實際拿去查的那一句；看了前文改寫過時，original 是業務原本打的那句 */
export type ToolRun = EntryMetadata & {
  id: number
  kind: "tool"
  askKind: AskKind | null
  question: string
  original: string | null
  ask: Ask | null
  error: string | null
  cancelled: boolean
  routing: boolean
  choices: AskKind[] | null
  auto: boolean
  page?: AskPageContext
  contextUsed?: boolean
  clarification?: string | null
  hasFile?: boolean
}

export type Entry = Utterance | ToolRun

export type Conversation = {
  getSnapshot: () => Entry[]
  merge: (entries: Entry[]) => void
  subscribe: (listener: () => void) => () => void
  addUtterance: (
    kind: "user" | "model",
    source: UtteranceSource,
    text?: string,
    options?: Pick<Utterance, "demo" | "demoPath" | "page"> & EntryMetadata
  ) => number
  addToolRun: (
    askKind: AskKind | null,
    question: string,
    state?: Partial<Pick<ToolRun, "routing" | "original" | "page" | "hasFile">> & EntryMetadata
  ) => number
  appendText: (id: number, chunk: string) => void
  replace: (id: number, patch: Partial<Omit<ToolRun, "id" | "kind">>) => void
  completeWithMessage: (
    id: number,
    source: UtteranceSource,
    text: string,
    options?: Pick<Utterance, "demo" | "demoPath">
  ) => void
  attach: (id: number, attachment: Attachment) => void
}

export function createConversation(
  nextId?: () => number,
  metadata: () => EntryMetadata = () => ({})
): Conversation {
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

    merge: (history) => {
      const merged = new Map(history.map((entry) => [entry.id, entry]))
      for (const entry of entries) merged.set(entry.id, entry)
      for (const id of merged.keys()) lastId = Math.max(lastId, id)
      commit([...merged.values()])
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    addUtterance: (kind, source, text = "", options = {}) => {
      const id = nextId ? nextId() : ++lastId
      commit([...entries, { ...metadata(), id, kind, source, text, ...options }])
      return id
    },

    addToolRun: (askKind, question, state = {}) => {
      const id = nextId ? nextId() : ++lastId
      const run: ToolRun = {
        ...metadata(),
        id,
        kind: "tool",
        askKind,
        question,
        original: null,
        ask: null,
        error: null,
        cancelled: false,
        routing: false,
        choices: null,
        auto: false,
        ...state,
      }
      commit([...entries, run])
      return id
    },

    appendText: (id, chunk) => {
      const target = entries.find((entry) => entry.id === id)
      if (!target || target.kind === "tool") return
      commit(
        entries.map((e) =>
          e.id === id && e.kind !== "tool"
            ? { ...e, text: tidyTranscript(e.text + chunk) }
            : e
        )
      )
    },

    attach: (id, attachment) => {
      const target = entries.find((entry) => entry.id === id)
      if (!target || target.kind !== "user") return
      commit(
        entries.map((e) =>
          e.id === id && e.kind === "user" ? { ...e, attachment } : e
        )
      )
    },

    completeWithMessage: (id, source, text, options = {}) => {
      const target = entries.find((entry) => entry.id === id)
      if (!target || target.kind !== "tool") return
      // 在原本的「理解問題」位置顯示一般回覆，不留下查詢卡或改動對話順序。
      commit(
        entries.map((entry) =>
          entry.id === id
            ? { id, kind: "model", source, text, page: target.page,
                threadId: target.threadId, createdAt: target.createdAt,
                ghost: target.ghost, ...options }
            : entry
        )
      )
    },

    replace: (id, patch) => {
      // 會話結束後遲到的輪詢結果會打在已經不存在的 id 上，靜靜忽略就好
      const target = entries.find((entry) => entry.id === id)
      if (!target || target.kind !== "tool") return
      commit(
        entries.map((e) =>
          e.id === id && e.kind === "tool" ? { ...e, ...patch } : e
        )
      )
    },
  }
}

/** 全站共用的對話與查詢；長期記憶綁定登入帳號，登出只釋放本機會話。 */
import { isFinished, routeAsk, type AskKind, type Turn } from "@/api/asks"
import type { Conversation } from "@/ask/conversation"
import { createConversationThreads } from "@/ask/conversation-threads"
import { recentConversationTurns } from "@/ask/conversation-context"
import { createMapEditsStore, type MapEditsStore } from "@/ask/memory-map-edits"
import type { AskPageContext } from "@/ask/page-context"
import { pollAsk, runAsk } from "@/ask/run-ask"
import { onAuthChange, readToken, readUser } from "@/lib/auth"
import { syncAccountMemory } from "@/ask/memory-sync"
import { requestedUiDemo, uiDemoKindForPage } from "@/lib/ui-demo"
import { requestedPageDemoPath } from "@/lib/page-demo"
import { oaPageHelp } from "@/ask/oa-page-help"
import { reportAssistant } from "@/ask/report-assistant"
import { customerPriorityAssistant } from "@/ask/customer-priority-assistant"

export type AskSession = {
  conversation: Conversation
  threads: ReturnType<typeof createConversationThreads>
  mapEdits: MapEditsStore
  memory: ReturnType<typeof syncAccountMemory> | null
  polls: AbortSignal
  ask: (question: string, file?: File, page?: AskPageContext) => Promise<void>
  askAsTyped: (entryId: number) => Promise<void>
  isBusy: () => boolean
  subscribe: (listener: () => void) => () => void
}

function earlierTurns(conversation: Conversation): Turn[] {
  return recentConversationTurns(conversation.getSnapshot(), 3, 300)
}

let current: { userId: string; session: AskSession; end: () => void } | null =
  null
function memoryEntryId() {
  // 使用完整的 JavaScript 安全整數隨機空間，避免不同裝置由 1 開始互相覆蓋。
  const words = crypto.getRandomValues(new Uint32Array(2))
  return (words[0] & 0x1fffff) * 0x100000000 + words[1] || 1
}

function create(userId: string): NonNullable<typeof current> {
  const localIds = new Set<number>()
  const threads = createConversationThreads(() => {
    let id = memoryEntryId()
    while (localIds.has(id)) id = memoryEntryId()
    localIds.add(id)
    return id
  })
  const mapEdits = createMapEditsStore()
  const token = readToken()
  const memory = token && userId ? syncAccountMemory(userId, token, threads.history, mapEdits) : null
  const controller = new AbortController()
  const listeners = new Set<() => void>()
  let busy = false
  // 追問時沿用原題的附檔；頁面情境則保留在原題，讓後端區分新問題和追問。
  let pendingFile: File | undefined
  const typed = new Map<
    number,
    { original: string; file?: File; page?: AskPageContext }
  >()
  const setBusy = (next: boolean) => {
    busy = next
    listeners.forEach((listener) => listener())
  }

  const run = async (
    conversation: Conversation,
    entryId: number,
    kind: AskKind,
    question: string,
    file?: File,
    utteranceId?: number
  ) => {
    await runAsk(conversation, entryId, kind, question, controller.signal, {
      file,
      utteranceId,
    })
  }
  const showError = (conversation: Conversation, entryId: number, error: unknown) => {
    if (!controller.signal.aborted)
      conversation.replace(entryId, {
        routing: false,
        error: error instanceof Error ? error.message : "送出失敗，請再試一次",
      })
  }
  const session: AskSession = {
    get conversation() { return threads.getSnapshot().conversation },
    threads,
    mapEdits,
    memory,
    polls: controller.signal,
    isBusy: () => busy,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    ask: async (question, file, page) => {
      if (busy || controller.signal.aborted || !question.trim()) return
      const conversation = threads.getSnapshot().conversation
      // 在第一個 await 之前複製，收圖／判斷時切頁也不會換掉這題的情境。
      const snapshot = page
        ? { path: page.path, title: page.title, facts: [...page.facts] }
        : undefined
      const earlier = earlierTurns(conversation)
      const utteranceId = conversation.addUtterance("user", "typed", question, {
        page: snapshot,
      })
      const pageHelp = !file ? oaPageHelp(question, snapshot) : null
      if (pageHelp) {
        conversation.addUtterance("model", "typed", pageHelp, {
          page: snapshot,
        })
        return
      }
      const demo = !file ? requestedUiDemo(question, snapshot?.path) : null
      if (demo) {
        conversation.addUtterance("model", "typed", "好，現在操作給你看。", {
          demo,
          page: snapshot,
          demoPath:
            demo === "page-tour"
              ? (requestedPageDemoPath(question, snapshot?.path) ??
                snapshot?.path)
              : undefined,
        })
        return
      }
      const editorAssistant = !file
        ? [reportAssistant, customerPriorityAssistant].find((assistant) =>
            assistant.handles(question, snapshot)
          )
        : undefined
      if (editorAssistant) {
        const entryId = conversation.addToolRun(null, question, {
          routing: true,
          page: snapshot,
        })
        setBusy(true)
        try {
          const message = await editorAssistant.ask(question)
          if (!controller.signal.aborted)
            conversation.completeWithMessage(entryId, "typed", message)
        } catch (error) {
          showError(conversation, entryId, error)
        } finally {
          setBusy(false)
        }
        return
      }
      const previousFile = pendingFile
      pendingFile = undefined
      const entryId = conversation.addToolRun(null, question, {
        routing: true,
        page: snapshot,
        hasFile: Boolean(file),
      })
      setBusy(true)
      try {
        const routed = await routeAsk(
          question,
          Boolean(file),
          earlier,
          snapshot
        )
        if (controller.signal.aborted) return
        if (
          (routed.intent === "page_help" || routed.intent === "page_demo") &&
          routed.answer?.trim()
        ) {
          const demoPath =
            routed.intent === "page_demo" ? routed.demo_path : null
          const [path, search] = demoPath?.split("?") ?? []
          conversation.completeWithMessage(
            entryId,
            "typed",
            demoPath ? "好，現在操作給你看。" : routed.answer,
            path
              ? {
                  demo: uiDemoKindForPage(path, search ? `?${search}` : ""),
                  demoPath: demoPath ?? undefined,
                }
              : {}
          )
          return
        }
        const asked = routed.question.trim() || question
        const original =
          routed.rewritten && asked !== question ? question : null
        const attachment =
          file ?? (routed.continues_previous ? previousFile : undefined)
        conversation.replace(entryId, {
          routing: false,
          question: asked,
          original,
          contextUsed: routed.context_used ?? false,
          hasFile: Boolean(attachment),
        })
        if (!routed.kind) {
          const clarification =
            routed.clarification ||
            "你想了解哪個對象、哪一方面的狀況？可以再說明一下。"
          conversation.replace(entryId, { clarification })
          if (threads.getSnapshot().conversation === conversation) pendingFile = attachment
          return
        }
        conversation.replace(entryId, { askKind: routed.kind, auto: true })
        typed.set(entryId, {
          original: question,
          file: attachment,
          page: snapshot,
        })
        await run(conversation, entryId, routed.kind, asked, attachment, utteranceId)
      } catch (error) {
        showError(conversation, entryId, error)
      } finally {
        setBusy(false)
      }
    },
    askAsTyped: async (entryId) => {
      const conversation = threads.getSnapshot().conversation
      const target = conversation
        .getSnapshot()
        .find((entry) => entry.id === entryId)
      const asked = typed.get(entryId) ?? (target?.kind === "tool" && target.original
        ? { original: target.original, page: target.page, file: undefined }
        : undefined)
      if (
        busy ||
        controller.signal.aborted ||
        !asked ||
        target?.kind !== "tool" ||
        !target.askKind ||
        !target.original
      )
        return
      const retryId = conversation.addToolRun(target.askKind, asked.original, {
        page: asked.page,
      })
      setBusy(true)
      try {
        let file = asked.file
        if (!file && target.hasFile) {
          const source = target.ask?.attachment
          if (!source) throw new Error("請重新附上原本的檔案後再提問。")
          const response = await fetch(source.url, { signal: controller.signal })
          if (!response.ok) throw new Error("原本的附件暫時無法讀取，請重新附檔。")
          const blob = await response.blob()
          file = new File([blob], source.filename, { type: blob.type })
        }
        if (!controller.signal.aborted) await run(conversation, retryId, target.askKind, asked.original, file)
      } catch (error) {
        showError(conversation, retryId, error)
      } finally {
        setBusy(false)
      }
    },
  }
  const resumed = new Set<number>()
  const resumeHistory = () => {
    if (controller.signal.aborted) return
    for (const entry of threads.history.getSnapshot()) {
      if (entry.kind !== "tool") continue
      if (!localIds.has(entry.id) && !resumed.has(entry.id) && entry.ask && !isFinished(entry.ask)) {
        resumed.add(entry.id)
        void pollAsk(threads.history, entry.id, entry.ask, controller.signal).catch((error) => showError(threads.history, entry.id, error))
      }
    }
  }
  const restoreHistory = () => { threads.restoreLatest(); resumeHistory() }
  const unsubscribeMemory = memory?.subscribe(restoreHistory)
  void memory?.ready.then(restoreHistory)
  const unsubscribeThread = threads.subscribe(() => { pendingFile = undefined; typed.clear() })
  return {
    userId,
    session,
    end: () => {
      unsubscribeThread()
      unsubscribeMemory?.()
      memory?.stop()
      controller.abort()
      pendingFile = undefined
    },
  }
}

function end() {
  current?.end()
  current = null
}
onAuthChange(() => {
  if (current && readUser()?.id !== current.userId) end()
})

export function askSessionFor(userId: string): AskSession {
  if (current?.userId !== userId) {
    end()
    current = create(userId)
  }
  return current.session
}

/** 正常登出先送完記憶，再讓伺服器撤銷 token；失敗的內容留在帳號專屬待同步佇列。 */
export async function flushAccountMemory() {
  await current?.session.memory?.flush()
}

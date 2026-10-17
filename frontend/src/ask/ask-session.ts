/** 全站共用的對話與查詢。切頁或收起視窗不中止；登出、換人登入才清空。 */
import { isFinished, routeAsk, type AskKind, type Turn } from "@/api/asks"
import {
  createConversation,
  type Conversation,
  type ToolRun,
} from "@/ask/conversation"
import { createMapEditsStore, type MapEditsStore } from "@/ask/memory-map-edits"
import type { AskPageContext } from "@/ask/page-context"
import { runAsk } from "@/ask/run-ask"
import { onAuthChange, readUser } from "@/lib/auth"
import { wantsOrderDemo } from "@/lib/ui-demo"

export type AskSession = {
  conversation: Conversation
  mapEdits: MapEditsStore
  polls: AbortSignal
  ask: (question: string, file?: File, page?: AskPageContext) => Promise<void>
  askAsTyped: (entryId: number) => Promise<void>
  isBusy: () => boolean
  subscribe: (listener: () => void) => () => void
}

function earlierTurns(conversation: Conversation): Turn[] {
  return conversation
    .getSnapshot()
    .filter((entry): entry is ToolRun => entry.kind === "tool")
    .filter(
      (run) =>
        run.clarification || (run.ask && isFinished(run.ask) && run.ask.answer)
    )
    .slice(-3)
    .map((run) => ({
      question: run.question,
      answer: (run.clarification || run.ask?.answer || "").slice(0, 300),
      ...(run.page ? { page: run.page } : {}),
      ...(run.clarification && run.hasFile ? { has_file: true } : {}),
    }))
}

let current: { userId: string; session: AskSession; end: () => void } | null =
  null

function create(userId: string): NonNullable<typeof current> {
  const conversation = createConversation()
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
  const showError = (entryId: number, error: unknown) => {
    if (!controller.signal.aborted)
      conversation.replace(entryId, {
        routing: false,
        error: error instanceof Error ? error.message : "送出失敗，請再試一次",
      })
  }
  const session: AskSession = {
    conversation,
    mapEdits: createMapEditsStore(),
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
      // 在第一個 await 之前複製，收圖／判斷時切頁也不會換掉這題的情境。
      const snapshot = page
        ? { path: page.path, title: page.title, facts: [...page.facts] }
        : undefined
      const earlier = earlierTurns(conversation)
      const utteranceId = conversation.addUtterance("user", "typed", question)
      if (!file && wantsOrderDemo(question)) {
        conversation.addUtterance("model", "typed", "要不要我操作給你看？", {
          demo: "create-order",
        })
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
          pendingFile = attachment
          return
        }
        conversation.replace(entryId, { askKind: routed.kind, auto: true })
        typed.set(entryId, {
          original: question,
          file: attachment,
          page: snapshot,
        })
        await run(entryId, routed.kind, asked, attachment, utteranceId)
      } catch (error) {
        showError(entryId, error)
      } finally {
        setBusy(false)
      }
    },
    askAsTyped: async (entryId) => {
      const asked = typed.get(entryId)
      const target = conversation
        .getSnapshot()
        .find((entry) => entry.id === entryId)
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
        await run(retryId, target.askKind, asked.original, asked.file)
      } catch (error) {
        showError(retryId, error)
      } finally {
        setBusy(false)
      }
    },
  }
  return {
    userId,
    session,
    end: () => {
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

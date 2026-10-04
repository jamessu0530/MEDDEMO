/**
 * 問答的對話與還在跑的查詢，活在頁面之外。
 *
 * 這兩樣原本放在問答頁的 state 裡：切到別的分頁（例如促銷）頁面卸載，對話就沒了、查到一半的輪詢也被中止，
 * 切回來是一張空白的問答頁，而後端其實還在查。現在跟著「登入的這個人」走：同一個人切頁再回來照舊看得到，
 * 登出或換人登入才清掉，上一個人的提問不會留給下一個人看。重新整理頁面一樣會清空，對話只存在記憶體裡。
 *
 * 這裡不碰 React，畫面用 useSyncExternalStore 訂閱（pages/ask.tsx）。
 */

import { ASK_KINDS, routeAsk, type AskKind, type AskMode, type RouteResult } from "@/api/asks"
import { createConversation, type Conversation } from "@/ask/conversation"
import { runAsk } from "@/ask/run-ask"
import { onAuthChange, readUser } from "@/lib/auth"

export type AskSession = {
  conversation: Conversation
  /** 登出或換人登入時中止。打字的查詢與語音呼叫工具的查詢都看這一個，離開問答頁不會中止 */
  polls: AbortSignal
  /** 送出一題打字的提問（可以附一個檔案）並輪詢到有結果，錯誤寫在那一格上。已經有一題在跑就不送。
   * mode 是 auto 就先問後端該查哪一種：有把握直接查，沒把握在那一格列出選項等業務點（choose） */
  ask: (mode: AskMode, question: string, file?: File) => Promise<void>
  /** 業務選了要查哪一種：等他選的那一格就地開始查；已經自動判斷查過的，另開一格用這一種重查 */
  choose: (entryId: number, kind: AskKind) => Promise<void>
  /** 有打字的提問還沒答完（送出鈕轉圈、擋掉連按） */
  isBusy: () => boolean
  subscribe: (listener: () => void) => () => void
}

// 後端或 Jev 沒回答：三種都列出來請業務選。不默默當成查數字，問規定或頻道的人會拿到錯的答案
const UNSURE: RouteResult = { kind: null, choices: ASK_KINDS, confidence: null }

let current: { userId: string; session: AskSession; end: () => void } | null = null

function create(userId: string): NonNullable<typeof current> {
  const conversation = createConversation()
  const controller = new AbortController()
  const listeners = new Set<() => void>()
  let busy = false

  // 每一格打字提問的原文、附檔與那一句話：業務之後選了種類、或換一種重查時，要用同一份再送一次
  const typed = new Map<number, { question: string; file?: File; utteranceId: number }>()

  const setBusy = (next: boolean) => {
    busy = next
    for (const listener of listeners) listener()
  }

  /** 查一格並輪詢到有結果。utteranceId：送出後把後端回的附件掛到那一句話上（重查時已經掛過了，不給） */
  const run = async (entryId: number, kind: AskKind, question: string, file?: File, utteranceId?: number) => {
    setBusy(true)
    try {
      await runAsk(conversation, entryId, kind, question, controller.signal, { file, utteranceId })
    } catch (error) {
      // 登出時中止的不算錯；其餘寫在那一格卡片上，輸入框上面不另外放橫幅
      if (!controller.signal.aborted) {
        conversation.replace(entryId, { error: error instanceof Error ? error.message : "送出失敗，請再試一次" })
      }
    } finally {
      setBusy(false)
    }
  }

  const session: AskSession = {
    conversation,
    polls: controller.signal,
    isBusy: () => busy,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    ask: async (mode, question, file) => {
      if (busy) return
      const utteranceId = conversation.addUtterance("user", "typed", question)
      if (mode !== "auto") {
        const entryId = conversation.addToolRun(mode, question)
        typed.set(entryId, { question, file, utteranceId })
        await run(entryId, mode, question, file, utteranceId)
        return
      }
      setBusy(true)
      const entryId = conversation.addToolRun(null, question, { routing: true })
      typed.set(entryId, { question, file, utteranceId })
      // 判斷失敗（後端連不上、Jev 逾時、用量上限）也不擋：改成請業務自己選
      const routed = await routeAsk(question, Boolean(file)).catch(() => UNSURE)
      if (controller.signal.aborted) return
      if (routed.kind) {
        conversation.replace(entryId, { routing: false, askKind: routed.kind, auto: true })
        await run(entryId, routed.kind, question, file, utteranceId)
        return
      }
      conversation.replace(entryId, { routing: false, choices: routed.choices.length ? routed.choices : ASK_KINDS })
      setBusy(false)
    },
    choose: async (entryId, kind) => {
      const asked = typed.get(entryId)
      const target = conversation.getSnapshot().find((entry) => entry.id === entryId)
      if (busy || !asked || target?.kind !== "tool") return
      if (target.choices) {
        conversation.replace(entryId, { choices: null, askKind: kind })
        await run(entryId, kind, asked.question, asked.file, asked.utteranceId)
        return
      }
      const retryId = conversation.addToolRun(kind, asked.question)
      typed.set(retryId, asked)
      await run(retryId, kind, asked.question, asked.file)
    },
  }
  return { userId, session, end: () => controller.abort() }
}

function end() {
  current?.end()
  current = null
}

// 登出、被踢出、換人登入：這段對話就結束了。改名字這類只更新身分的變動不算
onAuthChange(() => {
  if (current && readUser()?.id !== current.userId) end()
})

/** 這個人的問答對話；問答頁每次掛上都拿到同一段 */
export function askSessionFor(userId: string): AskSession {
  if (current?.userId !== userId) {
    end()
    current = create(userId)
  }
  return current.session
}

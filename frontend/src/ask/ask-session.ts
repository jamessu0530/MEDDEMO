/**
 * 問答的對話與還在跑的查詢，活在頁面之外。
 *
 * 這兩樣原本放在問答頁的 state 裡：切到別的分頁（例如促銷）頁面卸載，對話就沒了、查到一半的輪詢也被中止，
 * 切回來是一張空白的問答頁，而後端其實還在查。現在跟著「登入的這個人」走：同一個人切頁再回來照舊看得到，
 * 登出或換人登入才清掉，上一個人的提問不會留給下一個人看。重新整理頁面一樣會清空，對話只存在記憶體裡。
 *
 * 這裡不碰 React，畫面用 useSyncExternalStore 訂閱（pages/ask.tsx）。
 */

import { ASK_KINDS, isFinished, routeAsk, type AskKind, type AskMode, type RouteResult, type Turn } from "@/api/asks"
import { createConversation, type Conversation, type ToolRun } from "@/ask/conversation"
import { runAsk } from "@/ask/run-ask"
import { onAuthChange, readUser } from "@/lib/auth"

export type AskSession = {
  conversation: Conversation
  /** 登出或換人登入時中止。打字的查詢與語音呼叫工具的查詢都看這一個，離開問答頁不會中止 */
  polls: AbortSignal
  /** 送出一題打字的提問（可以附一個檔案）並輪詢到有結果，錯誤寫在那一格上。已經有一題在跑就不送。
   * 前面有答完的題目就一起帶給後端：要看前文才懂（「那康泰呢？」）會先改寫成完整問句再查。
   * mode 是 auto 就再判斷該查哪一種：有把握直接查，沒把握在那一格列出選項等業務點（choose） */
  ask: (mode: AskMode, question: string, file?: File) => Promise<void>
  /** 業務選了要查哪一種：等他選的那一格就地開始查；已經自動判斷查過的，另開一格用這一種重查 */
  choose: (entryId: number, kind: AskKind) => Promise<void>
  /** 改寫的意思不對：另開一格，用業務原本打的那句、同一種查 */
  askAsTyped: (entryId: number) => Promise<void>
  /** 有打字的提問還沒答完（送出鈕轉圈、擋掉連按） */
  isBusy: () => boolean
  subscribe: (listener: () => void) => () => void
}

// 帶給後端的前文：最近幾輪答完的查詢（打字與語音都算），答案只取開頭。後端還會再截一次
const EARLIER_TURNS = 3
const EARLIER_ANSWER_CHARS = 300

/** 這段對話裡最近答完的幾輪，由舊到新 */
function earlierTurns(conversation: Conversation): Turn[] {
  return conversation
    .getSnapshot()
    .filter((entry): entry is ToolRun & { ask: NonNullable<ToolRun["ask"]> } => entry.kind === "tool" && entry.ask !== null)
    .filter((run) => isFinished(run.ask) && Boolean(run.ask.answer))
    .slice(-EARLIER_TURNS)
    .map((run) => ({ question: run.question, answer: (run.ask.answer ?? "").slice(0, EARLIER_ANSWER_CHARS) }))
}

let current: { userId: string; session: AskSession; end: () => void } | null = null

function create(userId: string): NonNullable<typeof current> {
  const conversation = createConversation()
  const controller = new AbortController()
  const listeners = new Set<() => void>()
  let busy = false

  // 每一格打字提問實際查的那一句、業務原本打的（改寫過才有）、附檔與那一句話：
  // 業務之後選了種類、換一種重查或照原話查時，要用同一份再送一次
  const typed = new Map<number, { question: string; original: string | null; file?: File; utteranceId: number }>()

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
      const earlier = earlierTurns(conversation)
      const utteranceId = conversation.addUtterance("user", "typed", question)
      // 自己指定了種類、前面也沒有答完的題目：沒有東西要整理，直接查
      if (mode !== "auto" && earlier.length === 0) {
        const entryId = conversation.addToolRun(mode, question)
        typed.set(entryId, { question, original: null, file, utteranceId })
        await run(entryId, mode, question, file, utteranceId)
        return
      }
      setBusy(true)
      const entryId = conversation.addToolRun(mode === "auto" ? null : mode, question, { routing: true })
      // 整理失敗（後端連不上、Jev 逾時、用量上限）也不擋：原話照送；選「自動」的就三種都列出來請業務選，
      // 不默默當成查數字，問規定或頻道的人會拿到錯的答案
      const unsure: RouteResult = {
        kind: mode === "auto" ? null : mode, choices: ASK_KINDS, confidence: null, question, rewritten: false,
      }
      const routed = await routeAsk(question, Boolean(file), earlier, mode === "auto" ? undefined : mode).catch(() => unsure)
      if (controller.signal.aborted) return
      const asked = routed.question.trim() || question
      const original = routed.rewritten && asked !== question ? question : null
      typed.set(entryId, { question: asked, original, file, utteranceId })
      if (routed.kind) {
        conversation.replace(entryId, { routing: false, askKind: routed.kind, auto: mode === "auto", question: asked, original })
        await run(entryId, routed.kind, asked, file, utteranceId)
        return
      }
      const choices = routed.choices.length ? routed.choices : ASK_KINDS
      conversation.replace(entryId, { routing: false, choices, question: asked, original })
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
      const retryId = conversation.addToolRun(kind, asked.question, { original: asked.original })
      typed.set(retryId, asked)
      await run(retryId, kind, asked.question, asked.file)
    },
    askAsTyped: async (entryId) => {
      const asked = typed.get(entryId)
      const target = conversation.getSnapshot().find((entry) => entry.id === entryId)
      if (busy || !asked?.original || target?.kind !== "tool" || !target.askKind) return
      const retryId = conversation.addToolRun(target.askKind, asked.original)
      typed.set(retryId, { ...asked, question: asked.original, original: null })
      await run(retryId, target.askKind, asked.original, asked.file)
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

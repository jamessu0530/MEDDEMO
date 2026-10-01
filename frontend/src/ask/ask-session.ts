/**
 * 問答的對話與還在跑的查詢，活在頁面之外。
 *
 * 這兩樣原本放在問答頁的 state 裡：切到別的分頁（例如促銷）頁面卸載，對話就沒了、查到一半的輪詢也被中止，
 * 切回來是一張空白的問答頁，而後端其實還在查。現在跟著「登入的這個人」走：同一個人切頁再回來照舊看得到，
 * 登出或換人登入才清掉，上一個人的提問不會留給下一個人看。重新整理頁面一樣會清空，對話只存在記憶體裡。
 *
 * 這裡不碰 React，畫面用 useSyncExternalStore 訂閱（pages/ask.tsx）。
 */

import type { AskKind } from "@/api/asks"
import { createConversation, type Conversation } from "@/ask/conversation"
import { runAsk } from "@/ask/run-ask"
import { onAuthChange, readUser } from "@/lib/auth"

export type AskSession = {
  conversation: Conversation
  /** 登出或換人登入時中止。打字的查詢與語音呼叫工具的查詢都看這一個，離開問答頁不會中止 */
  polls: AbortSignal
  /** 送出一題打字的提問（可以附一個檔案）並輪詢到有結果，錯誤寫在那一格上。已經有一題在跑就不送 */
  ask: (kind: AskKind, question: string, file?: File) => Promise<void>
  /** 有打字的提問還沒答完（送出鈕轉圈、擋掉連按） */
  isBusy: () => boolean
  subscribe: (listener: () => void) => () => void
}

let current: { userId: string; session: AskSession; end: () => void } | null = null

function create(userId: string): NonNullable<typeof current> {
  const conversation = createConversation()
  const controller = new AbortController()
  const listeners = new Set<() => void>()
  let busy = false

  const setBusy = (next: boolean) => {
    busy = next
    for (const listener of listeners) listener()
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
    ask: async (kind, question, file) => {
      if (busy) return
      setBusy(true)
      const utteranceId = conversation.addUtterance("user", "typed", question)
      const entryId = conversation.addToolRun(kind, question)
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

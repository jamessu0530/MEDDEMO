import {
  askPriorityAdvice,
  type PriorityAdvice,
  type PriorityAdviceMessage,
  type PriorityPreset,
  type PriorityStrategy,
} from "@/api/customer-priority"
import type { AskPageContext } from "@/ask/page-context"
import { onAuthChange, readUser } from "@/lib/auth"
import { strategyFingerprint } from "@/lib/customer-priority"

type PriorityEditor = {
  managerId: string
  strategy: PriorityStrategy
  disabled: boolean
  onUse: (strategy: PriorityStrategy, baseFingerprint: string) => void
}
type Proposal = { answer: PriorityAdvice; base: PriorityStrategy }
type State = {
  editing: boolean
  busy: boolean
  disabled: boolean
  proposal: Proposal | null
}

// Only these explicit requests select a guide; other wording goes to the AI.
const PRESETS = new Map<string, PriorityPreset>([
  ["先給我均衡起點", "balanced"],
  ["維繫高業績客戶", "revenue"],
  ["挽回業績下滑客戶", "recovery"],
  ["優先淨毛利貢獻", "profit"],
  ["尋找成長機會", "growth"],
])

export function isCustomerPriorityPage(path: string) {
  const [pathname, search] = path.split("?")
  return (
    pathname.replace(/\/$/, "") === "/manager" &&
    new URLSearchParams(search).get("view") === "priority"
  )
}

/** The priority editor lends its draft to the same conversation used site-wide. */
export function createCustomerPriorityAssistant() {
  let editor: PriorityEditor | null = null
  let owner: symbol | null = null
  let fingerprint = ""
  let history: PriorityAdviceMessage[] = []
  let followup = false
  let controller: AbortController | null = null
  let state: State = {
    editing: false,
    busy: false,
    disabled: true,
    proposal: null,
  }
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }
  const clear = () => {
    controller?.abort()
    controller = null
    history = []
    followup = false
    publish({ busy: false, proposal: null })
  }
  const reset = () => {
    clear()
    editor = null
    owner = null
    fingerprint = ""
    publish({ editing: false, disabled: true })
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    connect(initial: PriorityEditor) {
      reset()
      const token = Symbol("customer-priority-editor")
      owner = token
      editor = initial
      fingerprint = strategyFingerprint(initial.managerId, initial.strategy)
      publish({ editing: true, disabled: initial.disabled })
      return {
        update(next: PriorityEditor) {
          if (owner !== token) return false
          const nextFingerprint = strategyFingerprint(
            next.managerId,
            next.strategy
          )
          if (fingerprint !== nextFingerprint) {
            clear()
            fingerprint = nextFingerprint
          }
          editor = next
          if (state.disabled !== next.disabled)
            publish({ disabled: next.disabled })
          return true
        },
        disconnect() {
          if (owner === token) reset()
        },
      }
    },
    handles(question: string, page?: AskPageContext) {
      if (!editor || !page || !isCustomerPriorityPage(page.path)) return false
      return (
        /策略|指標|權重|優先|均衡|經營目標|維繫|挽回|成長機會|怎麼調|先照顧|先拜訪|久未|下滑/.test(
          question
        ) ||
        ((followup || /營收|毛利|採購頻率|期間|站數|排序/.test(question)) &&
          !/多少|幾[次家筆張個]|總額|有哪些客戶|公司.*規定/.test(question))
      )
    },
    async ask(question: string): Promise<string> {
      if (!editor) return "請先開啟客戶策略，再輸入調整需求。"
      if (editor.disabled) return "請先完成目前的設定或操作，再詢問客戶策略。"
      controller?.abort()
      const request = new AbortController()
      controller = request
      const startingOwner = owner
      const startingFingerprint = fingerprint
      const base = structuredClone(editor.strategy)
      const managerId = editor.managerId
      publish({ busy: true, proposal: null })
      try {
        const answer = await askPriorityAdvice(
          managerId,
          base,
          question,
          history,
          PRESETS.get(question.trim()),
          request.signal
        )
        if (
          request.signal.aborted ||
          owner !== startingOwner ||
          fingerprint !== startingFingerprint
        )
          return "客戶策略已變更或離開頁面，請依目前設定重新詢問。"
        const proposed = answer.strategy
        history = [
          ...history,
          { role: "user" as const, content: question },
          {
            role: "assistant" as const,
            content: JSON.stringify({
              message: answer.message,
              proposed: proposed
                ? {
                    name: proposed.name,
                    days: proposed.days,
                    daily_limit: proposed.daily_limit,
                    metrics: proposed.metrics,
                  }
                : null,
            }).slice(0, 3000),
          },
        ].slice(-8)
        followup = true
        publish({ proposal: proposed ? { answer, base } : null })
        return answer.message
      } catch (error) {
        if (request.signal.aborted)
          return "客戶策略已變更或離開頁面，請依目前設定重新詢問。"
        throw error
      } finally {
        if (controller === request) {
          controller = null
          publish({ busy: false })
        }
      }
    },
    apply() {
      const proposed = state.proposal?.answer.strategy
      if (!editor || editor.disabled || state.busy || !proposed) return
      const current = editor
      const baseFingerprint = fingerprint
      clear()
      current.onUse(
        {
          ...proposed,
          id: current.strategy.id,
          priority_customers: current.strategy.priority_customers,
        },
        baseFingerprint
      )
    },
    dismiss: clear,
    reset,
  }
}

export const customerPriorityAssistant = createCustomerPriorityAssistant()
let account = readUser()?.id
onAuthChange(() => {
  const next = readUser()?.id
  if (account !== next) customerPriorityAssistant.reset()
  account = next
})

import { useState } from "react"

import { ApiError } from "@/api/client"
import { applyProposal, askRoute, optimizeRoute, type RouteProposal, type TodayRoute } from "@/api/route"

// idle：沒在問；asking：等熊熊滾（輸入列換成「熊熊滾想一下…」）；open：對照卡開著。
// stale：套用時行程已經在問完之後改過了（409），卡上改成「用現在的行程重算」
export type ProposalState =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "open"; proposal: RouteProposal; applying: boolean; stale: boolean; error: string | null }

const OFFLINE = "連不上伺服器，請再試一次。"

/**
 * 跟熊熊滾說要怎麼排、「幫我排順一點」、套用（首頁與調整清單共用）。
 * 問的時候出錯（熊熊滾沒設定的 503、用量上限的 429、連不上）放在 error，由輸入列顯示；
 * 套用失敗留在卡上。ask、optimize 回傳有沒有拿到對照卡，輸入列拿到才清空。
 */
export function useProposal({ userId, onApplied }: { userId: string | null; onApplied: (route: TodayRoute) => void }) {
  const [state, setState] = useState<ProposalState>({ status: "idle" })
  const [error, setError] = useState<string | null>(null)

  async function run(send: () => Promise<RouteProposal>) {
    setError(null)
    setState({ status: "asking" })
    try {
      const proposal = await send()
      setState({ status: "open", proposal, applying: false, stale: false, error: null })
      return true
    } catch (reason) {
      setState({ status: "idle" })
      setError(reason instanceof ApiError ? reason.message : OFFLINE)
      return false
    }
  }

  const ask = (question: string, customerId?: string) => run(() => askRoute(question, customerId))
  const optimize = () => run(optimizeRoute)

  async function apply() {
    if (state.status !== "open" || !userId) return
    const { proposal } = state
    setState({ ...state, applying: true, error: null })
    try {
      const route = await applyProposal(userId, proposal.id)
      setState({ status: "idle" })
      onApplied(route)
    } catch (reason) {
      // 409：行程在問完之後改過了；404：提案已經不在（IT 重置了示範業務的行程）。兩種都請業務用現在的行程重算
      const stale = reason instanceof ApiError && (reason.status === 409 || reason.status === 404)
      const message = stale ? null : reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有套用，請再試一次。"
      setState({ status: "open", proposal, applying: false, stale, error: message })
    }
  }

  // 「要選一個」按了其中一家：原句加上那一家再問一次
  function pick(customerId: string) {
    if (state.status === "open" && state.proposal.question) void ask(state.proposal.question, customerId)
  }

  // 「用現在的行程重算」：同一句話再問一次；按鈕觸發的排順路就再排一次
  function retry() {
    if (state.status !== "open") return
    const question = state.proposal.question
    void (question ? ask(question) : optimize())
  }

  const close = () => setState({ status: "idle" })

  return { state, error, ask, optimize, apply, pick, retry, close }
}

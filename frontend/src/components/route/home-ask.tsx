import type { TodayRoute } from "@/api/route"
import { useState } from "react"
import { askSessionFor } from "@/ask/ask-session"
import { openAssistantVoice } from "@/ask/assistant-voice"
import { useCurrentPageContext } from "@/ask/use-page-context"
import { AskBar } from "@/components/route/ask-bar"
import { ProposalSheet } from "@/components/route/proposal-sheet"
import { HOME_LEFT_FIXED } from "@/lib/desktop-layout"
import { useProposal } from "@/lib/use-proposal"
import { cn } from "@/lib/utils"

/**
 * 首頁路線下面固定的「跟熊熊滾說要怎麼排…」（手機在底部分頁膠囊上面，電腦版貼著左欄底部），回來的對照卡從下面滑出來，
 * 按「套用」就把改好的行程交回首頁（onApplied），路線就地更新。
 */
export function HomeAsk({ userId, onApplied }: { userId: string; onApplied: (route: TodayRoute) => void }) {
  const flow = useProposal({ userId, onApplied })
  const { state } = flow
  const asking = askSessionFor(userId)
  const page = useCurrentPageContext()
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [reply, setReply] = useState("")
  const ask = async (question: string) => {
    setTaskBusy(true)
    setTaskError(null)
    setReply("")
    const conversation = asking.conversation
    conversation.addUtterance("user", "typed", question, { page })
    try {
      if (await asking.tasks.handle(question, { conversation, source: "typed", page })) {
        const last = conversation.getSnapshot().filter((entry) => entry.kind === "model").at(-1)
        if (last?.kind === "model") setReply(last.text)
        return true
      }
      return await flow.ask(question)
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "這次未能安排工作，請再試一次。")
      return false
    } finally { setTaskBusy(false) }
  }
  return (
    <>
      <div
        data-assistant-obstacle
        data-route-ask
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md px-2.5",
          // 電腦版沒有底部分頁列：貼著左欄底部
          HOME_LEFT_FIXED,
          "lg:bottom-4"
        )}
      >
        {reply && <p role="status" className="pointer-events-auto mb-2 rounded-xl border bg-background/95 p-2 text-xs">{reply}</p>}
        <AskBar
          className="pointer-events-auto rounded-2xl bg-background/95 backdrop-blur"
          busy={state.status === "asking" || taskBusy}
          error={taskError || flow.error}
          onAsk={ask}
          placeholder="排路線、照上次開單，或繼續剛剛的工作…"
          inputLabel="交辦路線與開單工作"
          maxLength={8000}
          earlier={flow.turns}
          onStartVoice={openAssistantVoice}
        />
      </div>
      {state.status === "open" && (
        <ProposalSheet
          proposal={state.proposal}
          applying={state.applying}
          stale={state.stale}
          error={state.error}
          onApply={() => void flow.apply()}
          onClose={flow.close}
          onPick={flow.pick}
          onRetry={flow.retry}
          placement="home"
        />
      )}
    </>
  )
}

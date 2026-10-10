import type { TodayRoute } from "@/api/route"
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
  return (
    <>
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md px-2.5",
          // 電腦版沒有底部分頁列：貼著左欄底部
          HOME_LEFT_FIXED,
          "lg:bottom-4"
        )}
      >
        <AskBar
          className="pointer-events-auto rounded-2xl bg-background/95 backdrop-blur"
          busy={state.status === "asking"}
          error={flow.error}
          onAsk={flow.ask}
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

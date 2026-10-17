import type { ComponentProps, CSSProperties } from "react"
import { useAssistantSwipe, type AssistantSwipeAction, type AssistantSwipePreview } from "@/ask/use-assistant-swipe"
import { AssistantModeBear } from "@/components/ask/assistant-mode-transition"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import "./assistant-swipe-unlock.css"

/** Keep gesture updates separate from the conversation's render cycle. */
export function AssistantSwipeCard({ onSwipe, swipeEnabled, children, className, ...props }: ComponentProps<typeof Card> & {
  onSwipe: (action: AssistantSwipeAction) => void
  swipeEnabled: boolean
}) {
  const { dragging, preview, ...swipe } = useAssistantSwipe(onSwipe, swipeEnabled)
  return <Card {...props} {...swipe} data-assistant-swipe={dragging ?? undefined} className={cn("relative", className)}>
    {children}
    {preview && <AssistantSwipeUnlock preview={preview} />}
  </Card>
}

export function AssistantSwipeUnlock({ preview }: { preview: AssistantSwipePreview }) {
  const { action, progress, phase, retreating } = preview
  const ghost = action === "ghost"
  const ready = progress >= 1
  return <div className="assistant-swipe-unlock" data-action={action} data-phase={phase} data-retreating={retreating} data-ready={ready} style={{ "--swipe-progress": progress } as CSSProperties}>
    <span className="assistant-swipe-fill" />
    <span className="assistant-swipe-label" role="progressbar" aria-label={ghost ? "滑動開啟 Ghost mode" : "滑動新增對話"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d={ready ? "M9 10V6a4 4 0 0 1 8 0" : "M8 10V6a4 4 0 0 1 8 0v4"} /></svg>
      <span>{phase === "returning" ? "" : ready ? (ghost ? "放開進入 Ghost mode" : "放開新增對話") : (ghost ? "向右滑開啟 Ghost mode" : "向左滑新增對話")}</span>
      <span className="assistant-swipe-arrows" aria-hidden="true">{ghost ? "› ›" : "‹ ‹"}</span>
    </span>
    <div className="assistant-swipe-runner" aria-hidden="true"><div className="assistant-swipe-facing"><div className="assistant-swipe-roll"><AssistantModeBear ghost={ghost} /></div></div></div>
  </div>
}

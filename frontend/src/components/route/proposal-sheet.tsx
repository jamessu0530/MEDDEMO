import { Loader2 } from "lucide-react"

import type { ProposalSide, RouteProposal } from "@/api/route"
import { DriveSource } from "@/components/route/drive-source"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { formatMinutes, proposalMarks, whichQuestion } from "@/lib/itinerary"
import { HOME_LEFT_FIXED } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"

type ProposalSheetProps = {
  proposal: RouteProposal
  applying: boolean
  // 套用時行程已經在問完之後改過了（409）
  stale: boolean
  error: string | null
  onApply: () => void
  onClose: () => void
  // 「要選一個」按了其中一家
  onPick: (customerId: string) => void
  // 「用現在的行程重算」
  onRetry: () => void
  // 電腦版放哪裡：首頁貼著左欄底部（home），調整行程頁對齊中間一欄（column，預設）
  placement?: "column" | "home"
}

/**
 * 熊熊滾回來的卡，從下面滑出來（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈跟熊熊滾說要怎麼排〉）：
 * 提案（「現在 → 改成」對照、規則的代價、會晚到、新增或停用的習慣、做不到的部分，按「套用」才寫進行程）、
 * 排不出來（擋住的規則，沒有套用）、要選一個（每家一顆鈕）、只回答（一段話）。
 */
export function ProposalSheet({ proposal, applying, stale, error, onApply, onClose, onPick, onRetry, placement = "column" }: ProposalSheetProps) {
  const canApply = proposal.kind === "proposal" && proposal.changed && !stale
  return (
    <>
      <button
        type="button"
        aria-label="關掉熊熊滾的提案"
        className="fixed inset-0 z-30 bg-black/20"
        disabled={applying}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="熊熊滾的提案"
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md animate-in px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] duration-200 slide-in-from-bottom-4 motion-reduce:animate-none",
          placement === "home" ? cn(HOME_LEFT_FIXED, "lg:bottom-4 lg:pb-0") : "lg:left-56 lg:max-w-2xl"
        )}
      >
        <div className="max-h-[80svh] overflow-y-auto rounded-2xl border-2 bg-card p-4 shadow-lip">
          {stale ? (
            <Stale onRetry={onRetry} onClose={onClose} />
          ) : (
            <>
              <Body proposal={proposal} onPick={onPick} />
              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
              <div className="mt-4 flex gap-2">
                {canApply ? (
                  <>
                    <Button className="h-11 flex-1" disabled={applying} onClick={onApply}>
                      {applying && <Loader2 className="animate-spin" />}
                      套用
                    </Button>
                    <Button variant="outline" className="h-11 flex-1" disabled={applying} onClick={onClose}>
                      不用了
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className="h-11 flex-1" onClick={onClose}>
                    {proposal.kind === "ask_which" ? "不用了" : "知道了"}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Body({ proposal, onPick }: { proposal: RouteProposal; onPick: (customerId: string) => void }) {
  if (proposal.kind === "answer") {
    return <Said mascot="talk" text={proposal.text ?? ""} />
  }
  if (proposal.kind === "ask_which") {
    return (
      <>
        <Said mascot="think" text={whichQuestion(proposal.candidates.map((c) => c.customer_name))} />
        <div className="mt-3 flex flex-col gap-2">
          {proposal.candidates.map((candidate) => (
            <Button
              key={candidate.customer_id}
              data-candidate={candidate.customer_id}
              variant="outline"
              className="h-11 justify-start px-4 text-sm"
              onClick={() => onPick(candidate.customer_id)}
            >
              {candidate.customer_name}
            </Button>
          ))}
        </div>
      </>
    )
  }
  if (proposal.kind === "conflict") {
    return (
      <>
        <Said mascot="think" text="這幾條規則互相衝突，拿掉其中一條才排得出來" />
        <Lines lines={proposal.conflict} className="text-destructive" />
        <Lines lines={proposal.notes} />
      </>
    )
  }
  const marks =
    proposal.before && proposal.after
      ? proposalMarks(
          proposal.before.stops.map((s) => s.customer_id),
          proposal.after.stops.map((s) => s.customer_id)
        )
      : new Set<string>()
  return (
    <>
      <Said mascot={proposal.changed ? "yay" : "idle"} text={proposal.summary} />
      {proposal.changed && proposal.before && proposal.after && (
        <>
          <div className="mt-3 flex gap-3 rounded-xl bg-muted p-3">
            <Column title="現在" side={proposal.before} marks={new Set()} />
            <Column title="改成" side={proposal.after} marks={marks} />
          </div>
          <p className="mt-1 px-1 text-[0.6875rem] text-muted-foreground">
            路上
            <DriveSource estimated={proposal.estimated} />
          </p>
        </>
      )}
      <Lines lines={proposal.rule_costs} />
      <Lines lines={proposal.late} className="text-destructive" />
      <Lines lines={proposal.habits_added.map((text) => `新增習慣：${text}`)} className="text-success" />
      <Lines lines={proposal.habits_disabled.map((text) => `停用習慣：${text}`)} />
      <Lines lines={proposal.dropped} className="text-warning" />
      <Lines lines={proposal.notes} className="text-muted-foreground" />
    </>
  )
}

function Said({ mascot, text }: { mascot: "talk" | "think" | "yay" | "idle"; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Mascot state={mascot} size={44} bust className="shrink-0" />
      <p className="pt-1 text-sm leading-relaxed font-semibold">{text}</p>
    </div>
  )
}

function Column({ title, side, marks }: { title: string; side: ProposalSide; marks: Set<string> }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <ol className="mt-1 flex flex-col gap-1">
        {side.stops.map((stop, index) => {
          const moved = marks.has(stop.customer_id)
          return (
            <li
              key={stop.customer_id}
              data-moved={moved || undefined}
              className={cn("flex gap-1 text-xs leading-snug", moved && "font-semibold text-primary")}
            >
              <span className="shrink-0 tabular-nums">{index + 1}.</span>
              <span className="min-w-0 break-words">{stop.customer_name}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-1.5 text-[0.6875rem] text-muted-foreground tabular-nums">
        {side.travel_km} 公里 · {formatMinutes(side.travel_minutes)}
      </p>
    </div>
  )
}

function Lines({ lines, className }: { lines: string[]; className?: string }) {
  if (lines.length === 0) return null
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {lines.map((line) => (
        <li key={line} className={cn("text-xs leading-relaxed", className)}>
          {line}
        </li>
      ))}
    </ul>
  )
}

function Stale({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  return (
    <>
      <Said mascot="think" text="行程在你問完之後改過了" />
      <div className="mt-4 flex gap-2">
        <Button className="h-11 flex-1" onClick={onRetry}>
          用現在的行程重算
        </Button>
        <Button variant="outline" className="h-11 flex-1" onClick={onClose}>
          不用了
        </Button>
      </div>
    </>
  )
}

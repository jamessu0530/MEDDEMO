import { useEffect, useRef, useState } from "react"

import {
  askPriorityAdvice,
  type PriorityAdvice,
  type PriorityAdviceMessage,
  type PriorityPreset,
  type PriorityStrategy,
} from "@/api/customer-priority"
import { Mascot } from "@/components/mascot"
import { AskBar } from "@/components/route/ask-bar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { strategyChanges, strategyFingerprint } from "@/lib/customer-priority"

const PRESETS: { id: PriorityPreset; label: string }[] = [
  { id: "balanced", label: "先給我均衡起點" },
  { id: "revenue", label: "維繫高業績客戶" },
  { id: "recovery", label: "挽回業績下滑客戶" },
  { id: "profit", label: "優先淨毛利貢獻" },
  { id: "growth", label: "尋找成長機會" },
]
type Turn = {
  question: string
  answer: PriorityAdvice
  base: PriorityStrategy
  fingerprint: string
  preset?: PriorityPreset
}

function historyOf(turns: Turn[]): PriorityAdviceMessage[] {
  return turns
    .flatMap((turn) => {
      const proposal = turn.answer.strategy
      return [
        { role: "user" as const, content: turn.question },
        {
          role: "assistant" as const,
          content: JSON.stringify({
            message: turn.answer.message,
            proposed: proposal
              ? {
                  name: proposal.name,
                  days: proposal.days,
                  daily_limit: proposal.daily_limit,
                  metrics: proposal.metrics,
                }
              : null,
          }).slice(0, 3000),
        },
      ]
    })
    .slice(-8)
}

export function CustomerPriorityAdvisor({
  managerId,
  strategy,
  disabled,
  onUse,
}: {
  managerId: string
  strategy: PriorityStrategy
  disabled: boolean
  onUse: (strategy: PriorityStrategy, baseFingerprint: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const end = useRef<HTMLDivElement | null>(null)
  const fingerprint = strategyFingerprint(managerId, strategy)

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (open && (turns.length || busy))
      end.current?.scrollIntoView({ block: "nearest" })
  }, [turns, busy, open])

  function changeOpen(value: boolean) {
    if (!value) {
      controller.current?.abort()
      setBusy(false)
    }
    setOpen(value)
  }

  async function ask(question: string, preset?: PriorityPreset) {
    if (busy || disabled) return false
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    setError(null)
    try {
      const answer = await askPriorityAdvice(
        managerId,
        strategy,
        question,
        historyOf(turns),
        preset,
        request.signal
      )
      if (request.signal.aborted) return false
      setTurns((previous) =>
        [
          ...previous,
          {
            question,
            answer,
            base: structuredClone(strategy),
            fingerprint,
            preset,
          },
        ].slice(-4)
      )
      return true
    } catch (reason) {
      if (!request.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "目前連不上，請再試一次。"
        )
      return false
    } finally {
      if (!request.signal.aborted) setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="h-auto gap-2 py-2"
        >
          <Mascot state="hi" size={32} bust />
          不知道怎麼調？問熊熊滾
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="flex max-h-[90dvh] flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>問熊熊滾：怎麼調客戶策略</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
          <div className="rounded-xl bg-primary/5 p-3">
            <p className="text-sm font-medium">還沒有方向？先選一個經營情境</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  size="sm"
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => void ask(preset.label, preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <div
            role="log"
            aria-label="客戶策略詢問紀錄"
            aria-live="polite"
            className="space-y-4"
          >
            {turns.map((turn, index) => {
              const stale = turn.fingerprint !== fingerprint
              const proposed = turn.answer.strategy
              const changes = proposed
                ? strategyChanges(turn.base, proposed)
                : []
              return (
                <div key={index} className="space-y-2">
                  <p className="ml-8 rounded-xl bg-primary/10 p-3 text-sm">
                    {turn.question}
                  </p>
                  <div className="rounded-xl border bg-card p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Mascot state="talk" size={32} bust />
                      <span className="text-sm font-semibold">熊熊滾</span>
                      <span className="text-xs text-muted-foreground">
                        {turn.answer.source === "guide"
                          ? "情境起點"
                          : "AI 建議"}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {turn.answer.message}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {turn.answer.context.date} · 團隊{" "}
                      {turn.answer.context.customers} 家 · 近{" "}
                      {turn.answer.context.days} 天
                      {turn.answer.context.growth_available > 0
                        ? `，${turn.answer.context.growth_available} 家可比較成長，其中 ${turn.answer.context.declining_customers} 家營收下滑。`
                        : "，目前缺少可比較的成長資料。"}
                    </p>
                    {proposed && changes.length > 0 && (
                      <>
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full table-fixed text-left text-xs">
                            <caption className="sr-only">
                              設定調整前後比較
                            </caption>
                            <thead>
                              <tr className="border-b">
                                <th className="w-[28%] pb-2 font-medium">
                                  調整項目
                                </th>
                                <th className="pb-2 font-medium">目前</th>
                                <th className="pb-2 font-medium">建議</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes.map((change) => (
                                <tr
                                  key={change.label}
                                  className="border-b last:border-0"
                                >
                                  <th className="py-2 pr-2 font-normal">
                                    {change.label}
                                  </th>
                                  <td className="py-2 pr-2 break-words text-muted-foreground">
                                    {change.before}
                                  </td>
                                  <td className="py-2 break-words">
                                    {change.after}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            disabled={busy || disabled || stale}
                            onClick={() => {
                              if (stale || busy || disabled) return
                              onUse(proposed, turn.fingerprint)
                              changeOpen(false)
                            }}
                          >
                            帶入設定並預覽
                          </Button>
                          {stale && (
                            <p className="text-xs text-muted-foreground">
                              設定已改，請用目前設定重新詢問。
                            </p>
                          )}
                        </div>
                      </>
                    )}
                    {proposed && changes.length === 0 && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        這份建議與目前設定相同，可以直接預覽排名再判斷。
                      </p>
                    )}
                    {stale && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2"
                        disabled={busy || disabled}
                        onClick={() => void ask(turn.question, turn.preset)}
                      >
                        以目前設定重新建議
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div ref={end} />
        </div>
        <AskBar
          busy={busy}
          error={error}
          onAsk={ask}
          placeholder="說說你想優先照顧哪些客戶…"
          inputLabel="詢問客戶策略"
          maxLength={600}
          className="shrink-0"
        />
      </DialogContent>
    </Dialog>
  )
}

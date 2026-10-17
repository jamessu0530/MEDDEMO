import { useSyncExternalStore } from "react"
import { reportAssistant } from "@/ask/report-assistant"
import { Button } from "@/components/ui/button"
import { PERIODS, VISUALS } from "@/lib/reports"

export function ReportAssistantPreview() {
  const { proposal } = useSyncExternalStore(
    reportAssistant.subscribe,
    reportAssistant.getSnapshot,
    reportAssistant.getSnapshot
  )
  const config = proposal?.config
  if (!config) return null
  return (
    <section
      aria-label="AI 建議的報表調整"
      className="space-y-3 rounded-xl border bg-muted/40 p-3"
    >
      <p className="text-sm font-semibold">AI 建議的調整</p>
      <p className="text-xs text-muted-foreground">
        {config.name} · {PERIODS[config.period]}
      </p>
      {config.cards.length ? (
        <ol className="space-y-1.5">
          {config.cards.map((card) => (
            <li key={card.id} className="flex gap-2 text-xs">
              <span className="min-w-0 flex-1 wrap-break-word">
                {card.title}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {VISUALS[card.visual]}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm">清空全部圖表，保留空白畫布。</p>
      )}
      <div className="flex gap-2">
        <Button className="h-11 flex-1" onClick={reportAssistant.apply}>
          套用調整
        </Button>
        <Button
          variant="outline"
          className="h-11"
          onClick={reportAssistant.dismiss}
        >
          保留原版
        </Button>
      </div>
    </section>
  )
}

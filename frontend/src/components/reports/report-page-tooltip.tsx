import { useEffect, useRef, useState } from "react"
import { getReportData } from "@/api/reports"
import { ReportChart } from "@/components/reports/report-chart"
import {
  reportDataKey,
  reportPages,
  type ReportData,
  type ReportQuery,
  type ReportSelectionPoint,
} from "@/lib/reports"

export function ReportPageTooltip({
  config,
  pageId,
  point,
  onClose,
  onHold,
  onLeave,
}: {
  config: ReportQuery
  pageId: string
  point: ReportSelectionPoint
  onClose: () => void
  onHold: () => void
  onLeave: () => void
}) {
  const [snapshot, setSnapshot] = useState<{
    key: string
    data: ReportData
  } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null
  )
  const filters = [
    ...new Map(
      [...(config.navigation_filters ?? []), ...point.filters].map((filter) => [
        filter.dimension,
        filter,
      ])
    ).values(),
  ]
  const query = {
    ...config,
    navigation_page: pageId,
    navigation_filters: filters,
  }
  const key = reportDataKey(query)
  const queryRef = useRef(query)
  useEffect(() => {
    queryRef.current = query
  })
  const page = reportPages(config).find((item) => item.id === pageId)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      getReportData(queryRef.current, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setSnapshot({ key, data })
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setError({
              key,
              message: err instanceof Error ? err.message : "無法讀取提示頁",
            })
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key]) // The semantic query key includes all filters and card definitions.
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [onClose])
  const data = snapshot?.key === key ? snapshot.data : null
  return (
    <aside
      role="dialog"
      aria-label={`報表提示：${page?.name ?? "提示頁"}`}
      aria-modal="false"
      className="fixed right-3 bottom-20 z-[80] max-h-[65dvh] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border bg-card p-3 shadow-xl"
      onMouseEnter={onHold}
      onMouseLeave={onLeave}
    >
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            {page?.name} · {point.label}
          </p>
          <p className="text-xs text-muted-foreground">
            帶入此資料點條件，依你的權限查詢。
          </p>
        </div>
        <button
          type="button"
          aria-label="關閉報表提示"
          className="min-h-9 px-2 text-sm"
          onClick={onClose}
        >
          關閉
        </button>
      </div>
      {error?.key === key && !data ? (
        <p role="alert" className="text-xs text-destructive">
          {error.message}
        </p>
      ) : !data ? (
        <p className="py-5 text-xs text-muted-foreground">正在載入提示圖表…</p>
      ) : (
        config.cards
          .filter((card) => card.page_id === pageId && !card.hidden)
          .map((card) => {
            const result = data.cards.find((item) => item.id === card.id)
            return result ? (
              <section key={card.id} className="mb-3 rounded border p-2">
                <h3 className="mb-2 text-sm font-semibold">{card.title}</h3>
                <ReportChart card={card} data={result} />
              </section>
            ) : null
          })
      )}
      {data && !config.cards.some((card) => card.page_id === pageId) && (
        <p className="text-xs text-muted-foreground">請在提示頁加入圖表。</p>
      )}
    </aside>
  )
}

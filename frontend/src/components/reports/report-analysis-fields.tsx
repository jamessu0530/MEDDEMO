import {
  reportPages,
  type ReportCard,
  type ReportConfig,
  type ReportFilterOptions,
} from "@/lib/reports"
const CONTROL = "min-h-10 w-full rounded border bg-background px-2 text-xs"
export function ReportAnalysisFields({
  card,
  config,
  options,
  onChange,
}: {
  card: ReportCard
  config: ReportConfig
  options: ReportFilterOptions
  onChange: (patch: Partial<ReportCard>) => void
}) {
  const pages = reportPages(config)
  const enabled =
    ["line", "area", "combo"].includes(card.visual) && !card.legend
  const analytics = card.analytics ?? { trend_line: false, forecast_periods: 0 }
  return (
    <details className="rounded border p-2" open>
      <summary className="min-h-9 cursor-pointer text-xs font-semibold">
        分析與跨頁互動
      </summary>
      <div className="space-y-3">
        <label className="block space-y-1 text-sm">
          跨頁分析目標
          <select
            aria-label="跨頁分析目標"
            className={CONTROL}
            value={card.drillthrough_page ?? ""}
            onChange={(event) =>
              onChange({ drillthrough_page: event.target.value || null })
            }
          >
            <option value="">未設定</option>
            {pages
              .filter((page) => page.id !== card.page_id)
              .map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          滑鼠提示頁
          <select
            aria-label="滑鼠提示頁"
            className={CONTROL}
            value={card.tooltip_page ?? ""}
            onChange={(event) =>
              onChange({ tooltip_page: event.target.value || null })
            }
          >
            <option value="">一般數值提示</option>
            {pages
              .filter((page) => page.id !== card.page_id && page.tooltip)
              .map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!enabled}
            checked={analytics.trend_line}
            onChange={(event) =>
              onChange({
                analytics: { ...analytics, trend_line: event.target.checked },
              })
            }
          />
          線性趨勢線
        </label>
        <label className="block space-y-1 text-sm">
          預測區間數
          <select
            aria-label="預測區間數"
            className={CONTROL}
            disabled={
              !enabled ||
              !["sales", "net_margin", "visits"].includes(card.metric)
            }
            value={analytics.forecast_periods}
            onChange={(event) =>
              onChange({
                analytics: {
                  ...analytics,
                  forecast_periods: Number(event.target.value),
                },
              })
            }
          >
            {[0, 1, 2, 3, 6, 12].map((value) => (
              <option key={value} value={value}>
                {value ? `外推 ${value} 個區間` : "關閉"}
              </option>
            ))}
          </select>
        </label>
        {card.visual === "funnel" && (
          <label className="block space-y-1 text-sm">
            階段順序（每行一個分類編號）
            <textarea
              aria-label="漏斗階段順序"
              className={`${CONTROL} min-h-24 py-2`}
              key={`${card.id}/${(card.stage_order ?? []).join(";")}`}
              defaultValue={(card.stage_order ?? []).join("\n")}
              onBlur={(event) =>
                onChange({
                  stage_order: [
                    ...new Set(
                      event.target.value
                        .split(/\n/)
                        .map((value) => value.trim())
                        .filter(Boolean)
                    ),
                  ].slice(0, 30),
                })
              }
            />
            <span className="block text-xs text-muted-foreground">
              留空沿用排序。
              {card.dimension in options
                ? options[card.dimension as keyof ReportFilterOptions]
                    .map((item) => `${item.key}：${item.label}`)
                    .join("；")
                : "日期可填 YYYY、YYYY-Q1 或 YYYY-MM。"}
            </span>
          </label>
        )}
      </div>
    </details>
  )
}

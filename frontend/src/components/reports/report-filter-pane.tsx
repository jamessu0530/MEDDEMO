import {
  ReportSlicerEditor,
  ReportDateRangeEditor,
} from "@/components/reports/report-filters"
import { reportPeriodRange, setReportSlicer } from "@/lib/report-filters"
import {
  reportPages,
  type ReportConfig,
  type ReportFilterOptions,
  type ReportSlicer,
} from "@/lib/reports"

export function ReportFilterPane({
  config,
  pageId,
  cardId,
  options,
  asOf,
  onChange,
}: {
  config: ReportConfig
  pageId: string
  cardId?: string
  options: ReportFilterOptions
  asOf: string
  onChange: (config: ReportConfig) => void
}) {
  const page = reportPages(config).find((item) => item.id === pageId)!
  const card = config.cards.find((item) => item.id === cardId)
  function update(
    scope: "report" | "page" | "card",
    value: { dimension: ReportSlicer["dimension"]; keys: string[] }
  ) {
    if (scope === "report")
      onChange({
        ...config,
        slicers: setReportSlicer(
          config.slicers ?? [],
          value.dimension,
          value.keys
        ),
      })
    if (scope === "page")
      onChange({
        ...config,
        pages: reportPages(config).map((item) =>
          item.id === pageId
            ? {
                ...item,
                slicers: setReportSlicer(
                  item.slicers ?? [],
                  value.dimension,
                  value.keys
                ),
              }
            : item
        ),
      })
    if (scope === "card" && card)
      onChange({
        ...config,
        cards: config.cards.map((item) =>
          item.id === card.id
            ? {
                ...item,
                slicers: setReportSlicer(
                  item.slicers ?? [],
                  value.dimension,
                  value.keys
                ),
              }
            : item
        ),
      })
  }
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">篩選</h2>
      <ReportDateRangeEditor
        label="報表期間"
        value={config.period === "custom" ? (config.date_range ?? null) : null}
        fallback={reportPeriodRange(
          config.period,
          asOf,
          config.date_range ?? null
        )}
        asOf={asOf}
        onChange={(date_range) =>
          onChange({
            ...config,
            period: date_range ? "custom" : "this_month",
            date_range,
          })
        }
      />
      {(
        [
          ["report", "整份報表", config.slicers ?? []],
          ["page", `分頁：${page.name}`, page.slicers ?? []],
          ...(card
            ? [["card", `圖表：${card.title}`, card.slicers ?? []]]
            : []),
        ] as ["report" | "page" | "card", string, ReportSlicer[]][]
      ).map(([scope, title, slicers]) => (
        <details
          key={scope}
          open={scope === "report"}
          className="rounded border p-2"
        >
          <summary className="min-h-9 cursor-pointer text-xs font-medium">
            {title}
          </summary>
          <ReportSlicerEditor
            options={options}
            slicers={slicers}
            onChange={(dimension, keys) => update(scope, { dimension, keys })}
          />
        </details>
      ))}
    </div>
  )
}

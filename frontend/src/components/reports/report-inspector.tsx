import { useId, useState, type ReactNode } from "react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react"

import { ReportVisualIcon } from "@/components/reports/report-visual-icon"
import { ReportMatrixFields } from "@/components/reports/report-matrix-fields"
import { ReportFormatFields } from "@/components/reports/report-format-fields"
import { ReportLayoutFields } from "@/components/reports/report-layout-fields"
import { mobileReportCards } from "@/lib/report-layout"
import {
  ReportDateRangeEditor,
  ReportFilterChips,
  ReportSlicerEditor,
} from "@/components/reports/report-filters"
import { emptyFilterOptions, setReportSlicer } from "@/lib/report-filters"
import { COMPARISONS } from "@/lib/report-comparison"
import {
  DIMENSIONS,
  DATE_DIMENSIONS,
  METRICS,
  SALES_METRICS,
  NON_ADDITIVE_METRICS,
  PART_WHOLE_VISUALS,
  PERIODS,
  REPORT_COLORS,
  VISUALS,
  isSeriesVisual,
  normalizeCard,
  reportPages,
  validDimensions,
  type OwnerOption,
  type ReportCard,
  type ReportConfig,
  type ReportDimension,
  type ReportMetric,
  type ReportVisual,
  type ReportFilterOptions,
  type ReportDateRange,
  type ReportDateDimension,
  type CardData,
} from "@/lib/reports"
import { cn } from "@/lib/utils"

type ReportInspectorProps = {
  card: ReportCard | null
  data?: CardData
  config: ReportConfig
  owners: OwnerOption[]
  filterOptions?: ReportFilterOptions
  asOf?: string
  dateFallback?: ReportDateRange
  onChange: (patch: Partial<ReportCard>) => void
  onAdd: (visual: ReportVisual) => void
  onDuplicate: () => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  onClose?: () => void
  hideHeading?: boolean
  mobileLayout?: boolean
}

const CONTROL =
  "h-10 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground"
const ACTION =
  "flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-border px-2 text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
const METRIC_KEYS = Object.keys(METRICS) as ReportMetric[]
const VISUAL_KEYS = Object.keys(VISUALS) as ReportVisual[]
const TREND_VISUALS: ReportVisual[] = ["line", "area", "combo"]
const TARGET_VISUALS: ReportVisual[] = [
  "kpi",
  "bar",
  "column",
  "line",
  "area",
  "combo",
]
const LEGEND_VISUALS: ReportVisual[] = [
  "bar",
  "column",
  "line",
  "area",
  "stacked_bar",
  "stacked_column",
  "percent_bar",
  "percent_column",
  "pie",
  "donut",
  "treemap",
  "combo",
]
const OPTIONAL_SERIES: ReportVisual[] = ["bar", "column", "line", "area"]
const TABS = [
  { id: "build", label: "建立圖表" },
  { id: "format", label: "格式" },
  { id: "filters", label: "篩選" },
  { id: "layout", label: "版面" },
] as const
type InspectorTab = (typeof TABS)[number]["id"]

function unavailableReason(
  visual: ReportVisual,
  metric?: ReportMetric
): string | null {
  if (!metric) return null
  if (
    (visual === "combo" || visual === "scatter") &&
    !SALES_METRICS.includes(metric)
  )
    return "此圖表需要兩個不同的交易指標"
  if (
    NON_ADDITIVE_METRICS.includes(metric) &&
    PART_WHOLE_VISUALS.includes(visual)
  )
    return "比率、平均與去重訂單數不能直接相加，請用比較或趨勢圖"
  if (
    TREND_VISUALS.includes(visual) &&
    !validDimensions(metric).includes("month")
  )
    return "此數據是目前快照，無法按日期顯示歷史趨勢"
  return null
}

export function ReportVisualGallery({
  value,
  onSelect,
  metric,
}: {
  value?: ReportVisual
  onSelect: (visual: ReportVisual) => void
  metric?: ReportMetric
}) {
  return (
    <div
      className="grid grid-cols-4 gap-1.5"
      role="group"
      aria-label={value ? "切換視覺效果" : "新增視覺效果"}
    >
      {VISUAL_KEYS.map((visual) => {
        const reason = unavailableReason(visual, metric)
        const selected = value === visual
        return (
          <button
            key={visual}
            type="button"
            title={reason ? `${VISUALS[visual]}：${reason}` : VISUALS[visual]}
            aria-label={
              reason ? `${VISUALS[visual]}，${reason}` : VISUALS[visual]
            }
            aria-pressed={selected}
            disabled={Boolean(reason)}
            onClick={() => onSelect(visual)}
            className={cn(
              "relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md border px-1 py-1.5 text-[0.625rem] leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-35",
              selected
                ? "border-primary bg-primary/8 text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:bg-muted"
            )}
          >
            <ReportVisualIcon visual={visual} className="size-6" />
            <span className="max-w-full text-center break-words">
              {VISUALS[visual]}
            </span>
            {selected && (
              <Check
                className="absolute top-0.5 right-0.5 size-2.5"
                aria-hidden="true"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
  help,
}: {
  label: string
  htmlFor: string
  children: ReactNode
  help?: string
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-foreground"
      >
        {label}
      </label>
      {children}
      {help && (
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        "flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-1 text-xs",
        disabled && "cursor-not-allowed text-muted-foreground"
      )}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
    </label>
  )
}

function TargetInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string
  value: number | null
  disabled: boolean
  onChange: (value: number | null) => void
}) {
  const [field, setField] = useState({
    value,
    text: value === null ? "" : String(value),
  })
  if (field.value !== value)
    setField({ value, text: value === null ? "" : String(value) })
  const amount = Number(field.text)
  const invalid =
    field.text !== "" &&
    (!Number.isFinite(amount) || amount <= 0 || amount > 1e12)
  return (
    <div className="space-y-1.5">
      <input
        id={id}
        type="number"
        min="0"
        max="1000000000000"
        step="any"
        inputMode="decimal"
        placeholder="不設定目標"
        className={CONTROL}
        value={field.text}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => {
          const text = event.target.value
          const next = Number(text)
          const valid = Number.isFinite(next) && next > 0 && next <= 1e12
          const nextValue = text === "" ? null : valid ? next : value
          setField({ value: nextValue, text })
          if (text === "" || valid) onChange(nextValue)
        }}
        onBlur={() => {
          if (invalid)
            setField({ value, text: value === null ? "" : String(value) })
        }}
      />
      {invalid && (
        <p id={`${id}-error`} className="text-[0.6875rem] text-destructive">
          請輸入大於 0、最多一兆的目標值。
        </p>
      )}
    </div>
  )
}

export function ReportInspector({
  card,
  data,
  config,
  owners,
  filterOptions,
  asOf,
  dateFallback,
  onChange,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  onClose,
  hideHeading = false,
  mobileLayout = false,
}: ReportInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("build")
  const id = useId()
  const pages = reportPages(config)
  const pageId = card?.page_id ?? pages[0]?.id ?? "overview"
  const pageCards = config.cards.filter(
    (item) => (item.page_id ?? pages[0]?.id ?? "overview") === pageId
  )
  const orderedCards = mobileLayout
    ? mobileReportCards(pageCards, true)
    : pageCards
  const index = orderedCards.findIndex((item) => item.id === card?.id)
  const dimensions = card ? validDimensions(card.metric) : []
  const options = filterOptions ?? {
    ...emptyFilterOptions(),
    owner: owners.map((owner) => ({ key: owner.id, label: owner.name })),
  }
  const isTrend = card ? TREND_VISUALS.includes(card.visual) : false
  const axisOptions =
    card?.visual === "kpi"
      ? ["none" as const]
      : isTrend
        ? DATE_DIMENSIONS
        : dimensions.filter((dimension) => dimension !== "none")
  const legendOptions = dimensions.filter(
    (dimension) =>
      dimension !== "none" &&
      dimension !== card?.dimension &&
      (card?.visual === "matrix" ||
        !DATE_DIMENSIONS.includes(dimension as ReportDateDimension))
  )

  function changeVisual(visual: ReportVisual) {
    if (!card) {
      onAdd(visual)
      return
    }
    const next = normalizeCard({ ...card, visual })
    onChange({
      visual: next.visual,
      dimension: next.dimension,
      legend: next.legend ?? null,
      secondary_metric: next.secondary_metric ?? null,
    })
  }

  return (
    <div className="flex min-w-0 flex-col text-foreground">
      {!hideHeading && (
        <div className="flex min-h-14 items-center justify-between gap-2 border-b border-border px-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            視覺效果
          </h2>
          {onClose && (
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="關閉視覺效果設定"
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}
      {card ? (
        <>
          {!hideHeading && (
            <div className="px-4 pt-3">
              <p className="truncate text-xs font-medium" title={card.title}>
                {card.title || METRICS[card.metric].label}
              </p>
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                正在編輯所選圖表，變更立即顯示。
              </p>
            </div>
          )}
          <div
            className="mt-3 grid grid-cols-4 border-b border-border px-2"
            role="tablist"
            aria-label="圖表設定"
          >
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                id={`${id}-${item.id}-tab`}
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`${id}-${item.id}-panel`}
                tabIndex={tab === item.id ? 0 : -1}
                onKeyDown={(event) => {
                  if (
                    event.key !== "ArrowLeft" &&
                    event.key !== "ArrowRight" &&
                    event.key !== "Home" &&
                    event.key !== "End"
                  )
                    return
                  event.preventDefault()
                  const current = TABS.findIndex(
                    (candidate) => candidate.id === tab
                  )
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? TABS.length - 1
                        : (current +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            TABS.length) %
                          TABS.length
                  setTab(TABS[next].id)
                  document.getElementById(`${id}-${TABS[next].id}-tab`)?.focus()
                }}
                onClick={() => setTab(item.id)}
                className={cn(
                  "min-h-10 border-b-2 px-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                  tab === item.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            className="space-y-5 p-4"
            id={`${id}-${tab}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-${tab}-tab`}
          >
            {tab === "build" && (
              <>
                <div>
                  <p className="mb-2 text-xs font-medium">圖表類型</p>
                  <ReportVisualGallery
                    value={card.visual}
                    metric={card.metric}
                    onSelect={changeVisual}
                  />
                  {(card.metric === "overdue" ||
                    card.metric === "customers") && (
                    <p className="mt-2 text-[0.6875rem] leading-relaxed text-muted-foreground">
                      逾期帳款與客戶數為目前快照，請使用比較、占比或明細圖表。
                    </p>
                  )}
                </div>
                <div className="space-y-3 border-t border-border pt-4">
                  <h3 className="text-xs font-semibold">資料欄位</h3>
                  <Field
                    label={
                      card.visual === "scatter"
                        ? "X 軸數值"
                        : card.visual === "combo"
                          ? "直條數值"
                          : "值"
                    }
                    htmlFor={`${id}-metric`}
                  >
                    <select
                      id={`${id}-metric`}
                      className={CONTROL}
                      value={card.metric}
                      onChange={(event) =>
                        onChange({
                          metric: event.target.value as ReportMetric,
                          target: null,
                        })
                      }
                    >
                      {METRIC_KEYS.map((metric) => (
                        <option key={metric} value={metric}>
                          {METRICS[metric].label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {METRICS[card.metric].definition && (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {METRICS[card.metric].definition}
                    </p>
                  )}
                  <Field
                    label="月增／年增比較"
                    htmlFor={`${id}-comparison`}
                    help={
                      card.metric === "customers" || card.metric === "overdue"
                        ? "目前快照不產生歷史比較。"
                        : "同區間前移一個月或一年；月底對齊月底。淨毛利率以百分點比較。"
                    }
                  >
                    <select
                      id={`${id}-comparison`}
                      className={CONTROL}
                      value={card.comparison ?? "none"}
                      disabled={
                        card.metric === "customers" || card.metric === "overdue"
                      }
                      onChange={(event) =>
                        onChange({
                          comparison: event.target
                            .value as ReportCard["comparison"],
                        })
                      }
                    >
                      {Object.entries(COMPARISONS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {card.visual === "matrix" && (
                    <ReportMatrixFields card={card} onChange={onChange} />
                  )}
                  {card.visual !== "kpi" && card.visual !== "matrix" && (
                    <Field
                      label={
                        card.visual === "scatter" ? "資料點分組" : "軸 / 分組"
                      }
                      htmlFor={`${id}-dimension`}
                      help={
                        isTrend
                          ? "趨勢圖依年、季或月呈現，保留所選期間內的日期順序。"
                          : undefined
                      }
                    >
                      <select
                        id={`${id}-dimension`}
                        className={CONTROL}
                        value={card.dimension}
                        onChange={(event) =>
                          onChange({
                            dimension: event.target.value as ReportDimension,
                          })
                        }
                      >
                        {axisOptions.map((dimension) => (
                          <option key={dimension} value={dimension}>
                            {DIMENSIONS[dimension]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {card.visual !== "matrix" &&
                    (isSeriesVisual(card.visual) ||
                      OPTIONAL_SERIES.includes(card.visual)) && (
                      <Field label="圖例 / 系列分組" htmlFor={`${id}-legend`}>
                        <select
                          id={`${id}-legend`}
                          className={CONTROL}
                          value={
                            card.legend ??
                            (OPTIONAL_SERIES.includes(card.visual)
                              ? ""
                              : legendOptions[0]) ??
                            ""
                          }
                          onChange={(event) =>
                            onChange({
                              legend: (event.target.value ||
                                null) as ReportDimension | null,
                            })
                          }
                        >
                          {OPTIONAL_SERIES.includes(card.visual) && (
                            <option value="">不分系列</option>
                          )}
                          {legendOptions.map((dimension) => (
                            <option key={dimension} value={dimension}>
                              {DIMENSIONS[dimension]}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  {(card.visual === "combo" || card.visual === "scatter") && (
                    <Field
                      label={
                        card.visual === "scatter" ? "Y 軸數值" : "折線數值"
                      }
                      htmlFor={`${id}-secondary`}
                      help="兩個交易指標使用同一批品項與條件，左右軸分別標示單位。"
                    >
                      <select
                        id={`${id}-secondary`}
                        className={CONTROL}
                        value={
                          card.secondary_metric ??
                          (card.metric === "sales" ? "net_margin" : "sales")
                        }
                        onChange={(event) =>
                          onChange({
                            secondary_metric: event.target
                              .value as ReportMetric,
                          })
                        }
                      >
                        {SALES_METRICS.filter(
                          (metric) => metric !== card.metric
                        ).map((metric) => (
                          <option key={metric} value={metric}>
                            {METRICS[metric].label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
                  <Field label="排序" htmlFor={`${id}-sort`}>
                    <select
                      id={`${id}-sort`}
                      className={CONTROL}
                      value={card.sort ?? "value_desc"}
                      disabled={
                        card.visual === "kpi" ||
                        DATE_DIMENSIONS.includes(
                          card.dimension as ReportDateDimension
                        )
                      }
                      onChange={(event) =>
                        onChange({
                          sort: event.target.value as ReportCard["sort"],
                        })
                      }
                    >
                      <option value="value_desc">數值由大到小</option>
                      <option value="value_asc">數值由小到大</option>
                      <option value="label_asc">名稱順序</option>
                    </select>
                  </Field>
                  <Field
                    label="顯示筆數"
                    htmlFor={`${id}-limit`}
                    help={
                      card.visual === "matrix"
                        ? "矩陣以分頁顯示全部分組，不使用前 N 筆限制。"
                        : undefined
                    }
                  >
                    <select
                      id={`${id}-limit`}
                      className={CONTROL}
                      value={card.limit}
                      disabled={
                        card.visual === "kpi" ||
                        card.visual === "matrix" ||
                        DATE_DIMENSIONS.includes(
                          card.dimension as ReportDateDimension
                        )
                      }
                      onChange={(event) =>
                        onChange({ limit: Number(event.target.value) })
                      }
                    >
                      {[3, 4, 5, 6, 7, 8, 9, 10].map((limit) => (
                        <option key={limit} value={limit}>
                          {limit} 筆
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            )}
            {tab === "format" && (
              <>
                <Field label="圖表標題" htmlFor={`${id}-title`}>
                  <input
                    id={`${id}-title`}
                    className={CONTROL}
                    value={card.title}
                    maxLength={40}
                    onChange={(event) =>
                      onChange({ title: event.target.value })
                    }
                    onBlur={(event) => {
                      const title =
                        event.target.value.trim() || METRICS[card.metric].label
                      if (title !== card.title) onChange({ title })
                    }}
                  />
                </Field>
                <div className="space-y-2">
                  <p className="text-xs font-medium">主色</p>
                  <div
                    className="flex flex-wrap gap-1"
                    role="group"
                    aria-label="圖表配色"
                  >
                    {REPORT_COLORS.map((color, colorIndex) => (
                      <button
                        key={color}
                        type="button"
                        title={`配色 ${colorIndex + 1}：${color}`}
                        aria-label={`配色 ${colorIndex + 1}，${color}`}
                        aria-pressed={
                          (card.color ?? REPORT_COLORS[0]).toLowerCase() ===
                          color.toLowerCase()
                        }
                        onClick={() => onChange({ color })}
                        className={cn(
                          "flex size-10 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                          (card.color ?? REPORT_COLORS[0]).toLowerCase() ===
                            color.toLowerCase()
                            ? "border-primary bg-primary/5"
                            : "border-transparent hover:bg-muted"
                        )}
                      >
                        <span
                          className="flex size-6 items-center justify-center rounded-sm"
                          style={{ backgroundColor: color }}
                        >
                          {(card.color ?? REPORT_COLORS[0]).toLowerCase() ===
                            color.toLowerCase() && (
                            <Check
                              className="size-3.5 text-white"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                  <label
                    className="flex min-h-10 items-center gap-3 text-xs"
                    htmlFor={`${id}-color`}
                  >
                    <input
                      id={`${id}-color`}
                      type="color"
                      value={card.color ?? REPORT_COLORS[0]}
                      onChange={(event) =>
                        onChange({ color: event.target.value })
                      }
                      className="h-10 w-12 rounded-md border border-border bg-background p-1"
                    />
                    <span>
                      自訂顏色{" "}
                      <span className="font-mono text-muted-foreground">
                        {card.color ?? REPORT_COLORS[0]}
                      </span>
                    </span>
                  </label>
                </div>
                <div className="border-y border-border py-2">
                  <Toggle
                    label="顯示資料標籤"
                    checked={card.show_labels ?? true}
                    disabled={
                      card.visual === "kpi" ||
                      card.visual === "table" ||
                      card.visual === "matrix"
                    }
                    onChange={(show_labels) => onChange({ show_labels })}
                  />
                  <Toggle
                    label="顯示圖例"
                    checked={card.show_legend ?? true}
                    disabled={!LEGEND_VISUALS.includes(card.visual)}
                    onChange={(show_legend) => onChange({ show_legend })}
                  />
                </div>
                <Field
                  label={`目標值${METRICS[card.metric].unit === "currency" ? "（元）" : METRICS[card.metric].unit === "percent" ? "（%）" : card.metric === "order_count" ? "（張）" : card.metric === "visits" ? "（次）" : "（家）"}`}
                  htmlFor={`${id}-target`}
                  help={
                    TARGET_VISUALS.includes(card.visual)
                      ? METRICS[card.metric].unit === "percent"
                        ? "留空可移除目標；輸入 50 代表 50%。"
                        : "留空可移除目標；金額請輸入完整元數。"
                      : "此圖表不顯示目標線。"
                  }
                >
                  <TargetInput
                    key={`${card.id}-${card.metric}`}
                    id={`${id}-target`}
                    value={
                      card.target == null
                        ? null
                        : METRICS[card.metric].unit === "percent"
                          ? card.target * 100
                          : card.target
                    }
                    disabled={!TARGET_VISUALS.includes(card.visual)}
                    onChange={(target) =>
                      onChange({
                        target:
                          target == null
                            ? null
                            : METRICS[card.metric].unit === "percent"
                              ? target / 100
                              : target,
                      })
                    }
                  />
                </Field>
                <ReportFormatFields
                  card={card}
                  data={data}
                  onChange={onChange}
                />
                <Field label="所在頁面" htmlFor={`${id}-page`}>
                  <select
                    id={`${id}-page`}
                    className={CONTROL}
                    value={pageId}
                    onChange={(event) =>
                      onChange({ page_id: event.target.value })
                    }
                  >
                    {pages.map((page) => (
                      <option
                        key={page.id}
                        value={page.id}
                        disabled={
                          page.id !== pageId &&
                          config.cards.filter(
                            (item) => (item.page_id ?? pages[0]?.id) === page.id
                          ).length >= 12
                        }
                      >
                        {page.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {tab === "layout" && (
              <ReportLayoutFields
                card={card}
                config={config}
                mobile={mobileLayout}
                onChange={onChange}
              />
            )}
            {tab === "filters" && (
              <>
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold">套用至這個視覺效果</h3>
                  <Field
                    label="接收其他圖表的聯動"
                    htmlFor={`${id}-interaction`}
                    help="固定的報表與單圖篩選仍會生效。醒目提示保留完整範圍並顯示選取部分。"
                  >
                    <select
                      id={`${id}-interaction`}
                      className={CONTROL}
                      value={card.interaction ?? "filter"}
                      onChange={(event) =>
                        onChange({
                          interaction: event.target
                            .value as ReportCard["interaction"],
                        })
                      }
                    >
                      <option value="filter">篩選：只看聯動範圍</option>
                      <option value="highlight">醒目提示：保留完整範圍</option>
                      <option value="none">不受其他圖表影響</option>
                    </select>
                  </Field>
                  <ReportSlicerEditor
                    options={options}
                    slicers={card.slicers}
                    dimensions={dimensions.filter(
                      (dimension) => dimension !== "none"
                    )}
                    onChange={(dimension, keys) =>
                      onChange({
                        slicers: setReportSlicer(
                          card.slicers ?? [],
                          dimension,
                          keys
                        ),
                        filters: (card.filters ?? []).filter(
                          (item) => item.dimension !== dimension
                        ),
                      })
                    }
                  />
                  <ReportFilterChips
                    options={options}
                    filters={card.filters}
                    scope="單圖既有條件"
                    onRemoveFilter={(filter) =>
                      onChange({
                        filters: (card.filters ?? []).filter(
                          (item) =>
                            item.dimension !== filter.dimension ||
                            item.key !== filter.key
                        ),
                      })
                    }
                  />
                  {asOf && dateFallback && (
                    <ReportDateRangeEditor
                      value={card.date_range ?? null}
                      fallback={dateFallback}
                      asOf={asOf}
                      label="單圖日期"
                      allowClear
                      onChange={(date_range) => onChange({ date_range })}
                    />
                  )}
                  {card.filters?.length ||
                  card.slicers?.length ||
                  card.date_range ? (
                    <button
                      type="button"
                      className="min-h-10 text-left text-xs text-primary"
                      onClick={() =>
                        onChange({ filters: [], slicers: [], date_range: null })
                      }
                    >
                      清除此圖表的篩選
                    </button>
                  ) : null}
                  <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                    圖表篩選會與報表篩選同時生效。
                  </p>
                </div>
                <div className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-xs font-semibold">整份報表的篩選</h3>
                  <p className="text-[11px] text-muted-foreground">
                    期間：{PERIODS[config.period]}
                    {config.period === "custom" && config.date_range
                      ? ` · ${config.date_range.start} 至 ${config.date_range.end}`
                      : ""}
                  </p>
                  <ReportFilterChips
                    options={options}
                    scope="報表"
                    slicers={config.slicers}
                    filters={[
                      ...(config.filters ?? []),
                      ...(config.owner_id
                        ? [
                            {
                              dimension: "owner" as const,
                              key: config.owner_id,
                            },
                          ]
                        : []),
                      ...(config.customer_type
                        ? [
                            {
                              dimension: "customer_type" as const,
                              key: config.customer_type,
                            },
                          ]
                        : []),
                    ]}
                  />
                  <ReportFilterChips
                    options={options}
                    scope="目前分頁"
                    slicers={pages.find((page) => page.id === pageId)?.slicers}
                    filters={pages.find((page) => page.id === pageId)?.filters}
                  />
                  {pages.find((page) => page.id === pageId)?.date_range && (
                    <p className="text-[11px] text-muted-foreground">
                      目前分頁另設日期，與報表及單圖日期取交集。
                    </p>
                  )}
                  <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                    整份報表的條件可在畫布上方的篩選列調整。
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
            <button
              type="button"
              className={ACTION}
              disabled={index <= 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="size-3.5" aria-hidden="true" />
              往前排列
            </button>
            <button
              type="button"
              className={ACTION}
              disabled={index < 0 || index >= pageCards.length - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
              往後排列
            </button>
            <button
              type="button"
              className={ACTION}
              disabled={config.cards.length >= 24 || pageCards.length >= 12}
              onClick={onDuplicate}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              複製圖表
            </button>
            <button
              type="button"
              className={cn(ACTION, "text-destructive hover:bg-destructive/5")}
              disabled={config.cards.length <= 1}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              刪除圖表
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            選取畫布上的圖表來編輯，或選擇下方類型新增圖表。
          </p>
          <ReportVisualGallery onSelect={onAdd} />
          <p className="text-[0.6875rem] text-muted-foreground">
            每頁最多 12 個圖表，可在不同頁面安排閱讀重點。
          </p>
        </div>
      )}
    </div>
  )
}

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
import {
  CUSTOMER_TYPES,
  DIMENSIONS,
  METRICS,
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
} from "@/lib/reports"
import { cn } from "@/lib/utils"

type ReportInspectorProps = {
  card: ReportCard | null
  config: ReportConfig
  owners: OwnerOption[]
  onChange: (patch: Partial<ReportCard>) => void
  onAdd: (visual: ReportVisual) => void
  onDuplicate: () => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  onClose?: () => void
  hideHeading?: boolean
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
] as const
type InspectorTab = (typeof TABS)[number]["id"]

function unavailableReason(
  visual: ReportVisual,
  metric?: ReportMetric
): string | null {
  if (!metric) return null
  if (
    (visual === "combo" || visual === "scatter") &&
    metric !== "sales" &&
    metric !== "net_margin"
  )
    return "此圖表需要業績與淨毛利兩個數值"
  if (
    TREND_VISUALS.includes(visual) &&
    !validDimensions(metric).includes("month")
  )
    return "此數據是目前快照，無法按月份顯示趨勢"
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

function filterValue(
  dimension: ReportDimension,
  key: string,
  owners: OwnerOption[]
): string {
  if (dimension === "owner")
    return owners.find((owner) => owner.id === key)?.name ?? key
  if (dimension === "customer_type")
    return CUSTOMER_TYPES[key as keyof typeof CUSTOMER_TYPES] ?? key
  return key
}

export function ReportInspector({
  card,
  config,
  owners,
  onChange,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  onClose,
  hideHeading = false,
}: ReportInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("build")
  const id = useId()
  const pages = reportPages(config)
  const pageId = card?.page_id ?? pages[0]?.id ?? "overview"
  const pageCards = config.cards.filter(
    (item) => (item.page_id ?? pages[0]?.id ?? "overview") === pageId
  )
  const index = pageCards.findIndex((item) => item.id === card?.id)
  const dimensions = card ? validDimensions(card.metric) : []
  const isTrend = card ? TREND_VISUALS.includes(card.visual) : false
  const axisOptions =
    card?.visual === "kpi"
      ? ["none" as const]
      : isTrend
        ? ["month" as const]
        : dimensions.filter((dimension) => dimension !== "none")
  const legendOptions = dimensions.filter(
    (dimension) =>
      dimension !== "none" &&
      dimension !== card?.dimension &&
      (card?.visual === "matrix" || dimension !== "month")
  )
  const otherFilters =
    card?.filters?.filter(
      (filter) =>
        filter.dimension !== "owner" && filter.dimension !== "customer_type"
    ) ?? []

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

  function setFilter(dimension: "owner" | "customer_type", key: string) {
    if (!card) return
    const remaining = (card.filters ?? []).filter(
      (filter) => filter.dimension !== dimension
    )
    onChange({ filters: key ? [...remaining, { dimension, key }] : remaining })
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
            className="mt-3 grid grid-cols-3 border-b border-border px-2"
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
                        onChange({ metric: event.target.value as ReportMetric })
                      }
                    >
                      {METRIC_KEYS.map((metric) => (
                        <option key={metric} value={metric}>
                          {METRICS[metric].label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {card.visual !== "kpi" && (
                    <Field
                      label={
                        card.visual === "matrix"
                          ? "列"
                          : card.visual === "scatter"
                            ? "資料點分組"
                            : "軸 / 分組"
                      }
                      htmlFor={`${id}-dimension`}
                      help={
                        isTrend
                          ? "趨勢圖依月份呈現，會保留所選期間內的所有月份。"
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
                  {(isSeriesVisual(card.visual) ||
                    OPTIONAL_SERIES.includes(card.visual)) && (
                    <Field
                      label={
                        card.visual === "matrix" ? "欄" : "圖例 / 系列分組"
                      }
                      htmlFor={`${id}-legend`}
                    >
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
                      help="搭配業績與淨毛利，比較同一期間的表現。"
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
                        <option
                          value={
                            card.metric === "sales" ? "net_margin" : "sales"
                          }
                        >
                          {
                            METRICS[
                              card.metric === "sales" ? "net_margin" : "sales"
                            ].label
                          }
                        </option>
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
                        card.visual === "kpi" || card.dimension === "month"
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
                  <Field label="顯示筆數" htmlFor={`${id}-limit`}>
                    <select
                      id={`${id}-limit`}
                      className={CONTROL}
                      value={card.limit}
                      disabled={
                        card.visual === "kpi" || card.dimension === "month"
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
                  label={`目標值${METRICS[card.metric].unit === "currency" ? "（元）" : card.metric === "visits" ? "（次）" : "（家）"}`}
                  htmlFor={`${id}-target`}
                  help={
                    TARGET_VISUALS.includes(card.visual)
                      ? "留空可移除目標；金額請輸入完整元數。"
                      : "此圖表不顯示目標線。"
                  }
                >
                  <TargetInput
                    key={card.id}
                    id={`${id}-target`}
                    value={card.target ?? null}
                    disabled={!TARGET_VISUALS.includes(card.visual)}
                    onChange={(target) => onChange({ target })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
                  <Field label="圖表寬度" htmlFor={`${id}-width`}>
                    <select
                      id={`${id}-width`}
                      className={CONTROL}
                      value={card.width ?? "half"}
                      onChange={(event) =>
                        onChange({
                          width: event.target.value as ReportCard["width"],
                        })
                      }
                    >
                      <option value="half">
                        {card.visual === "kpi" ? "指標格" : "半寬"}
                      </option>
                      <option value="full">全寬</option>
                    </select>
                  </Field>
                  <Field label="圖表高度" htmlFor={`${id}-height`}>
                    <select
                      id={`${id}-height`}
                      className={CONTROL}
                      value={card.height ?? "regular"}
                      onChange={(event) =>
                        onChange({
                          height: event.target.value as ReportCard["height"],
                        })
                      }
                    >
                      <option value="compact">緊湊</option>
                      <option value="regular">標準</option>
                      <option value="tall">加高</option>
                    </select>
                  </Field>
                </div>
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
            {tab === "filters" && (
              <>
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold">套用至這個視覺效果</h3>
                  <Field label="業務" htmlFor={`${id}-owner`}>
                    <select
                      id={`${id}-owner`}
                      className={CONTROL}
                      value={
                        card.filters?.find(
                          (filter) => filter.dimension === "owner"
                        )?.key ?? ""
                      }
                      onChange={(event) =>
                        setFilter("owner", event.target.value)
                      }
                    >
                      <option value="">全部可見業務</option>
                      {owners.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="客戶類型" htmlFor={`${id}-type`}>
                    <select
                      id={`${id}-type`}
                      className={CONTROL}
                      value={
                        card.filters?.find(
                          (filter) => filter.dimension === "customer_type"
                        )?.key ?? ""
                      }
                      onChange={(event) =>
                        setFilter("customer_type", event.target.value)
                      }
                    >
                      <option value="">全部類型</option>
                      {Object.entries(CUSTOMER_TYPES).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {otherFilters.length > 0 && (
                    <div className="space-y-1.5 rounded-md bg-muted/40 p-2.5">
                      <p className="text-[0.6875rem] font-medium">
                        其他圖表篩選
                      </p>
                      {otherFilters.map((filter) => (
                        <p
                          key={`${filter.dimension}-${filter.key}`}
                          className="text-[0.6875rem] break-words text-muted-foreground"
                        >
                          {DIMENSIONS[filter.dimension]}：
                          {filterValue(filter.dimension, filter.key, owners)}
                        </p>
                      ))}
                    </div>
                  )}
                  {!!card.filters?.length && (
                    <button
                      type="button"
                      className="min-h-10 text-left text-xs text-primary hover:underline"
                      onClick={() => onChange({ filters: [] })}
                    >
                      清除此圖表的篩選
                    </button>
                  )}
                  <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                    圖表篩選會與報表篩選同時生效。
                  </p>
                </div>
                <div className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-xs font-semibold">整份報表的篩選</h3>
                  <dl className="space-y-2 rounded-md bg-muted/40 p-3 text-[0.6875rem]">
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-muted-foreground">期間</dt>
                      <dd>{PERIODS[config.period]}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-muted-foreground">業務</dt>
                      <dd className="min-w-0 text-right break-words">
                        {config.owner_id
                          ? filterValue("owner", config.owner_id, owners)
                          : "全部可見業務"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-muted-foreground">客戶類型</dt>
                      <dd>
                        {config.customer_type
                          ? CUSTOMER_TYPES[config.customer_type]
                          : "全部類型"}
                      </dd>
                    </div>
                    {config.filters?.map((filter) => (
                      <div
                        key={`${filter.dimension}-${filter.key}`}
                        className="flex items-start justify-between gap-3"
                      >
                        <dt className="shrink-0 text-muted-foreground">
                          {DIMENSIONS[filter.dimension]}
                        </dt>
                        <dd className="min-w-0 text-right break-words">
                          {filterValue(filter.dimension, filter.key, owners)}
                        </dd>
                      </div>
                    ))}
                  </dl>
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

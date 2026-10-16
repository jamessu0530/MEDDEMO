import type { StudioObject, ReportAnalytics } from "@/lib/report-studio"

export type ReportMetric =
  | "sales"
  | "net_margin"
  | "net_margin_rate"
  | "order_count"
  | "avg_order_value"
  | "visits"
  | "overdue"
  | "customers"
export const SALES_METRICS: ReportMetric[] = [
  "sales",
  "net_margin",
  "net_margin_rate",
  "order_count",
  "avg_order_value",
]
export const NON_ADDITIVE_METRICS: ReportMetric[] = [
  "net_margin_rate",
  "order_count",
  "avg_order_value",
]
export const PART_WHOLE_VISUALS: ReportVisual[] = [
  "stacked_bar",
  "stacked_column",
  "percent_bar",
  "percent_column",
  "pie",
  "donut",
  "treemap",
  "waterfall",
  "funnel",
]
export type ReportComparisonMode = "none" | "previous_month" | "previous_year"
export type ReportComparisonValue = {
  previous: number | null
  delta: number | null
  relative_change: number | null
  previous_rows: number
  status:
    | "ok"
    | "no_previous_data"
    | "previous_zero"
    | "previous_undefined"
    | "negative_baseline"
    | "current_undefined"
    | "date_out_of_range"
}
export type ReportComparison = {
  mode: Exclude<ReportComparisonMode, "none">
  start: string | null
  end: string | null
  value: ReportComparisonValue
  note: string
}
export const COMPARISON_LABELS: Record<ReportComparisonMode, string> = {
  none: "不比較",
  previous_month: "前月同區間",
  previous_year: "去年同期",
}
export const COMPARISON_STATUS_LABELS: Record<
  ReportComparisonValue["status"],
  string
> = {
  ok: "可比較",
  no_previous_data: "上期無符合條件資料",
  previous_zero: "上期為零，無法計算成長率",
  previous_undefined: "上期指標無法計算",
  negative_baseline: "上期為負值，僅顯示差額",
  current_undefined: "本期指標無法計算",
  date_out_of_range: "比較日期超出可用範圍",
}
export type ReportDimension =
  | "none"
  | "year"
  | "quarter"
  | "month"
  | "customer"
  | "product"
  | "owner"
  | "customer_type"
export type ReportDateDimension = "year" | "quarter" | "month"
export const DATE_DIMENSIONS: ReportDateDimension[] = [
  "year",
  "quarter",
  "month",
]
export type ReportVisual =
  | "kpi"
  | "bar"
  | "column"
  | "stacked_bar"
  | "stacked_column"
  | "percent_bar"
  | "percent_column"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "treemap"
  | "combo"
  | "scatter"
  | "table"
  | "matrix"
  | "waterfall"
  | "funnel"
  | "map"
export type ReportPeriod =
  "this_month" | "last_month" | "quarter" | "six_months" | "year" | "custom"
export type ReportFilter = {
  dimension: Exclude<ReportDimension, "none">
  key: string
}
export type ReportSlicer = {
  dimension: ReportFilter["dimension"]
  keys: string[]
}
export type ReportDateRange = { start: string; end: string }
export type ReportFilterOption = { key: string; label: string }
export type ReportFilterOptions = Record<
  "owner" | "customer" | "product" | "customer_type",
  ReportFilterOption[]
>
export type ReportSelectionPoint = {
  filters: ReportFilter[]
  label: string
  metric?: ReportMetric | null
}
export type ReportSelectionGroup = {
  source_id: string
  points: ReportSelectionPoint[]
}
export type ReportQuery = ReportConfig & {
  selection_groups?: ReportSelectionGroup[]
  drill_filters?: Record<string, ReportFilter[]>
  matrix_views?: Record<string, ReportMatrixView>
  canvas_selections?: { object_id: string; keys: string[] }[]
  navigation_page?: string | null
  navigation_filters?: ReportFilter[]
}
export type ReportMatrixOptions = {
  rows: ReportFilter["dimension"][]
  columns: ReportFilter["dimension"][]
  metrics: ReportMetric[]
  show_subtotals?: boolean
  show_grand_total?: boolean
  row_expand_depth?: number
  column_expand_depth?: number
}
export type ReportMatrixView = {
  expanded_rows?: ReportFilter[][]
  collapsed_rows?: ReportFilter[][]
  expanded_columns?: ReportFilter[][]
  collapsed_columns?: ReportFilter[][]
  row_expand_depth?: number | null
  column_expand_depth?: number | null
  row_page?: number
  column_page?: number
  row_page_size?: number
  column_page_size?: number
}
export type ReportMatrixNode = {
  id: string
  path: (ReportFilter & { label: string })[]
  label: string
  depth: number
  has_children: boolean
  expanded: boolean
  show_values: boolean
}
export type ReportMatrixCell = {
  row_id: string
  column_id: string
  values: Partial<Record<ReportMetric, number | null>>
  row_count: number
  comparisons: Partial<Record<ReportMetric, ReportComparisonValue>>
}
export type ReportMatrixData = {
  options: ReportMatrixOptions
  rows: ReportMatrixNode[]
  columns: ReportMatrixNode[]
  cells: ReportMatrixCell[]
  totals: Partial<Record<ReportMetric, number | null>>
  format_domains?: Partial<Record<ReportMetric, ReportFormatDomain>>
  row_total: number
  column_total: number
  row_page: number
  column_page: number
  row_page_size: number
  column_page_size: number
  note: string
}
export type ReportPage = {
  id: string
  name: string
  filters?: ReportFilter[]
  slicers?: ReportSlicer[]
  date_range?: ReportDateRange | null
  desktop_layout?: "flow" | "free"
  tooltip?: boolean
}
export type ReportDesktopLayout = { x: number; y: number; w: number; h: number }
export type ReportMobileLayout = {
  order: number
  width: "half" | "full"
  height: number
  hidden: boolean
}
export type ReportCard = {
  id: string
  title: string
  metric: ReportMetric
  dimension: ReportDimension
  visual: ReportVisual
  limit: number
  legend?: ReportDimension | null
  secondary_metric?: ReportMetric | null
  page_id?: string
  width?: "half" | "full"
  height?: "compact" | "regular" | "tall"
  sort?: "value_desc" | "value_asc" | "label_asc"
  color?: string
  show_labels?: boolean
  show_legend?: boolean
  target?: number | null
  filters?: ReportFilter[]
  interaction?: "filter" | "highlight" | "none"
  slicers?: ReportSlicer[]
  date_range?: ReportDateRange | null
  comparison?: ReportComparisonMode
  matrix?: ReportMatrixOptions | null
  format?: ReportFormat
  desktop_layout?: ReportDesktopLayout | null
  mobile_layout?: ReportMobileLayout | null
  layer?: number
  hidden?: boolean
  locked?: boolean
  group_id?: string | null
  drillthrough_page?: string | null
  tooltip_page?: string | null
  analytics?: ReportAnalytics
  stage_order?: string[]
}
export type ReportFormatDomain = {
  minimum: number | null
  maximum: number | null
}
export type ReportNumberFormat = {
  unit?: "auto" | "none" | "thousand" | "ten_thousand" | "million"
  decimals?: number | null
  grouping?: boolean
  show_unit?: boolean
}
export type ReportColorRule = {
  minimum: number | null
  maximum: number | null
  color: string
}
export type ReportConditionalFormat = {
  color_mode?: "none" | "rules" | "gradient"
  color_target?: "background" | "font"
  rules?: ReportColorRule[]
  minimum?: number | null
  maximum?: number | null
  low_color?: string
  high_color?: string
  apply_totals?: boolean
  data_bars?: boolean
  bar_minimum?: number | null
  bar_maximum?: number | null
  positive_color?: string
  negative_color?: string
  show_bar_value?: boolean
}
export type ReportAxisFormat = {
  show_x?: boolean
  show_y?: boolean
  show_secondary?: boolean
  show_grid?: boolean
  show_titles?: boolean
  x_title?: string
  y_title?: string
  secondary_title?: string
}
export type ReportTooltipFormat = {
  show?: boolean
  show_rows?: boolean
  show_share?: boolean
  show_comparison?: boolean
  show_highlight?: boolean
  show_target?: boolean
}
export type ReportFormat = {
  numbers?: Partial<Record<ReportMetric, ReportNumberFormat>>
  conditional?: Partial<Record<ReportMetric, ReportConditionalFormat>>
  series_colors?: {
    dimension: ReportFilter["dimension"]
    key: string
    color: string
  }[]
  metric_colors?: Partial<Record<ReportMetric, string>>
  axes?: ReportAxisFormat
  tooltip?: ReportTooltipFormat
}
export type ReportConfig = {
  name: string
  template: "sales" | "manager"
  period: ReportPeriod
  refresh_seconds?: 0 | 60 | 300 | 900
  owner_id: string | null
  customer_type: "chain" | "independent" | "clinic" | "outlet" | null
  cards: ReportCard[]
  pages?: ReportPage[]
  filters?: ReportFilter[]
  slicers?: ReportSlicer[]
  date_range?: ReportDateRange | null
  objects?: StudioObject[]
}
export type OwnerOption = { id: string; name: string }
export type ReportPoint = {
  lat?: number | null
  lng?: number | null
  key: string
  label: string
  value: number | null
  secondary_value?: number | null
  row_count?: number
  comparison?: ReportComparisonValue | null
}
export type CardData = {
  analysis?: {
    trend: { key: string; label: string; value: number }[]
    forecast: { key: string; label: string; value: number }[]
    note: string
  } | null
  id: string
  total: number | null
  row_count?: number
  comparison?: ReportComparison | null
  matrix?: ReportMatrixData | null
  points: ReportPoint[]
  series?: { key: string; label: string; points: ReportPoint[] }[]
  note: string | null
  highlight?: {
    total: number | null
    comparison?: ReportComparison | null
    matrix?: ReportMatrixData | null
    points: ReportPoint[]
    series?: { key: string; label: string; points: ReportPoint[] }[]
  } | null
}
export type ReportData = {
  as_of: string
  loaded_at?: string
  start: string
  end: string
  scope_label: string
  cards: CardData[]
}

export const METRICS: Record<
  ReportMetric,
  { label: string; unit: "currency" | "count" | "percent"; definition?: string }
> = {
  sales: { label: "業績", unit: "currency" },
  net_margin: { label: "淨毛利", unit: "currency" },
  net_margin_rate: {
    label: "淨毛利率",
    unit: "percent",
    definition:
      "淨毛利加總 ÷ 業績加總，包含上架費及通路獎勵；業績為零時無法計算。",
  },
  order_count: {
    label: "訂單數",
    unit: "count",
    definition:
      "同客戶、同訂單編號計一次；篩選商品後只計有該商品的訂單，分組不能直接相加。",
  },
  avg_order_value: {
    label: "平均客單價",
    unit: "currency",
    definition: "所選品項業績加總 ÷ 去重訂單數；沒有訂單時無法計算。",
  },
  visits: { label: "已確認拜訪", unit: "count" },
  overdue: { label: "逾期帳款", unit: "currency" },
  customers: { label: "客戶數", unit: "count" },
}
export const DIMENSIONS: Record<ReportDimension, string> = {
  none: "總計",
  month: "月份",
  year: "年份",
  quarter: "季度",
  customer: "客戶",
  product: "商品",
  owner: "業務",
  customer_type: "客戶類型",
}
export const VISUALS: Record<ReportVisual, string> = {
  kpi: "數字卡",
  bar: "橫條圖",
  column: "直條圖",
  stacked_bar: "堆疊橫條",
  stacked_column: "堆疊直條",
  percent_bar: "百分比橫條",
  percent_column: "百分比直條",
  line: "折線圖",
  area: "面積圖",
  pie: "圓餅圖",
  donut: "環圈圖",
  treemap: "矩形樹狀圖",
  combo: "折線與直條",
  scatter: "散佈圖",
  table: "彙總表",
  matrix: "矩陣",
  waterfall: "瀑布圖",
  funnel: "漏斗圖",
  map: "客戶地圖",
}
export const REPORT_COLORS = [
  "#6455c7",
  "#2878b5",
  "#259688",
  "#e0a32e",
  "#d76857",
  "#a34fa0",
]
export const VISUAL_GROUPS: { label: string; visuals: ReportVisual[] }[] = [
  {
    label: "比較",
    visuals: [
      "bar",
      "column",
      "stacked_bar",
      "stacked_column",
      "percent_bar",
      "percent_column",
    ],
  },
  { label: "趨勢與關係", visuals: ["line", "area", "combo", "scatter"] },
  { label: "占比", visuals: ["pie", "donut", "treemap"] },
  { label: "階段與地理", visuals: ["waterfall", "funnel", "map"] },
  { label: "摘要與明細", visuals: ["kpi", "table", "matrix"] },
]
export const PERIODS: Record<ReportPeriod, string> = {
  this_month: "本月",
  last_month: "上個月",
  quarter: "本季",
  six_months: "近六個月",
  year: "近一年",
  custom: "自訂日期",
}
export const CUSTOMER_TYPES = {
  outlet: "公開通路（待核對）",
  chain: "連鎖藥局",
  independent: "獨立藥局",
  clinic: "診所",
} as const

export function validDimensions(metric: ReportMetric): ReportDimension[] {
  if (metric === "customers" || metric === "overdue")
    return ["none", "customer", "owner", "customer_type"]
  if (metric === "visits")
    return [
      "none",
      "year",
      "quarter",
      "month",
      "customer",
      "owner",
      "customer_type",
    ]
  return [
    "none",
    "year",
    "quarter",
    "month",
    "customer",
    "product",
    "owner",
    "customer_type",
  ]
}

/** 改一個欄位時，同時修正它不再支援的圖表／分組組合。 */
export function normalizeCard(card: ReportCard): ReportCard {
  const allowed = validDimensions(card.metric)
  const next = { ...card }
  if (next.visual !== "matrix") {
    if (next.matrix !== undefined) next.matrix = null
  } else if (next.matrix) {
    const compatible = (metric: ReportMetric) =>
      SALES_METRICS.includes(next.metric)
        ? SALES_METRICS.includes(metric)
        : metric === next.metric
    const metrics = [
      next.metric,
      ...next.matrix.metrics.filter(
        (metric) => metric !== next.metric && compatible(metric)
      ),
    ].slice(0, 5)
    const rows = [
      ...new Set(
        next.matrix.rows.filter((dimension) => allowed.includes(dimension))
      ),
    ].slice(0, 3)
    if (!rows.length)
      rows.push(
        next.dimension !== "none" && allowed.includes(next.dimension)
          ? next.dimension
          : "customer"
      )
    const columns = [
      ...new Set(
        next.matrix.columns.filter(
          (dimension) =>
            allowed.includes(dimension) && !rows.includes(dimension)
        )
      ),
    ].slice(0, 3)
    next.matrix = { ...next.matrix, rows, columns, metrics }
    next.dimension = rows[0]
    next.legend = columns[0] ?? null
  }
  if (
    ["combo", "scatter"].includes(next.visual) &&
    !SALES_METRICS.includes(next.metric)
  )
    next.visual = "bar"
  if (
    NON_ADDITIVE_METRICS.includes(next.metric) &&
    PART_WHOLE_VISUALS.includes(next.visual)
  )
    next.visual = next.visual.includes("bar") ? "bar" : "column"
  if (["customers", "overdue"].includes(next.metric)) next.comparison = "none"
  if (["line", "area", "combo"].includes(next.visual)) {
    if (allowed.includes("month")) {
      if (!DATE_DIMENSIONS.includes(next.dimension as ReportDateDimension))
        next.dimension = "month"
    } else {
      next.visual = "bar"
      next.dimension = "customer"
    }
  } else
    next.dimension =
      next.visual === "kpi"
        ? "none"
        : next.dimension !== "none" && allowed.includes(next.dimension)
          ? next.dimension
          : "customer"
  if (next.visual === "matrix" && next.matrix) {
    // 明確矩陣可沒有欄分組；第一列／欄已同步至相容欄位。
  } else if (isSeriesVisual(next.visual)) {
    const choices = allowed.filter(
      (dimension) =>
        dimension !== "none" &&
        dimension !== next.dimension &&
        (next.visual === "matrix" ||
          !DATE_DIMENSIONS.includes(dimension as ReportDateDimension))
    )
    if (!next.legend || !choices.includes(next.legend))
      next.legend = choices.includes("customer_type")
        ? "customer_type"
        : choices[0]
  } else if (["bar", "column", "line", "area"].includes(next.visual)) {
    if (
      next.legend &&
      (next.legend === "none" ||
        next.legend === next.dimension ||
        DATE_DIMENSIONS.includes(next.legend as ReportDateDimension) ||
        !allowed.includes(next.legend))
    )
      next.legend = null
  } else if (next.legend !== undefined) next.legend = null
  if (next.visual === "combo" || next.visual === "scatter") {
    if (
      !next.secondary_metric ||
      !SALES_METRICS.includes(next.secondary_metric) ||
      next.secondary_metric === next.metric
    )
      next.secondary_metric = next.metric === "sales" ? "net_margin" : "sales"
  } else if (next.secondary_metric !== undefined) next.secondary_metric = null
  if (next.filters)
    next.filters = next.filters.filter((filter) =>
      allowed.includes(filter.dimension)
    )
  if (next.slicers)
    next.slicers = next.slicers.filter((filter) =>
      allowed.includes(filter.dimension)
    )
  if (next.visual === "map") next.dimension = "customer"
  if (
    next.analytics &&
    (!["line", "area", "combo"].includes(next.visual) || next.legend)
  )
    next.analytics = { trend_line: false, forecast_periods: 0 }
  if (
    next.analytics?.forecast_periods &&
    !["sales", "net_margin", "visits"].includes(next.metric)
  )
    next.analytics = { ...next.analytics, forecast_periods: 0 }
  return next
}

export function isSeriesVisual(visual: ReportVisual) {
  return [
    "stacked_bar",
    "stacked_column",
    "percent_bar",
    "percent_column",
    "matrix",
  ].includes(visual)
}

export function reportMatrixOptions(
  card: ReportCard
): Required<ReportMatrixOptions> {
  return {
    rows: [card.dimension as ReportFilter["dimension"]],
    columns: card.legend && card.legend !== "none" ? [card.legend] : [],
    metrics: [card.metric],
    show_subtotals: true,
    show_grand_total: true,
    row_expand_depth: 1,
    column_expand_depth: 1,
    ...card.matrix,
  }
}

export function validReportSelection(
  card: ReportCard,
  point: ReportSelectionPoint
) {
  const dimensions = point.filters.map((filter) => filter.dimension)
  if (card.visual === "matrix") {
    const options = reportMatrixOptions(card)
    return (
      dimensions.length > 0 &&
      (!point.metric || options.metrics.includes(point.metric)) &&
      dimensions.every((dimension) =>
        [...options.rows, ...options.columns].includes(dimension)
      ) &&
      [options.rows, options.columns].every((axis) => {
        const used = axis.filter((dimension) => dimensions.includes(dimension))
        return used.every((dimension, index) => dimension === axis[index])
      })
    )
  }
  return (
    !point.metric &&
    dimensions.includes(card.dimension as ReportFilter["dimension"]) &&
    dimensions.every((dimension) =>
      [card.dimension, card.legend].includes(dimension)
    )
  )
}
export function reportPages(config: ReportConfig): ReportPage[] {
  return config.pages ?? [{ id: "overview", name: "總覽" }]
}
export function normalizeReportConfig(config: ReportConfig): ReportConfig {
  return {
    ...config,
    refresh_seconds: [0, 60, 300, 900].includes(config.refresh_seconds ?? 0)
      ? (config.refresh_seconds ?? 0)
      : 0,
    pages: reportPages(config),
    filters: config.filters ?? [],
    slicers: config.slicers ?? [],
    date_range: config.date_range ?? null,
    cards: config.cards.map((card) =>
      normalizeCard({
        legend: null,
        secondary_metric: null,
        page_id: "overview",
        width: "half",
        height: "regular",
        sort: "value_desc",
        color: REPORT_COLORS[0],
        show_labels: true,
        show_legend: true,
        target: null,
        filters: [],
        interaction: "filter",
        slicers: [],
        date_range: null,
        comparison: "none",
        ...card,
      })
    ),
  }
}

export function formatReportExactValue(
  value: number | null,
  metric: ReportMetric
): string {
  if (value == null) return "無法計算"
  if (METRICS[metric].unit === "percent")
    return `${(value * 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}%`
  const unit =
    METRICS[metric].unit === "currency"
      ? "元"
      : metric === "visits"
        ? "次"
        : metric === "order_count"
          ? "張"
          : "家"
  return `${value.toLocaleString("zh-TW", { maximumFractionDigits: METRICS[metric].unit === "currency" ? 2 : 0 })} ${unit}`
}

export function emptyMetricValue(metric: ReportMetric): number | null {
  return metric === "net_margin_rate" || metric === "avg_order_value" ? null : 0
}

export function formatReportValue(
  value: number | null,
  metric: ReportMetric
): string {
  if (value == null || METRICS[metric].unit === "percent")
    return formatReportExactValue(value, metric)
  if (METRICS[metric].unit === "count")
    return formatReportExactValue(value, metric)
  const absolute = Math.abs(value)
  const sign = value < 0 ? "−" : ""
  if (absolute >= 10000)
    return `${sign}${(absolute / 10000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 萬`
  return `${sign}${absolute.toLocaleString("zh-TW", { maximumFractionDigits: metric === "avg_order_value" ? 2 : 0 })} 元`
}

/** 只在資料需求改變時重抓：更名、換圖表、卡片排序不影響查詢。 */
function slicerDataKey(slicers: ReportSlicer[]) {
  return slicers
    .map((slicer) => ({
      dimension: slicer.dimension,
      keys: [...slicer.keys].sort(),
    }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension))
}

export function reportDataKey(config: ReportQuery): string {
  return JSON.stringify({
    canvas_selections: config.canvas_selections ?? [],
    canvas_slicers: (config.objects ?? [])
      .filter((object) => object.slicer)
      .map((object) => ({
        id: object.id,
        page_id: object.page_id,
        slicer: object.slicer,
      })),
    navigation_page: config.navigation_page ?? null,
    navigation_filters: config.navigation_filters ?? [],
    period: config.period,
    date_range: config.period === "custom" ? config.date_range : null,
    owner_id: config.owner_id,
    customer_type: config.customer_type,
    drill_filters: Object.entries(config.drill_filters ?? {})
      .map(([id, filters]) => [
        id,
        [...filters].sort((a, b) => a.dimension.localeCompare(b.dimension)),
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
    matrix_views: Object.entries(config.matrix_views ?? {}).sort(([a], [b]) =>
      a.localeCompare(b)
    ),
    selection_groups: [...(config.selection_groups ?? [])]
      .map((group) => ({
        source_id: group.source_id,
        points: group.points.map((point) => selectionPointKey(point)).sort(),
      }))
      .sort((a, b) => a.source_id.localeCompare(b.source_id)),
    filters: [...(config.filters ?? [])].sort((a, b) =>
      a.dimension.localeCompare(b.dimension)
    ),
    slicers: slicerDataKey(config.slicers ?? []),
    cards: config.cards
      .map(
        ({
          id,
          metric,
          visual,
          dimension,
          limit,
          legend,
          secondary_metric,
          sort,
          filters,
          interaction,
          page_id,
          slicers,
          date_range,
          comparison,
          matrix,
          analytics,
          stage_order,
        }) => ({
          id,
          metric,
          matrix_visual: visual === "matrix",
          map_visual: visual === "map",
          waterfall_visual: visual === "waterfall",
          navigation_target:
            !!config.navigation_page &&
            config.navigation_page === (page_id ?? "overview"),
          canvas_context: (config.objects ?? [])
            .filter(
              (object) =>
                object.slicer &&
                (object.slicer.pages.length
                  ? object.slicer.pages
                  : [object.page_id]
                ).includes(page_id ?? "overview") &&
                (!object.slicer.cards.length ||
                  object.slicer.cards.includes(id))
            )
            .map((object) => object.id)
            .sort(),
          funnel_visual: visual === "funnel",
          analytics: analytics ?? { trend_line: false, forecast_periods: 0 },
          stage_order: visual === "funnel" ? (stage_order ?? []) : [],
          dimension,
          limit,
          legend: legend ?? null,
          secondary_metric: secondary_metric ?? null,
          sort: sort ?? "value_desc",
          filters: [...(filters ?? [])].sort((a, b) =>
            a.dimension.localeCompare(b.dimension)
          ),
          interaction: interaction ?? "filter",
          slicers: slicerDataKey(slicers ?? []),
          date_range: date_range ?? null,
          comparison: comparison ?? "none",
          matrix: matrix ?? null,
          page_filters: [
            ...(reportPages(config).find(
              (page) => page.id === (page_id ?? "overview")
            )?.filters ?? []),
          ].sort((a, b) => a.dimension.localeCompare(b.dimension)),
          page_slicers: slicerDataKey(
            reportPages(config).find(
              (page) => page.id === (page_id ?? "overview")
            )?.slicers ?? []
          ),
          page_date_range:
            reportPages(config).find(
              (page) => page.id === (page_id ?? "overview")
            )?.date_range ?? null,
        })
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  })
}

export function selectionPointKey(point: ReportSelectionPoint): string {
  return JSON.stringify(
    [...point.filters]
      .map(({ dimension, key }) => [dimension, key])
      .sort(([a], [b]) => a.localeCompare(b))
  )
}

/** 同一圖選取聯集，不同圖交集；再次點同一資料點即取消。 */
export function toggleReportSelection(
  groups: ReportSelectionGroup[],
  sourceId: string,
  point: ReportSelectionPoint,
  multiple: boolean
): ReportSelectionGroup[] {
  if (
    point.filters.some((filter) => ["other", "__other__"].includes(filter.key))
  )
    return groups
  const current = groups.find((group) => group.source_id === sourceId)
  const key = selectionPointKey(point)
  const exists = current?.points.some((item) => selectionPointKey(item) === key)
  if (!exists && multiple && (current?.points.length ?? 0) >= 30) return groups
  const points = exists
    ? (current?.points ?? []).filter((item) => selectionPointKey(item) !== key)
    : multiple
      ? [...(current?.points ?? []), point]
      : [point]
  const others = groups.filter((group) => group.source_id !== sourceId)
  return points.length ? [...others, { source_id: sourceId, points }] : others
}

export function pruneReportSelections(
  groups: ReportSelectionGroup[],
  config: ReportConfig
): ReportSelectionGroup[] {
  return groups.flatMap((group) => {
    const card = config.cards.find((item) => item.id === group.source_id)
    if (!card || card.dimension === "none") return []
    const points = group.points.filter((point) =>
      validReportSelection(card, point)
    )
    return points.length ? [{ ...group, points }] : []
  })
}

export function moveReportCard(
  config: ReportConfig,
  id: string,
  offset: -1 | 1
): ReportConfig {
  const selected = config.cards.find((card) => card.id === id)
  const pageCards = config.cards.filter(
    (card) => (card.page_id ?? "overview") === (selected?.page_id ?? "overview")
  )
  const pageIndex = pageCards.findIndex((card) => card.id === id)
  const other = pageCards[pageIndex + offset]
  if (!selected || !other) return config
  const index = config.cards.indexOf(selected)
  const next = config.cards.indexOf(other)
  const cards = [...config.cards]
  ;[cards[index], cards[next]] = [cards[next], cards[index]]
  return { ...config, cards }
}

export function reorderReportPage(
  config: ReportConfig,
  activeId: string,
  overId: string
): ReportConfig {
  const active = config.cards.find((card) => card.id === activeId)
  const over = config.cards.find((card) => card.id === overId)
  if (
    !active ||
    !over ||
    (active.page_id ?? "overview") !== (over.page_id ?? "overview")
  )
    return config
  const page = active.page_id ?? "overview"
  const cards = config.cards.filter(
    (card) => (card.page_id ?? "overview") === page
  )
  const from = cards.indexOf(active)
  const to = cards.indexOf(over)
  cards.splice(from, 1)
  cards.splice(to, 0, active)
  let index = 0
  return {
    ...config,
    cards: config.cards.map((card) =>
      (card.page_id ?? "overview") === page ? cards[index++] : card
    ),
  }
}

/** 匯出目前畫面上的聚合資料；文字欄避免被試算表當成公式執行。 */
export function reportCsv(card: ReportCard, data: CardData): string {
  const cell = (value: string | number | null) => {
    const text =
      value == null
        ? ""
        : typeof value === "number"
          ? String(value)
          : /^[\s]*[=+\-@]/.test(value)
            ? `'${value}`
            : value
    return `"${text.replaceAll('"', '""')}"`
  }
  if (card.visual === "matrix" && data.matrix) {
    const matrix = data.matrix
    const options = reportMatrixOptions(card)
    const root = {
      id: "[]",
      path: [],
      label: "總計",
      depth: 0,
      has_children: false,
      expanded: false,
      show_values: true,
    }
    const columns = [
      ...matrix.columns,
      ...(options.show_grand_total || !matrix.columns.length ? [root] : []),
    ]
    const rows = [...matrix.rows, ...(options.show_grand_total ? [root] : [])]
    const index = new Map(
      matrix.cells.map((entry) => [`${entry.row_id}|${entry.column_id}`, entry])
    )
    const output: (string | number | null)[][] = [
      [
        "列階層",
        "指標",
        ...columns.map((column) =>
          column.path.length
            ? column.path.map((entry) => entry.label).join(" / ") +
              (column.expanded ? " 小計" : "")
            : "總計"
        ),
      ],
    ]
    for (const row of rows)
      for (const metric of options.metrics)
        output.push([
          row.path.length
            ? row.path.map((entry) => entry.label).join(" / ") +
              (row.has_children && row.show_values ? " 小計" : "")
            : "總計",
          METRICS[metric].label +
            (METRICS[metric].unit === "percent" ? "（%）" : ""),
          ...columns.map((column) => {
            if (!row.show_values || !column.show_values) return null
            const value =
              index.get(`${row.id}|${column.id}`)?.values[metric] ??
              emptyMetricValue(metric)
            return value != null && METRICS[metric].unit === "percent"
              ? value * 100
              : value
          }),
        ])
    return "\uFEFF" + output.map((row) => row.map(cell).join(",")).join("\r\n")
  }
  const series = data.series ?? []
  const metricHeader = (metric: ReportMetric) =>
    `${METRICS[metric].label}${METRICS[metric].unit === "percent" ? "（%）" : ""}`
  const numericValue = (
    value: number | null | undefined,
    metric: ReportMetric
  ) =>
    value == null
      ? null
      : METRICS[metric].unit === "percent"
        ? value * 100
        : value
  const headers = [
    DIMENSIONS[card.dimension],
    metricHeader(card.metric),
    ...(card.secondary_metric ? [metricHeader(card.secondary_metric)] : []),
    ...series.map((item) => item.label),
    ...(data.comparison
      ? [
          `${COMPARISON_LABELS[data.comparison.mode]}指標`,
          card.metric === "net_margin_rate" ? "差異（百分點）" : "差額",
          "變動率（%）",
          "比較狀態",
        ]
      : []),
  ]
  const points: ReportPoint[] =
    card.visual === "kpi"
      ? [
          {
            key: "total",
            label: card.title,
            value: data.total,
            comparison: data.comparison?.value,
          },
        ]
      : data.points
  const rows = points.map((point) => [
    point.label,
    numericValue(point.value, card.metric),
    ...(card.secondary_metric
      ? [numericValue(point.secondary_value, card.secondary_metric)]
      : []),
    ...series.map((item) =>
      numericValue(
        item.points.find((entry) => entry.key === point.key)?.value ??
          emptyMetricValue(card.metric),
        card.metric
      )
    ),
    ...(data.comparison
      ? [
          numericValue(point.comparison?.previous, card.metric),
          numericValue(point.comparison?.delta, card.metric),
          point.comparison?.relative_change == null
            ? null
            : point.comparison.relative_change * 100,
          point.comparison
            ? COMPARISON_STATUS_LABELS[point.comparison.status]
            : "無比較資料",
        ]
      : []),
  ])
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")
  )
}

export function chartSelection(
  card: ReportCard,
  point: ReportPoint,
  series?: { key: string; label: string }
): ReportSelectionPoint {
  const filters: ReportFilter[] =
    card.dimension === "none"
      ? []
      : [{ dimension: card.dimension, key: point.key }]
  if (
    series &&
    card.legend &&
    card.legend !== "none" &&
    series.key !== "__other__"
  )
    filters.push({ dimension: card.legend, key: series.key })
  return {
    filters,
    label: (series && card.legend
      ? `${point.label} / ${series.label}`
      : point.label
    ).slice(0, 300),
  }
}

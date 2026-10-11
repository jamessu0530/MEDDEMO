export type ReportMetric =
  "sales" | "net_margin" | "visits" | "overdue" | "customers"
export type ReportDimension =
  "none" | "month" | "customer" | "product" | "owner" | "customer_type"
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
export type ReportPeriod =
  "this_month" | "last_month" | "quarter" | "six_months" | "year"
export type ReportFilter = {
  dimension: Exclude<ReportDimension, "none">
  key: string
}
export type ReportPage = { id: string; name: string }
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
}
export type ReportConfig = {
  name: string
  template: "sales" | "manager"
  period: ReportPeriod
  owner_id: string | null
  customer_type: "chain" | "independent" | "clinic" | null
  cards: ReportCard[]
  pages?: ReportPage[]
  filters?: ReportFilter[]
}
export type OwnerOption = { id: string; name: string }
export type ReportPoint = {
  key: string
  label: string
  value: number
  secondary_value?: number | null
}
export type CardData = {
  id: string
  total: number
  points: ReportPoint[]
  series?: { key: string; label: string; points: ReportPoint[] }[]
  note: string | null
}
export type ReportData = {
  as_of: string
  start: string
  end: string
  scope_label: string
  cards: CardData[]
}

export const METRICS: Record<
  ReportMetric,
  { label: string; unit: "currency" | "count" }
> = {
  sales: { label: "業績", unit: "currency" },
  net_margin: { label: "淨毛利", unit: "currency" },
  visits: { label: "已確認拜訪", unit: "count" },
  overdue: { label: "逾期帳款", unit: "currency" },
  customers: { label: "客戶數", unit: "count" },
}
export const DIMENSIONS: Record<ReportDimension, string> = {
  none: "總計",
  month: "月份",
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
  table: "明細表",
  matrix: "矩陣",
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
  { label: "摘要與明細", visuals: ["kpi", "table", "matrix"] },
]
export const PERIODS: Record<ReportPeriod, string> = {
  this_month: "本月",
  last_month: "上個月",
  quarter: "本季",
  six_months: "近六個月",
  year: "近一年",
}
export const CUSTOMER_TYPES = {
  chain: "連鎖藥局",
  independent: "獨立藥局",
  clinic: "診所",
} as const

export function validDimensions(metric: ReportMetric): ReportDimension[] {
  if (metric === "customers" || metric === "overdue")
    return ["none", "customer", "owner", "customer_type"]
  if (metric === "visits")
    return ["none", "month", "customer", "owner", "customer_type"]
  return ["none", "month", "customer", "product", "owner", "customer_type"]
}

/** 改一個欄位時，同時修正它不再支援的圖表／分組組合。 */
export function normalizeCard(card: ReportCard): ReportCard {
  const allowed = validDimensions(card.metric)
  const next = { ...card }
  if (
    ["combo", "scatter"].includes(next.visual) &&
    !["sales", "net_margin"].includes(next.metric)
  )
    next.visual = "bar"
  if (["line", "area", "combo"].includes(next.visual)) {
    if (allowed.includes("month")) next.dimension = "month"
    else {
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
  if (isSeriesVisual(next.visual)) {
    const choices = allowed.filter(
      (dimension) =>
        dimension !== "none" &&
        dimension !== next.dimension &&
        (next.visual === "matrix" || dimension !== "month")
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
        next.legend === "month" ||
        !allowed.includes(next.legend))
    )
      next.legend = null
  } else if (next.legend !== undefined) next.legend = null
  if (next.visual === "combo" || next.visual === "scatter")
    next.secondary_metric = next.metric === "sales" ? "net_margin" : "sales"
  else if (next.secondary_metric !== undefined) next.secondary_metric = null
  if (next.filters)
    next.filters = next.filters.filter((filter) =>
      allowed.includes(filter.dimension)
    )
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
export function reportPages(config: ReportConfig): ReportPage[] {
  return config.pages ?? [{ id: "overview", name: "總覽" }]
}
export function normalizeReportConfig(config: ReportConfig): ReportConfig {
  return {
    ...config,
    pages: reportPages(config),
    filters: config.filters ?? [],
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
        ...card,
      })
    ),
  }
}

export function formatReportValue(value: number, metric: ReportMetric): string {
  if (METRICS[metric].unit === "count")
    return `${value.toLocaleString("zh-TW")} ${metric === "visits" ? "次" : "家"}`
  const absolute = Math.abs(value)
  const sign = value < 0 ? "−" : ""
  if (absolute >= 10000)
    return `${sign}${(absolute / 10000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 萬`
  return `${sign}${absolute.toLocaleString("zh-TW", { maximumFractionDigits: 0 })} 元`
}

/** 只在資料需求改變時重抓：更名、換圖表、卡片排序不影響查詢。 */
export function reportDataKey(config: ReportConfig): string {
  return JSON.stringify({
    period: config.period,
    owner_id: config.owner_id,
    customer_type: config.customer_type,
    filters: [...(config.filters ?? [])].sort((a, b) =>
      a.dimension.localeCompare(b.dimension)
    ),
    cards: config.cards
      .map(
        ({
          id,
          metric,
          dimension,
          limit,
          legend,
          secondary_metric,
          sort,
          filters,
        }) => ({
          id,
          metric,
          dimension,
          limit,
          legend: legend ?? null,
          secondary_metric: secondary_metric ?? null,
          sort: sort ?? "value_desc",
          filters: [...(filters ?? [])].sort((a, b) =>
            a.dimension.localeCompare(b.dimension)
          ),
        })
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
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
  const cell = (value: string | number) => {
    const text =
      typeof value === "number"
        ? String(value)
        : /^[\s]*[=+\-@]/.test(value)
          ? `'${value}`
          : value
    return `"${text.replaceAll('"', '""')}"`
  }
  const series = data.series ?? []
  const headers = [
    DIMENSIONS[card.dimension],
    METRICS[card.metric].label,
    ...(card.secondary_metric ? [METRICS[card.secondary_metric].label] : []),
    ...series.map((item) => item.label),
  ]
  const points =
    card.visual === "kpi"
      ? [{ key: "total", label: card.title, value: data.total }]
      : data.points
  const rows = points.map((point) => [
    point.label,
    point.value,
    ...(card.secondary_metric ? [point.secondary_value ?? 0] : []),
    ...series.map(
      (item) => item.points.find((entry) => entry.key === point.key)?.value ?? 0
    ),
  ])
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")
  )
}

import type {
  DataAnalysis,
  DataChart,
  DataColumn,
  DataRecipe,
  DataSource,
} from "@/api/report-datasets"

export const DATA_KINDS = {
  text: "文字",
  number: "數值",
  date: "日期",
  boolean: "是／否",
} as const
export const DATA_VISUALS = {
  bar: "橫條圖",
  column: "直條圖",
  line: "折線圖",
  pie: "圓餅圖",
  table: "彙總表",
  kpi: "數字卡",
} as const
export const DATA_AGGREGATIONS = {
  sum: "加總",
  avg: "平均",
  min: "最小值",
  max: "最大值",
  count: "資料列數",
  distinct: "欄位去重計數",
} as const

export function defaultDataChart(columns: DataColumn[]): DataChart {
  const value = columns.find((column) => column.kind === "number")?.id ?? null
  const group = columns.find((column) => column.kind !== "number") ?? columns[0]
  return {
    id: `chart-${crypto.randomUUID().slice(0, 12)}`,
    title: value
      ? `${columns.find((c) => c.id === value)?.name}分析`
      : "資料筆數分析",
    visual: "bar",
    group_by: group?.id ?? null,
    value,
    aggregation: value ? "sum" : "count",
    date_grain: "day",
    sort: "value_desc",
    limit: 10,
    filters: [],
  }
}

export function suggestedDataRecipe(
  recipe: DataRecipe,
  analysis: DataAnalysis
): DataRecipe {
  return {
    ...recipe,
    columns: recipe.columns.map((column) => {
      const suggestion = analysis.columns.find((item) => item.id === column.id)
      return suggestion
        ? { ...column, name: suggestion.name, kind: suggestion.kind }
        : column
    }),
  }
}

export function dataDirty(
  source: DataSource,
  recipe: DataRecipe,
  name: string
) {
  return (
    name !== source.name ||
    JSON.stringify(source.recipe) !== JSON.stringify(recipe)
  )
}

export function chartCompatible(chart: DataChart, columns: DataColumn[]) {
  const ids = new Set(columns.map((column) => column.id))
  return (
    (!chart.group_by || ids.has(chart.group_by)) &&
    (!chart.value || ids.has(chart.value)) &&
    chart.filters.every((filter) => ids.has(filter.column)) &&
    (!["sum", "avg", "min", "max"].includes(chart.aggregation) ||
      columns.some(
        (column) => column.id === chart.value && column.kind === "number"
      ))
  )
}

export function dataValue(value: unknown) {
  return value === null || value === undefined
    ? "—"
    : typeof value === "number"
      ? value.toLocaleString("zh-TW", { maximumFractionDigits: 6 })
      : String(value)
}

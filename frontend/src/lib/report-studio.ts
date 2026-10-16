import { desktopReportRects } from "@/lib/report-layout"
import {
  normalizeCard,
  validDimensions,
  validReportSelection,
  type ReportCard,
  type ReportConfig,
  type ReportDimension,
  type ReportMetric,
  type ReportMobileLayout,
  type ReportDesktopLayout,
  type ReportFilter,
  type ReportSelectionGroup,
  type ReportMatrixView,
} from "@/lib/reports"
import type { DataChart, DataColumn, DataSource } from "@/api/report-datasets"
import { defaultDataChart } from "@/lib/report-datasets"
import type { ReportDrills } from "@/lib/report-drill"

export type StudioAction = {
  kind: "page" | "bookmark" | "back" | "reset" | "toggle"
  target: string | null
}
export type StudioObject = {
  id: string
  page_id: string
  kind: "text" | "image" | "shape" | "button" | "slicer" | "dataset"
  title: string
  text: string
  image: string
  shape: "rectangle" | "ellipse" | "line"
  color: string
  background: string
  font_size: number
  desktop_layout: ReportDesktopLayout
  mobile_layout: ReportMobileLayout | null
  layer: number
  hidden: boolean
  locked: boolean
  group_id: string | null
  action: StudioAction | null
  slicer: {
    dimension: Exclude<ReportDimension, "none">
    style: "list" | "dropdown"
    sync_group: string | null
    pages: string[]
    cards: string[]
  } | null
  dataset_id: string | null
  dataset_chart: DataChart | null
}
export type ReportAnalytics = { trend_line: boolean; forecast_periods: number }
export type StudioSelections = Record<string, string[]>
export type StudioExploration = {
  selections: ReportSelectionGroup[]
  drills: ReportDrills
  matrix_views: Record<string, ReportMatrixView>
  canvas_values: StudioSelections
  hidden: Record<string, boolean>
  navigation_page: string | null
  navigation_filters: ReportFilter[]
}
export type StudioField =
  | { kind: "metric"; key: ReportMetric }
  | { kind: "dimension"; key: Exclude<ReportDimension, "none"> }
  | { kind: "dataset"; dataset_id: string; column: DataColumn }
export type FieldRole =
  "value" | "group" | "legend" | "secondary" | "row" | "column"
export const FIELD_MIME = "application/x-meddemo-report-field"

export function readStudioField(raw: string): StudioField | null {
  try {
    const value = JSON.parse(raw) as StudioField
    if (
      value.kind === "metric" &&
      [
        "sales",
        "net_margin",
        "net_margin_rate",
        "order_count",
        "avg_order_value",
        "visits",
        "overdue",
        "customers",
      ].includes(value.key)
    )
      return value
    if (
      value.kind === "dimension" &&
      [
        "year",
        "quarter",
        "month",
        "customer",
        "product",
        "owner",
        "customer_type",
      ].includes(value.key)
    )
      return value
    if (
      value.kind === "dataset" &&
      typeof value.dataset_id === "string" &&
      /^c[1-9][0-9]{0,2}$/.test(value.column.id) &&
      ["number", "text", "date", "boolean"].includes(value.column.kind)
    )
      return value
  } catch {
    /* 外部拖放資料不是報表欄位。 */
  }
  return null
}

export function assignReportField(
  card: ReportCard,
  field: StudioField,
  role: FieldRole
): ReportCard {
  if (field.kind === "dataset")
    throw new Error("匯入欄位請放到同一份匯入資料的圖表。")
  if ((role === "value" || role === "secondary") && field.kind !== "metric")
    throw new Error("數值區需要指標欄位。")
  if (!["value", "secondary"].includes(role) && field.kind !== "dimension")
    throw new Error("分組區需要分類或日期欄位。")
  if (field.kind === "metric") {
    if (role === "secondary" && !["combo", "scatter"].includes(card.visual))
      throw new Error("第二指標適用於組合圖與散佈圖。")
    return normalizeCard({
      ...card,
      ...(role === "secondary"
        ? { secondary_metric: field.key }
        : { metric: field.key, target: null }),
    })
  }
  if (!validDimensions(card.metric).includes(field.key))
    throw new Error("這個資料來源無法使用此分組。")
  if (role === "row" || role === "column") {
    const matrix = card.matrix ?? {
      rows: [card.dimension === "none" ? "customer" : card.dimension],
      columns: [],
      metrics: [card.metric],
    }
    const key = role === "row" ? "rows" : "columns"
    if ([...matrix.rows, ...matrix.columns].includes(field.key))
      throw new Error("矩陣的列與欄不能重複使用同一欄位。")
    if (matrix[key].length >= 3) throw new Error("每個矩陣軸最多三層。")
    const next = { ...matrix, [key]: [...matrix[key], field.key] }
    return normalizeCard({
      ...card,
      visual: "matrix",
      matrix: next,
      dimension: next.rows[0],
      legend: next.columns[0] ?? null,
    })
  }
  if (role === "legend" && field.key === card.dimension)
    throw new Error("圖例與主分組需要不同欄位。")
  return normalizeCard({
    ...card,
    ...(role === "legend"
      ? { legend: field.key }
      : {
          dimension: field.key,
          visual: card.visual === "kpi" ? "bar" : card.visual,
        }),
  })
}

export function createStudioObject(
  kind: StudioObject["kind"],
  pageId: string,
  count = 0
): StudioObject {
  const labels = {
    text: "文字方塊",
    image: "圖片",
    shape: "形狀",
    button: "操作按鈕",
    slicer: "畫布切片器",
    dataset: "匯入資料圖表",
  }
  return {
    id: `object-${crypto.randomUUID()}`,
    page_id: pageId,
    kind,
    title: labels[kind],
    text:
      kind === "text" ? "輸入報表說明" : kind === "button" ? "前往分析頁" : "",
    image: "",
    shape: "rectangle",
    color: "#6455c7",
    background: "#ffffff",
    font_size: 18,
    desktop_layout: {
      x: (count % 3) * 8,
      y: Math.floor(count / 3) * 10,
      w: 8,
      h: 10,
    },
    mobile_layout: null,
    layer: count + 1,
    hidden: false,
    locked: false,
    group_id: null,
    action: kind === "button" ? { kind: "page", target: pageId } : null,
    slicer:
      kind === "slicer"
        ? {
            dimension: "customer",
            style: "list",
            sync_group: null,
            pages: [],
            cards: [],
          }
        : null,
    dataset_id: null,
    dataset_chart: null,
  }
}

export function createDatasetObject(
  source: DataSource,
  pageId: string,
  field?: StudioField
): StudioObject {
  const object = createStudioObject("dataset", pageId)
  const chart = defaultDataChart(source.columns)
  if (field?.kind === "dataset") {
    if (field.column.kind === "number") {
      chart.value = field.column.id
      chart.aggregation = "sum"
    } else chart.group_by = field.column.id
  }
  return {
    ...object,
    title: source.name,
    dataset_id: source.id,
    dataset_chart: chart,
    desktop_layout: { x: 0, y: 0, w: 12, h: 16 },
  }
}

/** 版面引擎共用位置與尺寸；代理卡片只在瀏覽器存在，不送給資料查詢。 */
export function studioLayoutConfig(config: ReportConfig): ReportConfig {
  return {
    ...config,
    cards: [
      ...config.cards,
      ...(config.objects ?? []).map((object): ReportCard => ({
        id: object.id,
        title: object.title.slice(0, 40),
        metric: "sales",
        dimension: "none",
        visual: "kpi",
        limit: 5,
        page_id: object.page_id,
        desktop_layout: object.desktop_layout,
        mobile_layout: object.mobile_layout,
        layer: object.layer,
        hidden: object.hidden,
        locked: object.locked,
        group_id: object.group_id,
        width: "full",
        height: "regular",
      })),
    ],
  }
}

export function commitStudioLayout(
  config: ReportConfig,
  next: ReportConfig
): ReportConfig {
  const ids = new Set(config.cards.map((card) => card.id))
  const proxies = new Map(next.cards.map((card) => [card.id, card]))
  return {
    ...config,
    pages: next.pages,
    cards: next.cards
      .filter((card) => ids.has(card.id))
      .map((card) => {
        const original = config.cards.find((item) => item.id === card.id)!
        return {
          ...card,
          hidden: original.hidden,
          ...(original.locked
            ? {
                desktop_layout: original.desktop_layout,
                mobile_layout: original.mobile_layout,
              }
            : {}),
        }
      }),
    objects: (config.objects ?? []).map((object) => {
      const proxy = proxies.get(object.id)
      return proxy && !object.locked
        ? {
            ...object,
            desktop_layout: proxy.desktop_layout ?? object.desktop_layout,
            mobile_layout: proxy.mobile_layout ?? null,
          }
        : object
    }),
  }
}

export function setStudioProperties(
  config: ReportConfig,
  ids: string[],
  patch: {
    hidden?: boolean
    locked?: boolean
    layer?: number
    group_id?: string | null
  }
): ReportConfig {
  const chosen = new Set(ids)
  return {
    ...config,
    cards: config.cards.map((card) =>
      chosen.has(card.id) ? { ...card, ...patch } : card
    ),
    objects: (config.objects ?? []).map((object) =>
      chosen.has(object.id) ? { ...object, ...patch } : object
    ),
  }
}

export function canvasQuerySelections(
  config: ReportConfig,
  values: StudioSelections
) {
  return (config.objects ?? [])
    .filter((object) => object.slicer && values[object.id]?.length)
    .map((object) => ({ object_id: object.id, keys: values[object.id] }))
}

export function updateCanvasSelection(
  config: ReportConfig,
  values: StudioSelections,
  id: string,
  keys: string[]
): StudioSelections {
  const source = config.objects?.find((object) => object.id === id)
  const group = source?.slicer?.sync_group
  const members = group
    ? (config.objects ?? [])
        .filter((object) => object.slicer?.sync_group === group)
        .map((object) => object.id)
    : [id]
  return {
    ...values,
    ...Object.fromEntries(members.map((member) => [member, keys])),
  }
}

export function pruneStudioReferences(config: ReportConfig): ReportConfig {
  const pageIds = new Set(
    (config.pages ?? [{ id: "overview" }]).map((page) => page.id)
  )
  const firstPage = [...pageIds][0]
  const cardIds = new Set(config.cards.map((card) => card.id))
  const allIds = new Set([
    ...cardIds,
    ...(config.objects ?? []).map((object) => object.id),
  ])
  return {
    ...config,
    cards: config.cards.map((card) => ({
      ...card,
      drillthrough_page:
        card.drillthrough_page && pageIds.has(card.drillthrough_page)
          ? card.drillthrough_page
          : null,
      tooltip_page:
        card.tooltip_page && pageIds.has(card.tooltip_page)
          ? card.tooltip_page
          : null,
    })),
    objects: (config.objects ?? []).map((object) => ({
      ...object,
      page_id: pageIds.has(object.page_id) ? object.page_id : firstPage,
      slicer: object.slicer
        ? {
            ...object.slicer,
            pages: object.slicer.pages.filter((id) => pageIds.has(id)),
            cards: object.slicer.cards.filter((id) => cardIds.has(id)),
          }
        : null,
      action:
        object.action?.kind === "page" &&
        !pageIds.has(object.action.target ?? "")
          ? { kind: "page", target: firstPage }
          : object.action?.kind === "toggle" &&
              !allIds.has(object.action.target ?? "")
            ? { kind: "reset", target: null }
            : object.action,
    })),
  }
}

/** 已刪除圖表、變動後的欄位與組織調動不應讓舊書籤破壞目前查詢。 */
export function safeStudioExploration(
  config: ReportConfig,
  state: StudioExploration,
  ownerIds: string[]
): StudioExploration {
  const owners = new Set(ownerIds),
    cards = new Map(config.cards.map((card) => [card.id, card])),
    objects = new Map(
      (config.objects ?? []).map((object) => [object.id, object])
    ),
    pages = new Set(
      (config.pages ?? [{ id: "overview" }]).map((page) => page.id)
    )
  const safeFilters = (filters: ReportFilter[]) =>
    filters.filter(
      (filter) => filter.dimension !== "owner" || owners.has(filter.key)
    )
  const drills = Object.fromEntries(
    Object.entries(state.drills).filter(([id, drill]) => {
      const card = cards.get(id)
      return (
        card &&
        card.visual !== "matrix" &&
        ["year", "quarter", "month"].includes(card.dimension) &&
        drill.steps.every(
          (step) =>
            safeFilters(step.point.filters).length ===
              step.point.filters.length &&
            step.point.filters.every((filter) =>
              ["year", "quarter", "month", card.legend].includes(
                filter.dimension
              )
            )
        )
      )
    })
  )
  const selections = state.selections
    .filter((group) => cards.has(group.source_id))
    .map((group) => {
      const card = cards.get(group.source_id)!,
        explored = {
          ...card,
          dimension: drills[card.id]?.dimension ?? card.dimension,
        }
      return {
        ...group,
        points: group.points.filter(
          (point) =>
            safeFilters(point.filters).length === point.filters.length &&
            validReportSelection(explored, point)
        ),
      }
    })
    .filter((group) => group.points.length)
  const matrixViews = Object.fromEntries(
    Object.entries(state.matrix_views)
      .filter(([id]) => cards.get(id)?.visual === "matrix")
      .map(([id, view]) => {
        const card = cards.get(id)!,
          rows = card.matrix?.rows ?? [card.dimension],
          columns = card.matrix?.columns ?? (card.legend ? [card.legend] : [])
        const paths = (
          values: ReportFilter[][] | undefined,
          axis: (ReportDimension | null)[]
        ) =>
          (values ?? []).filter(
            (path) =>
              path.length > 0 &&
              path.length <= axis.length &&
              path.every((filter, index) => filter.dimension === axis[index]) &&
              safeFilters(path).length === path.length
          )
        return [
          id,
          {
            ...view,
            expanded_rows: paths(view.expanded_rows, rows),
            collapsed_rows: paths(view.collapsed_rows, rows),
            expanded_columns: paths(view.expanded_columns, columns),
            collapsed_columns: paths(view.collapsed_columns, columns),
          },
        ]
      })
  )
  return {
    selections,
    drills,
    matrix_views: matrixViews,
    canvas_values: Object.fromEntries(
      Object.entries(state.canvas_values)
        .filter(([id]) => objects.get(id)?.slicer)
        .map(([id, keys]) => [
          id,
          objects.get(id)?.slicer?.dimension === "owner"
            ? keys.filter((key) => owners.has(key))
            : keys,
        ])
    ),
    hidden: Object.fromEntries(
      Object.entries(state.hidden).filter(
        ([id]) => cards.has(id) || objects.has(id)
      )
    ),
    navigation_page:
      state.navigation_page && pages.has(state.navigation_page)
        ? state.navigation_page
        : null,
    navigation_filters:
      state.navigation_page && pages.has(state.navigation_page)
        ? safeFilters(state.navigation_filters)
        : [],
  }
}

export function placeStudioObject(
  config: ReportConfig,
  object: StudioObject
): StudioObject {
  const occupied = Object.values(
    desktopReportRects(
      studioLayoutConfig(config).cards.filter(
        (card) => (card.page_id ?? "overview") === object.page_id
      )
    )
  )
  const { w, h } = object.desktop_layout
  let position = {
    x: 0,
    y: Math.min(400, Math.max(0, ...occupied.map((rect) => rect.y + rect.h))),
  }
  search: for (let y = 0; y <= 400; y++)
    for (let x = 0; x <= 24 - w; x++) {
      if (
        occupied.every(
          (rect) =>
            !(
              x < rect.x + rect.w &&
              x + w > rect.x &&
              y < rect.y + rect.h &&
              y + h > rect.y
            )
        )
      ) {
        position = { x, y }
        break search
      }
    }
  return {
    ...object,
    desktop_layout: { ...object.desktop_layout, ...position },
    layer: Math.min(
      999,
      1 +
        Math.max(
          0,
          ...config.cards.map((card) => card.layer ?? 0),
          ...(config.objects ?? []).map((item) => item.layer)
        )
    ),
  }
}

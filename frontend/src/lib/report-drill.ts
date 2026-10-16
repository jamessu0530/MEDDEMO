import {
  DATE_DIMENSIONS,
  type ReportCard,
  type ReportConfig,
  type ReportDateDimension,
  type ReportFilter,
  type ReportQuery,
  type ReportSelectionGroup,
  type ReportSelectionPoint,
} from "@/lib/reports"

export type ReportDrillState = {
  dimension: ReportDateDimension
  steps: { dimension: ReportDateDimension; point: ReportSelectionPoint }[]
}
export type ReportDrills = Record<string, ReportDrillState>
export type ReportPointAction = "filter" | "details" | "drill" | "page" | "tooltip"

export function isDateDimension(value: string): value is ReportDateDimension {
  return DATE_DIMENSIONS.includes(value as ReportDateDimension)
}

export function canExploreDates(card: ReportCard) {
  return isDateDimension(card.dimension) && card.visual !== "matrix"
}

export function nextDateDimension(dimension: string) {
  if (dimension === "year") return "quarter"
  if (dimension === "quarter") return "month"
  return null
}

export function resolveReportPointAction(
  card: ReportCard,
  action: ReportPointAction = "filter"
): ReportPointAction {
  return action === "drill" &&
    (!canExploreDates(card) || !nextDateDimension(card.dimension))
    ? "details"
    : action
}

export function drillDown(
  card: ReportCard,
  state: ReportDrillState | undefined,
  point: ReportSelectionPoint
): ReportDrillState | null {
  const dimension = state?.dimension ?? card.dimension
  const next = nextDateDimension(dimension)
  if (
    !canExploreDates(card) ||
    !next ||
    !isDateDimension(dimension) ||
    !point.filters.some((item) => item.dimension === dimension)
  )
    return null
  return {
    dimension: next,
    steps: [...(state?.steps ?? []), { dimension, point }],
  }
}

export function drillUp(state: ReportDrillState): ReportDrillState {
  const previous = state.steps.at(-1)
  return previous
    ? { dimension: previous.dimension, steps: state.steps.slice(0, -1) }
    : state
}

export function drillReset(state: ReportDrillState): ReportDrillState {
  return { dimension: state.steps[0]?.dimension ?? state.dimension, steps: [] }
}

/** 探索狀態只加入查詢；原始報表設定保持可儲存且不受影響。 */
export function reportExploreQuery(
  config: ReportConfig,
  drills: ReportDrills,
  selections: ReportSelectionGroup[]
): ReportQuery {
  const drill_filters: Record<string, ReportFilter[]> = {}
  const cards = config.cards.map((card) => {
    const state = drills[card.id]
    if (!state || !canExploreDates(card)) return card
    const filters = new Map<ReportFilter["dimension"], ReportFilter>()
    for (const step of state.steps)
      for (const item of step.point.filters) filters.set(item.dimension, item)
    if (filters.size) drill_filters[card.id] = [...filters.values()]
    return { ...card, dimension: state.dimension }
  })
  return { ...config, cards, selection_groups: selections, drill_filters }
}

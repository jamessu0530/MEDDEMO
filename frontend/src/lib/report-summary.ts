import { DATE_DIMENSIONS, type ReportCard } from "@/lib/reports"

/** Combine compatible, automatically laid out sales cards for phone reading only. */
export function reportSummaryPair(cards: ReportCard[]) {
  // Explicit phone layouts are the user's document; never rearrange them.
  if (cards.some((card) => card.mobile_layout)) return null
  const visible = cards.filter((card) => !card.hidden)
  const total = visible.find(
    (card) =>
      card.visual === "kpi" &&
      card.metric === "sales" &&
      card.dimension === "none"
  )
  if (!total) return null
  const scope = (card: ReportCard) =>
    JSON.stringify({
      filters: card.filters ?? [],
      slicers: card.slicers ?? [],
      date_range: card.date_range ?? null,
    })
  const trend = visible.find(
    (card) =>
      card.metric === total.metric &&
      (card.visual === "line" || card.visual === "area") &&
      DATE_DIMENSIONS.some((dimension) => dimension === card.dimension) &&
      !card.legend &&
      scope(card) === scope(total)
  )
  return trend ? { totalId: total.id, trendId: trend.id } : null
}

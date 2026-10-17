import type { ReportConfig, ReportData, ReportQuery } from "@/lib/reports"

export function visibleReportCardIds(
  config: ReportConfig,
  pageId: string,
  visibility: Record<string, boolean>,
  editing: boolean
) {
  return config.cards
    .filter(
      (card) =>
        (card.page_id ?? "overview") === pageId &&
        (editing || !(visibility[card.id] ?? card.hidden))
    )
    .map((card) => card.id)
}

type FetchReport = (
  query: ReportQuery,
  signal: AbortSignal
) => Promise<ReportData>

/** Keep all filter sources in the query; request only the cards being viewed.
 * At most two requests run together, and each completed batch can render immediately. */
export async function loadReportProgressively(
  query: ReportQuery,
  fetchReport: FetchReport,
  signal: AbortSignal,
  onProgress: (data: ReportData, complete: boolean) => void
): Promise<ReportData> {
  const selected = query.cards.filter(
    (card) =>
      !query.requested_card_ids || query.requested_card_ids.includes(card.id)
  )
  const kpis = selected.filter((card) => card.visual === "kpi")
  const batches = [
    ...(kpis.length ? [kpis.map((card) => card.id)] : []),
    ...selected
      .filter((card) => card.visual !== "kpi")
      .map((card) => [card.id]),
  ]
  // Empty pages still need the report date and scope, without querying any cards.
  if (!batches.length) batches.push([])
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  let next = 0
  let completed = 0
  let result: ReportData | undefined
  const cards = new Map<string, ReportData["cards"][number]>()
  async function worker() {
    while (next < batches.length) {
      controller.signal.throwIfAborted()
      const ids = batches[next++]
      const data = await fetchReport(
        { ...query, requested_card_ids: ids },
        controller.signal
      )
      controller.signal.throwIfAborted()
      if (
        result &&
        ["as_of", "start", "end", "scope_label"].some(
          (key) =>
            result![key as keyof ReportData] !== data[key as keyof ReportData]
        )
      )
        throw new Error("資料基準已變更，請重新整理報表")
      if (
        data.cards.length !== ids.length ||
        ids.some((id) => !data.cards.some((card) => card.id === id))
      )
        throw new Error("圖表資料不完整，請重新整理報表")
      for (const card of data.cards) cards.set(card.id, card)
      result = {
        ...data,
        cards: selected.flatMap((card) => cards.get(card.id) ?? []),
      }
      onProgress(result, ++completed === batches.length)
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(2, batches.length) }, worker)
    )
    return result!
  } catch (error) {
    controller.abort()
    throw error
  } finally {
    signal.removeEventListener("abort", abort)
  }
}

import {
  reportPages,
  type ReportCard,
  type ReportConfig,
  type ReportDesktopLayout,
  type ReportMobileLayout,
} from "@/lib/reports"

export const REPORT_COLUMNS = 24
export const REPORT_ROW = 24
export type DesktopRects = Record<string, ReportDesktopLayout>
export type ReportAlignment =
  "left" | "center" | "right" | "top" | "middle" | "bottom"

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n))
const rounded = (n: number, snap: boolean) =>
  Math.round(n * (snap ? 1 : 10)) / (snap ? 1 : 10)

export function validDesktopRect(rect: ReportDesktopLayout) {
  return (
    Object.values(rect).every(Number.isFinite) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.y <= 400 &&
    rect.w >= 4 &&
    rect.w <= 24 &&
    rect.h >= 8 &&
    rect.h <= 60 &&
    rect.x + rect.w <= 24.000001
  )
}

export function defaultMobileLayout(
  card: ReportCard,
  index: number
): ReportMobileLayout {
  return {
    order: index,
    width: card.visual === "kpi" && card.width !== "full" ? "half" : "full",
    height:
      card.height === "tall"
        ? 28
        : card.height === "compact"
          ? card.visual === "kpi"
            ? 9
            : 16
          : card.visual === "kpi"
            ? 14
            : 22,
    hidden: false,
    ...card.mobile_layout,
  }
}

export function mobileReportCards(cards: ReportCard[], includeHidden = false) {
  return cards
    .map((card, index) => ({
      card,
      index,
      layout: defaultMobileLayout(card, index),
    }))
    .filter(({ layout }) => includeHidden || !layout.hidden)
    .sort((a, b) => a.layout.order - b.layout.order || a.index - b.index)
    .map(({ card }) => card)
}

export function defaultDesktopSize(card: ReportCard, kpis: number) {
  const w =
    card.width === "full"
      ? 24
      : card.visual === "kpi"
        ? kpis <= 2
          ? 12
          : kpis === 3
            ? 8
            : 6
        : 12
  const h =
    card.height === "tall"
      ? 28
      : card.visual === "matrix"
        ? 26
        : card.visual === "kpi"
          ? card.comparison && card.comparison !== "none"
            ? 16
            : 10
          : card.height === "compact"
            ? 16
            : 22
  return { w, h }
}

function overlaps(a: ReportDesktopLayout, b: ReportDesktopLayout) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  )
}

/** 舊格線只在使用者切換自由版面時物化；缺少位置的新圖放入第一個空位。 */
export function desktopReportRects(
  cards: ReportCard[],
  reset = false
): DesktopRects {
  const result: DesktopRects = {}
  if (!reset)
    for (const card of cards) {
      if (card.desktop_layout && validDesktopRect(card.desktop_layout))
        result[card.id] = { ...card.desktop_layout }
    }
  const kpis = cards.filter((card) => card.visual === "kpi").length
  for (const card of cards) {
    if (result[card.id]) continue
    const size = defaultDesktopSize(card, kpis)
    let found: ReportDesktopLayout | null = null
    for (let y = 0; y <= 400 && !found; y++)
      for (let x = 0; x <= 24 - size.w; x++) {
        const rect = { x, y, ...size }
        if (Object.values(result).every((other) => !overlaps(rect, other))) {
          found = rect
          break
        }
      }
    result[card.id] = found ?? { x: 0, y: 400, ...size }
  }
  return result
}

export function setDesktopReportRects(
  config: ReportConfig,
  pageId: string,
  patches: DesktopRects,
  reset = false
): ReportConfig {
  const pageCards = config.cards.filter(
    (card) => (card.page_id ?? "overview") === pageId
  )
  const rects = { ...desktopReportRects(pageCards, reset), ...patches }
  return {
    ...config,
    pages: reportPages(config).map((page) =>
      page.id === pageId ? { ...page, desktop_layout: "free" } : page
    ),
    cards: config.cards.map((card) =>
      rects[card.id] ? { ...card, desktop_layout: rects[card.id] } : card
    ),
  }
}

export function setMobileReportLayout(
  config: ReportConfig,
  id: string,
  patch: Partial<ReportMobileLayout>
): ReportConfig {
  const card = config.cards.find((card) => card.id === id)
  if (!card) return config
  const pageCards = config.cards.filter(
    (item) => (item.page_id ?? "overview") === (card.page_id ?? "overview")
  )
  return {
    ...config,
    cards: config.cards.map((item) =>
      pageCards.includes(item)
        ? {
            ...item,
            mobile_layout: {
              ...defaultMobileLayout(item, pageCards.indexOf(item)),
              ...(item.id === id ? patch : {}),
            },
          }
        : item
    ),
  }
}

/** 只寫手機順序；桌機的陣列順序、位置及尺寸保持原值。 */
export function reorderMobileReport(
  config: ReportConfig,
  activeId: string,
  overId: string
): ReportConfig {
  const active = config.cards.find((card) => card.id === activeId)
  if (!active) return config
  const cards = config.cards.filter(
    (card) => (card.page_id ?? "overview") === (active.page_id ?? "overview")
  )
  const ordered = mobileReportCards(cards, true)
  const from = ordered.findIndex((card) => card.id === activeId)
  const to = ordered.findIndex((card) => card.id === overId)
  if (from < 0 || to < 0 || from === to) return config
  ordered.splice(to, 0, ...ordered.splice(from, 1))
  const order = new Map(ordered.map((card, index) => [card.id, index]))
  return {
    ...config,
    cards: config.cards.map((card) =>
      order.has(card.id)
        ? {
            ...card,
            mobile_layout: {
              ...defaultMobileLayout(card, cards.indexOf(card)),
              order: order.get(card.id)!,
            },
          }
        : card
    ),
  }
}

export function moveMobileReport(
  config: ReportConfig,
  id: string,
  direction: -1 | 1
) {
  const card = config.cards.find((card) => card.id === id)
  if (!card) return config
  const ordered = mobileReportCards(
    config.cards.filter(
      (item) => (item.page_id ?? "overview") === (card.page_id ?? "overview")
    ),
    true
  )
  const over = ordered[ordered.findIndex((item) => item.id === id) + direction]
  return over ? reorderMobileReport(config, id, over.id) : config
}

export function translateDesktopRects(
  rects: DesktopRects,
  ids: string[],
  dx: number,
  dy: number,
  snap = true
): DesktopRects {
  const selected = ids.filter((id) => rects[id])
  if (!selected.length) return rects
  const anchor = rects[selected[0]]
  const x = clamp(
    rounded(anchor.x + dx, snap) - anchor.x,
    -Math.min(...selected.map((id) => rects[id].x)),
    24 - Math.max(...selected.map((id) => rects[id].x + rects[id].w))
  )
  const y = clamp(
    rounded(anchor.y + dy, snap) - anchor.y,
    -Math.min(...selected.map((id) => rects[id].y)),
    400 - Math.max(...selected.map((id) => rects[id].y))
  )
  return {
    ...rects,
    ...Object.fromEntries(
      selected.map((id) => [
        id,
        {
          ...rects[id],
          x: clamp(rounded(rects[id].x + x, false), 0, 24 - rects[id].w),
          y: clamp(rounded(rects[id].y + y, false), 0, 400),
        },
      ])
    ),
  }
}

export function resizeDesktopRect(
  rect: ReportDesktopLayout,
  dx: number,
  dy: number,
  snap = true
): ReportDesktopLayout {
  return {
    ...rect,
    w: clamp(rounded(rect.w + dx, snap), 4, 24 - rect.x),
    h: clamp(rounded(rect.h + dy, snap), 8, 60),
  }
}

export function alignDesktopRects(
  rects: DesktopRects,
  ids: string[],
  alignment: ReportAlignment,
  canvasHeight: number
): DesktopRects {
  const chosen = ids.filter((id) => rects[id])
  if (!chosen.length) return rects
  const bounds =
    chosen.length === 1
      ? { x: 0, y: 0, w: 24, h: canvasHeight }
      : {
          x: Math.min(...chosen.map((id) => rects[id].x)),
          y: Math.min(...chosen.map((id) => rects[id].y)),
          w:
            Math.max(...chosen.map((id) => rects[id].x + rects[id].w)) -
            Math.min(...chosen.map((id) => rects[id].x)),
          h:
            Math.max(...chosen.map((id) => rects[id].y + rects[id].h)) -
            Math.min(...chosen.map((id) => rects[id].y)),
        }
  return {
    ...rects,
    ...Object.fromEntries(
      chosen.map((id) => {
        const rect = rects[id]
        const x =
          alignment === "left"
            ? bounds.x
            : alignment === "center"
              ? bounds.x + (bounds.w - rect.w) / 2
              : alignment === "right"
                ? bounds.x + bounds.w - rect.w
                : rect.x
        const y =
          alignment === "top"
            ? bounds.y
            : alignment === "middle"
              ? bounds.y + (bounds.h - rect.h) / 2
              : alignment === "bottom"
                ? bounds.y + bounds.h - rect.h
                : rect.y
        return [
          id,
          {
            ...rect,
            x: rounded(clamp(x, 0, 24 - rect.w), false),
            y: rounded(clamp(y, 0, 400), false),
          },
        ]
      })
    ),
  }
}

export function distributeDesktopRects(
  rects: DesktopRects,
  ids: string[],
  axis: "x" | "y"
): DesktopRects {
  const size = axis === "x" ? "w" : "h"
  const chosen = ids
    .filter((id) => rects[id])
    .sort((a, b) => rects[a][axis] - rects[b][axis])
  if (chosen.length < 3) return rects
  const start = rects[chosen[0]][axis]
  const end = Math.max(...chosen.map((id) => rects[id][axis] + rects[id][size]))
  const gap =
    (end - start - chosen.reduce((sum, id) => sum + rects[id][size], 0)) /
    (chosen.length - 1)
  let cursor = start
  const result = { ...rects }
  chosen.forEach((id) => {
    result[id] = {
      ...rects[id],
      [axis]: rounded(
        clamp(cursor, 0, axis === "x" ? 24 - rects[id].w : 400),
        false
      ),
    }
    cursor += rects[id][size] + gap
  })
  return result
}

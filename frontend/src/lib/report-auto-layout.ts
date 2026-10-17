import {
  defaultDesktopSize,
  REPORT_COLUMNS,
  REPORT_ROW,
  type DesktopRects,
} from "@/lib/report-layout"
import type { ReportCard, ReportConfig } from "@/lib/reports"
import {
  REPORT_WIDGET_PRESETS,
  type ReportWidgetSize,
} from "@/lib/report-widget"

export type ReportCardSize = { w: number; h: number }

export function setAutomaticReportPreset(
  config: ReportConfig,
  id: string,
  size: ReportWidgetSize
) {
  return setAutomaticReportSize(config, id, REPORT_WIDGET_PRESETS[size])
}
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

/** One size preference and one order; available space only changes presentation. */
export function automaticReportSizes(
  cards: ReportCard[]
): Record<string, ReportCardSize> {
  const kpis = cards.filter((card) => card.visual === "kpi").length
  return Object.fromEntries(
    cards.map((card) => {
      const fallback = defaultDesktopSize(card, kpis)
      const stored = card.desktop_layout
      return [
        card.id,
        {
          w:
            stored && Number.isFinite(stored.w)
              ? clamp(Math.round(stored.w), 4, REPORT_COLUMNS)
              : fallback.w,
          h:
            stored && Number.isFinite(stored.h)
              ? clamp(Math.round(stored.h), 8, 60)
              : fallback.h,
        },
      ]
    })
  )
}

export function automaticReportRects(
  cards: ReportCard[],
  compact: boolean,
  sizes = automaticReportSizes(cards)
): DesktopRects {
  const rects: DesktopRects = {}
  const skyline = Array<number>(REPORT_COLUMNS).fill(0)
  for (const card of cards) {
    const size = sizes[card.id]
    const w = compact ? (size.w <= 6 ? 12 : REPORT_COLUMNS) : size.w
    let y = Infinity,
      x = 0
    for (let column = 0; column <= REPORT_COLUMNS - w; column++) {
      const top = Math.max(...skyline.slice(column, column + w))
      if (top < y) {
        x = column
        y = top
      }
    }
    for (let column = x; column < x + w; column++) skyline[column] = y + size.h
    rects[card.id] = { x, y, w, h: size.h }
  }
  return rects
}

export function resizeAutomaticReportCard(
  size: ReportCardSize,
  dx: number,
  dy: number,
  width: number,
  compact: boolean
): ReportCardSize {
  let w = size.w
  if (width > 0) {
    if (compact) {
      const half = size.w <= 6
      const nextHalf = (half ? 0.5 : 1) + dx / width <= 0.75
      if (nextHalf !== half) w = nextHalf ? 6 : 12
    } else
      w = clamp(
        Math.round(size.w + (dx * REPORT_COLUMNS) / width),
        4,
        REPORT_COLUMNS
      )
  }
  return { w, h: clamp(Math.round(size.h + dy / REPORT_ROW), 8, 60) }
}

export function setAutomaticReportSize(
  config: ReportConfig,
  id: string,
  size: ReportCardSize
): ReportConfig {
  const card = config.cards.find((item) => item.id === id)
  if (
    !card ||
    card.locked ||
    !Number.isFinite(size.w) ||
    !Number.isFinite(size.h)
  )
    return config
  const bounded = {
    w: clamp(Math.round(size.w), 4, REPORT_COLUMNS),
    h: clamp(Math.round(size.h), 8, 60),
  }
  return {
    ...config,
    cards: config.cards.map((item) =>
      item.id === id
        ? {
            ...item,
            desktop_layout: { x: 0, y: 0, ...bounded },
            mobile_layout: null,
          }
        : item
    ),
  }
}

import { describe, expect, it } from "vitest"
import {
  automaticReportRects,
  automaticReportSizes,
  resizeAutomaticReportCard,
  setAutomaticReportSize,
  setAutomaticReportPreset,
} from "@/lib/report-auto-layout"
import { reportWidgetSize } from "@/lib/report-widget"
import {
  normalizeReportConfig,
  reorderReportPage,
  reportDataKey,
  type ReportCard,
  type ReportConfig,
} from "@/lib/reports"

function card(id: string, w = 12, h = 20): ReportCard {
  return {
    id,
    title: id,
    visual: "bar",
    metric: "sales",
    dimension: "customer",
    limit: 5,
    desktop_layout: { x: 0, y: 0, w, h },
  }
}
function document(): ReportConfig {
  return {
    name: "自動報表",
    template: "sales",
    period: "this_month",
    owner_id: null,
    customer_type: null,
    pages: [
      { id: "overview", name: "總覽" },
      { id: "other", name: "另一頁" },
    ],
    cards: [
      card("a", 6, 10),
      card("b"),
      card("c", 24, 28),
      { ...card("d"), page_id: "other" },
    ],
  }
}
function expectNoOverlap(cards: ReportCard[], compact: boolean) {
  const rects = Object.values(automaticReportRects(cards, compact))
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i]
    expect(a.x).toBeGreaterThanOrEqual(0)
    expect(a.x + a.w).toBeLessThanOrEqual(24)
    expect(a.y).toBeGreaterThanOrEqual(0)
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j]
      expect(
        a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y
      ).toBe(true)
    }
  }
}

describe("自動排列報表卡片", () => {
  it("大中小預設在手機、平板與桌面保留相同資訊層級，不改資料查詢", () => {
    const original = document()
    for (const size of ["small", "medium", "large"] as const) {
      const next = setAutomaticReportPreset(original, "a", size)
      expect(reportDataKey(next)).toBe(reportDataKey(original))
      expect(next.cards[3]).toBe(original.cards[3])
      for (const width of [225, 273, 358, 704, 1144, 1600]) {
        const rect = automaticReportRects([next.cards[0]], width < 560).a
        expect(
          reportWidgetSize((width * rect.w) / 24 - 8, rect.h * 24 - 8)
        ).toBe(size)
      }
    }
    original.cards[0].locked = true
    expect(setAutomaticReportPreset(original, "a", "large")).toBe(original)
  })
  it("最大高度、不同寬度、重疊的舊座標都能在兩種螢幕自動讓位", () => {
    const cards = Array.from({ length: 24 }, (_, i) =>
      card(String(i), [4, 6, 8, 12, 24][i % 5], [8, 10, 28, 60][i % 4])
    )
    const original = JSON.stringify(cards)
    for (const compact of [false, true]) {
      expectNoOverlap(cards, compact)
      expect(automaticReportRects(cards, compact)).toEqual(
        automaticReportRects(cards, compact)
      )
    }
    expect(JSON.stringify(cards)).toBe(original)
  })
  it("縮放後重新排列，不需切換自由位置；資料條件和其他頁面保持原值", () => {
    const original = document()
    original.cards[0].mobile_layout = {
      order: 2,
      width: "half",
      height: 8,
      hidden: true,
    }
    const next = setAutomaticReportSize(original, "a", { w: 24, h: 28 })
    expect(next.cards[0].desktop_layout).toEqual({ x: 0, y: 0, w: 24, h: 28 })
    expect(next.cards[0].mobile_layout).toBeNull()
    expect(next.cards[3]).toBe(original.cards[3])
    expect(next.pages).toBe(original.pages)
    expect(reportDataKey(next)).toBe(reportDataKey(original))
    expect(normalizeReportConfig(next).cards[0].desktop_layout).toEqual(
      next.cards[0].desktop_layout
    )
    for (const compact of [false, true])
      expectNoOverlap(next.cards.slice(0, 3), compact)
  })
  it("窄螢幕只改呈現，單獨調整高度不會縮掉寬螢幕的全寬偏好", () => {
    const original = { w: 24, h: 20 }
    const next = resizeAutomaticReportCard(original, 0, 48, 320, true)
    expect(next).toEqual({ w: 24, h: 22 })
    expect(resizeAutomaticReportCard(original, -120, -240, 320, true)).toEqual({
      w: 6,
      h: 10,
    })
    expect(
      resizeAutomaticReportCard({ w: 6, h: 10 }, 120, 192, 320, true)
    ).toEqual({ w: 12, h: 18 })
    expect(
      resizeAutomaticReportCard(original, 99999, -99999, 1000, false)
    ).toEqual({ w: 24, h: 8 })
    expect(
      resizeAutomaticReportCard(original, -99999, 99999, 1000, false)
    ).toEqual({ w: 4, h: 60 })
  })
  it("移動後兩種螢幕使用同一個順序，舊手機順序不會蓋掉新排列", () => {
    const original = document()
    original.cards[0].mobile_layout = {
      order: 99,
      width: "full",
      height: 60,
      hidden: true,
    }
    const next = reorderReportPage(original, "c", "a")
    expect(next.cards.slice(0, 3).map((c) => c.id)).toEqual(["c", "a", "b"])
    for (const compact of [false, true])
      expect(
        Object.keys(automaticReportRects(next.cards.slice(0, 3), compact))
      ).toEqual(["c", "a", "b"])
    expect(next.cards[3]).toBe(original.cards[3])
  })
  it("鎖定卡片不改尺寸，舊設定有異常尺寸時安全回復", () => {
    const original = document()
    original.cards[0].locked = true
    expect(setAutomaticReportSize(original, "a", { w: 12, h: 18 })).toBe(
      original
    )
    expect(setAutomaticReportSize(original, "b", { w: NaN, h: 18 })).toBe(
      original
    )
    const bad = card("bad", Infinity, NaN)
    expect(automaticReportSizes([bad]).bad).toEqual({ w: 12, h: 22 })
  })
})

import { describe, expect, it } from "vitest"
import {
  alignDesktopRects,
  defaultMobileLayout,
  desktopReportRects,
  distributeDesktopRects,
  mobileReportCards,
  moveMobileReport,
  reorderMobileReport,
  resizeDesktopRect,
  setDesktopReportRects,
  setMobileReportLayout,
  translateDesktopRects,
  validDesktopRect,
  type DesktopRects,
} from "@/lib/report-layout"
import {
  normalizeReportConfig,
  reportDataKey,
  type ReportCard,
  type ReportConfig,
} from "@/lib/reports"

function card(id: string, patch: Partial<ReportCard> = {}): ReportCard {
  return {
    id,
    title: id,
    metric: "sales",
    dimension: "customer",
    visual: "bar",
    limit: 5,
    ...patch,
  }
}
function config(): ReportConfig {
  return {
    name: "版面",
    template: "sales",
    period: "this_month",
    owner_id: null,
    customer_type: null,
    pages: [
      { id: "overview", name: "總覽" },
      { id: "other", name: "別頁" },
    ],
    cards: [
      card("a", { visual: "kpi", dimension: "none" }),
      card("b"),
      card("c", { width: "full" }),
      card("d", { page_id: "other" }),
    ],
  }
}

describe("報表獨立版面", () => {
  it("舊格線不自動轉自由位置；切換時產生不重疊的有效位置並保留其他分頁", () => {
    const original = config()
    expect(
      normalizeReportConfig(original).cards[0].desktop_layout
    ).toBeUndefined()
    const next = setDesktopReportRects(original, "overview", {})
    expect(next.pages?.map((page) => page.desktop_layout)).toEqual([
      "free",
      undefined,
    ])
    expect(next.cards[3]).toBe(original.cards[3])
    const rects = next.cards.slice(0, 3).map((card) => card.desktop_layout!)
    expect(rects.every(validDesktopRect)).toBe(true)
    expect(rects[2].w).toBe(24)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i],
          b = rects[j]
        expect(
          a.x + a.w <= b.x ||
            b.x + b.w <= a.x ||
            a.y + a.h <= b.y ||
            b.y + b.h <= a.y
        ).toBe(true)
      }
    expect(original.cards.some((card) => card.desktop_layout)).toBe(false)
  })
  it("補新圖不移動已儲存自由位置；重排仍保留手機設定", () => {
    const cards = [
      card("a", { desktop_layout: { x: 4, y: 2, w: 8, h: 12 } }),
      card("b"),
    ]
    const rects = desktopReportRects(cards)
    expect(rects.a).toEqual(cards[0].desktop_layout)
    expect(rects.b).toEqual({ x: 12, y: 0, w: 12, h: 22 })
    const original = setMobileReportLayout(config(), "a", {
      hidden: true,
      height: 20,
    })
    expect(
      setDesktopReportRects(original, "overview", {}, true).cards[0]
        .mobile_layout
    ).toEqual(original.cards[0].mobile_layout)
  })
  it("群組拖曳在邊界保留相對距離，開啟吸附後錨點貼齊整格", () => {
    const rects = {
      a: { x: 1.3, y: 2.2, w: 4, h: 8 },
      b: { x: 8.3, y: 9.2, w: 8, h: 12 },
    }
    const moved = translateDesktopRects(rects, ["a", "b"], 2.3, 3.2)
    expect(moved.a).toEqual({ x: 4, y: 5, w: 4, h: 8 })
    expect(moved.b.x - moved.a.x).toBeCloseTo(7)
    expect(moved.b.y - moved.a.y).toBeCloseTo(7)
    const edge = translateDesktopRects(rects, ["a", "b"], 100, -100)
    expect(edge.b.x + edge.b.w).toBe(24)
    expect(edge.a.y).toBe(0)
    expect(Object.values(edge).every(validDesktopRect)).toBe(true)
    expect(rects.a.x).toBe(1.3)
  })
  it("關閉吸附允許 0.1 格，尺寸限制保留整張卡在畫布內", () => {
    const rect = { x: 17, y: 400, w: 6, h: 9 }
    expect(resizeDesktopRect(rect, 100, 100)).toEqual({ ...rect, w: 7, h: 60 })
    expect(resizeDesktopRect(rect, -100, -100)).toEqual({ ...rect, w: 4, h: 8 })
    expect(resizeDesktopRect(rect, 0.24, 0.34, false)).toEqual({
      ...rect,
      w: 6.2,
      h: 9.3,
    })
    expect(
      translateDesktopRects({ a: rect }, ["a"], 0.22, -1.14, false).a
    ).toEqual({ ...rect, x: 17.2, y: 398.9 })
    expect(validDesktopRect({ ...rect, x: Number.NaN })).toBe(false)
    expect(validDesktopRect({ ...rect, w: 8 })).toBe(false)
  })
  it("單張對齊畫布、多張依共同邊界對齊，等距保留首尾邊界", () => {
    const rects: DesktopRects = {
      a: { x: 1, y: 2, w: 4, h: 8 },
      b: { x: 9, y: 20, w: 6, h: 10 },
      c: { x: 20, y: 40, w: 4, h: 8 },
    }
    expect(alignDesktopRects(rects, ["a"], "center", 50).a.x).toBe(10)
    expect(alignDesktopRects(rects, ["a"], "bottom", 50).a.y).toBe(42)
    const aligned = alignDesktopRects(rects, ["a", "b"], "right", 50)
    expect(aligned.a.x + aligned.a.w).toBe(15)
    expect(aligned.b).toEqual(rects.b)
    expect(aligned.c).toBe(rects.c)
    const distributed = distributeDesktopRects(rects, ["a", "b", "c"], "x")
    expect(distributed.a.x).toBe(1)
    expect(distributed.c.x + distributed.c.w).toBe(24)
    expect(distributed.b.x - (distributed.a.x + distributed.a.w)).toBeCloseTo(
      distributed.c.x - (distributed.b.x + distributed.b.w)
    )
  })
  it("只改手機尺寸也固定整頁手機預設，之後桌機重排不改手機順序", () => {
    const original = config()
    const mobile = setMobileReportLayout(original, "b", {
      width: "half",
      height: 17,
      hidden: true,
    })
    expect(mobile.cards.slice(0, 3).every((card) => card.mobile_layout)).toBe(
      true
    )
    expect(mobile.cards[3]).toBe(original.cards[3])
    const reversed = { ...mobile, cards: [...mobile.cards].reverse() }
    expect(
      mobileReportCards(
        reversed.cards.filter((card) => card.page_id !== "other"),
        true
      ).map((card) => card.id)
    ).toEqual(["a", "b", "c"])
    expect(
      mobileReportCards(mobile.cards.slice(0, 3)).map((card) => card.id)
    ).toEqual(["a", "c"])
    expect(mobile.cards[1].width).toBeUndefined()
    expect(mobile.cards[1].mobile_layout).toMatchObject({
      width: "half",
      height: 17,
      hidden: true,
    })
  })
  it("手機拖曳與按鈕順序相同、不改桌機位置及其他分頁，隱藏圖仍可重排恢復", () => {
    const original = setDesktopReportRects(
      setMobileReportLayout(config(), "b", { hidden: true }),
      "overview",
      {}
    )
    const moved = reorderMobileReport(original, "c", "a")
    expect(moved.cards.map((card) => card.id)).toEqual(
      original.cards.map((card) => card.id)
    )
    expect(moved.cards.map((card) => card.desktop_layout)).toEqual(
      original.cards.map((card) => card.desktop_layout)
    )
    expect(
      mobileReportCards(moved.cards.slice(0, 3), true).map((card) => card.id)
    ).toEqual(["c", "a", "b"])
    expect(
      mobileReportCards(moved.cards.slice(0, 3)).map((card) => card.id)
    ).toEqual(["c", "a"])
    expect(moved.cards[3]).toBe(original.cards[3])
    const next = moveMobileReport(moved, "b", -1)
    expect(
      mobileReportCards(next.cards.slice(0, 3), true).map((card) => card.id)
    ).toEqual(["c", "b", "a"])
    expect(reorderMobileReport(original, "a", "d")).toBe(original)
    expect(moveMobileReport(original, "a", -1)).toBe(original)
  })
  it("舊手機預設依指標及舊寬度，兩種版面都不改查詢、下鑽及聯動鍵", () => {
    const original = config()
    expect(defaultMobileLayout(original.cards[0], 0).width).toBe("half")
    expect(defaultMobileLayout(original.cards[1], 1).width).toBe("full")
    const next = setDesktopReportRects(
      setMobileReportLayout(original, "c", { hidden: true }),
      "overview",
      {}
    )
    expect(reportDataKey(next)).toBe(reportDataKey(original))
    expect(normalizeReportConfig(next).cards[2].mobile_layout).toEqual(
      next.cards[2].mobile_layout
    )
  })
})

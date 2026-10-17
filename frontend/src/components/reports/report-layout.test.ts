import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReportLayoutCanvas } from "@/components/reports/report-layout"
import { type ReportConfig } from "@/lib/reports"

const config: ReportConfig = {
  name: "版面",
  template: "sales",
  period: "this_month",
  owner_id: null,
  customer_type: null,
  pages: [{ id: "overview", name: "總覽", desktop_layout: "flow" }],
  cards: [
    {
      id: "a",
      title: "業績",
      metric: "sales",
      visual: "bar",
      dimension: "owner",
      limit: 5,
      desktop_layout: { x: 3, y: 5, w: 12, h: 20 },
      mobile_layout: { order: 1, width: "full", height: 18, hidden: true },
    },
    {
      id: "b",
      title: "毛利",
      metric: "net_margin",
      visual: "kpi",
      dimension: "none",
      limit: 5,
      desktop_layout: { x: 15, y: 0, w: 6, h: 10 },
      mobile_layout: { order: 0, width: "half", height: 8, hidden: false },
    },
  ],
}
function board(wide: boolean, editing = true, document = config, readonly = false) {
  return renderToStaticMarkup(
    createElement(ReportLayoutCanvas, {
      config: document,
      pageId: "overview",
      editing,
      readonly,
      isDesktop: wide,
      selectedId: "a",
      onSelect: () => undefined,
      onChange: () => undefined,
      renderCard: (card, layout) =>
        createElement(
          "article",
          { "data-test-height": layout.fixedHeight },
          card.title
        ),
    })
  )
}

describe("報表自動版面", () => {
  it("兩種螢幕共用卡片順序與高度，不再提供版面設定工具", () => {
    for (const wide of [true, false]) {
      const html = board(wide)
      expect(html).toContain('data-report-layout="automatic"')
      expect(html).toContain('data-layout-card="a"')
      expect(html).toContain('data-layout-card="b"')
      expect(html.indexOf('data-layout-card="a"')).toBeLessThan(
        html.indexOf('data-layout-card="b"')
      )
      expect(html).toContain('data-test-height="472"')
      expect(html).toContain('data-test-height="232"')
      expect(html).toContain('aria-label="調整尺寸：業績"')
      expect(html).not.toContain('aria-label="報表版面工具"')
      expect(html).not.toContain('aria-label="編輯版面裝置"')
      expect(html).not.toContain("<select")
      expect(html).not.toContain("<details")
      expect(html).not.toContain('type="checkbox"')
    }
    expect(board(true)).toContain('data-layout-rect="0,0,12,20"')
    expect(board(false)).toContain('data-layout-rect="0,0,24,20"')
  })
  it("未開啟圖表設定時仍可直接調整大小，兩種螢幕遵守相同的隱藏設定", () => {
    const document = {
      ...config,
      cards: config.cards.map((card) =>
        card.id === "b" ? { ...card, hidden: true } : card
      ),
    }
    for (const wide of [true, false]) {
      const html = board(wide, false, document)
      expect(html).toContain('data-layout-card="a"')
      expect(html).not.toContain('data-layout-card="b"')
      expect(html).toContain('aria-label="調整尺寸：業績"')
      expect(html).toContain("manager-map-corner-material")
      expect(board(wide, true, document)).toContain('data-layout-card="b"')
    }
  })
  it("唯讀報表與鎖定卡片不顯示調整把手", () => {
    const document = {
      ...config,
      cards: config.cards.map((card) =>
        card.id === "a" ? { ...card, locked: true } : card
      ),
    }
    for (const wide of [true, false]) {
      for (const editing of [true, false]) {
        expect(board(wide, editing, config, true)).not.toContain(
          'aria-label="調整尺寸：'
        )
        const html = board(wide, editing, document)
        expect(html).not.toContain('aria-label="調整尺寸：業績"')
        expect(html).toContain('aria-label="調整尺寸：毛利"')
      }
    }
  })
  it("舊報表未儲存座標時也會自動排列並可直接縮放", () => {
    const document = {
      ...config,
      cards: config.cards.map((card) => ({
        ...card,
        desktop_layout: null,
        mobile_layout: null,
      })),
    }
    for (const wide of [true, false]) {
      const html = board(wide, true, document)
      expect(html).toContain('data-report-layout="automatic"')
      expect(html).toContain('aria-label="調整尺寸：業績"')
      expect(html).toContain('aria-label="調整尺寸：毛利"')
    }
  })
})

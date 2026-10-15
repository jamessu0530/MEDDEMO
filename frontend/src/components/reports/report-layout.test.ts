import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReportLayoutCanvas } from "@/components/reports/report-layout"
import { ReportLayoutFields } from "@/components/reports/report-layout-fields"
import { type ReportConfig } from "@/lib/reports"

const config: ReportConfig = {
  name: "版面",
  template: "sales",
  period: "this_month",
  owner_id: null,
  customer_type: null,
  pages: [{ id: "overview", name: "總覽", desktop_layout: "free" }],
  cards: [
    {
      id: "a",
      title: "桌機保留",
      metric: "sales",
      visual: "bar",
      dimension: "owner",
      limit: 5,
      desktop_layout: { x: 3, y: 5, w: 12, h: 20 },
      mobile_layout: { order: 1, width: "full", height: 18, hidden: true },
    },
    {
      id: "b",
      title: "手機優先",
      metric: "sales",
      visual: "kpi",
      dimension: "none",
      limit: 5,
      desktop_layout: { x: 15, y: 0, w: 9, h: 12 },
      mobile_layout: { order: 0, width: "half", height: 8, hidden: false },
    },
  ],
}
function board(desktop: boolean, editing = true) {
  return renderToStaticMarkup(
    createElement(ReportLayoutCanvas, {
      config,
      pageId: "overview",
      editing,
      isDesktop: desktop,
      selectedId: "a",
      onSelect: () => undefined,
      onChange: () => undefined,
      onMobileChange: () => undefined,
      renderCard: (card, layout) =>
        createElement(
          "article",
          { "data-test-height": layout.fixedHeight },
          card.title
        ),
    })
  )
}

describe("報表版面顯示", () => {
  it("桌機自由位置依儲存座標呈現，手機隱藏不影響桌機", () => {
    const html = board(true)
    expect(html).toContain('data-report-layout="desktop-free"')
    expect(html).toContain('data-layout-rect="3,5,12,20"')
    expect(html).toContain("left:12.5%;top:120px;width:50%;height:480px")
    expect(html).toContain('data-test-height="472"')
    expect(html).toContain('aria-label="調整尺寸：桌機保留"')
    expect(html).toContain('aria-label="圖表對齊與分布"')
  })
  it("手機只在版面清單提供隱藏圖表恢復入口，檢視模式沒有編輯控制", () => {
    const html = board(false)
    expect(html).toContain('aria-label="手機顯示：桌機保留"')
    expect(html).not.toContain('data-layout-card="a"')
    expect(html).toContain('data-layout-card="b"')
    expect(html).toContain('data-test-height="192"')
    expect(html).not.toContain('aria-label="調整尺寸：')
    const view = board(false, false)
    expect(view).not.toContain('aria-label="報表版面工具"')
    expect(view).not.toContain("桌機保留")
    expect(view).toContain("手機優先")
  })
  it("手機與桌機設定面板使用各自的尺寸及顯示控制", () => {
    const props = { card: config.cards[0], config, onChange: () => undefined }
    const phone = renderToStaticMarkup(
      createElement(ReportLayoutFields, { ...props, mobile: true })
    )
    expect(phone).toContain('aria-label="在手機顯示此圖表"')
    expect(phone).toContain('aria-label="手機圖表高度（格）"')
    expect(phone).toContain('value="18"')
    expect(phone).not.toContain('aria-label="桌機寬度（格）"')
    const desktop = renderToStaticMarkup(
      createElement(ReportLayoutFields, { ...props, mobile: false })
    )
    expect(desktop).toContain('aria-label="桌機水平位置（格）"')
    expect(desktop).toContain('value="3"')
    expect(desktop).not.toContain('aria-label="手機圖表高度（格）"')
  })
})

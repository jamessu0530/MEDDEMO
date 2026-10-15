import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReportExploreControls } from "@/components/reports/report-explore-controls"
import type { ReportCard } from "@/lib/reports"

const card: ReportCard = {
  id: "trend",
  title: "銷售",
  metric: "sales",
  dimension: "quarter",
  visual: "line",
  limit: 5,
}
const props = {
  card,
  action: "filter" as const,
  onAction() {},
  onGrain() {},
  onUp() {},
  onReset() {},
  onDetails() {},
}

describe("圖表探索控制", () => {
  it("日期層級、下鑽與逐筆明細都可由鍵盤操作", () => {
    const html = renderToStaticMarkup(
      createElement(ReportExploreControls, props)
    )
    expect(html).toContain('aria-label="日期層級：銷售"')
    expect(html).toContain('value="year"')
    expect(html).toContain('value="quarter" selected=""')
    expect(html).toContain('value="drill"')
    expect(html).toContain("逐筆明細")
  })
  it("月份不虛構下一層，快照沒有日期控制", () => {
    const month = renderToStaticMarkup(
      createElement(ReportExploreControls, {
        ...props,
        card: { ...card, dimension: "month" },
      })
    )
    expect(month).not.toContain('value="drill"')
    const snapshot = renderToStaticMarkup(
      createElement(ReportExploreControls, {
        ...props,
        card: {
          ...card,
          dimension: "customer",
          metric: "customers",
          visual: "bar",
        },
      })
    )
    expect(snapshot).not.toContain("日期層級")
    expect(snapshot).toContain("逐筆明細")
  })
  it("祖先脈絡標出精確點選系列，提供上層和完整範圍", () => {
    const html = renderToStaticMarkup(
      createElement(ReportExploreControls, {
        ...props,
        state: {
          dimension: "quarter",
          steps: [
            {
              dimension: "year",
              point: {
                filters: [{ dimension: "year", key: "2031" }],
                label: "2031 年 / S2",
              },
            },
          ],
        },
      })
    )
    expect(html).toContain("2031 年 / S2")
    expect(html).toContain("上一層")
    expect(html).toContain("回到完整範圍")
  })
})

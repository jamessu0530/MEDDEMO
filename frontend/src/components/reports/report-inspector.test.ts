import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  ReportInspector,
  ReportVisualGallery,
} from "@/components/reports/report-inspector"
import {
  VISUALS,
  type ReportCard,
  type ReportConfig,
  type ReportMetric,
} from "@/lib/reports"

function gallery(metric?: ReportMetric) {
  return renderToStaticMarkup(
    createElement(ReportVisualGallery, { metric, onSelect: () => undefined })
  )
}

function inspector(cards: ReportCard[], selected = cards[0]) {
  const config: ReportConfig = {
    name: "我的報表",
    template: "sales",
    period: "this_month",
    owner_id: null,
    customer_type: null,
    pages: [
      { id: "overview", name: "總覽" },
      { id: "details", name: "明細" },
    ],
    cards,
  }
  return renderToStaticMarkup(
    createElement(ReportInspector, {
      config,
      card: selected,
      owners: [],
      onChange: () => undefined,
      onAdd: () => undefined,
      onDuplicate: () => undefined,
      onDelete: () => undefined,
      onMove: () => undefined,
    })
  )
}

function card(id: string, patch: Partial<ReportCard> = {}): ReportCard {
  return {
    id,
    title: "業績",
    metric: "sales",
    dimension: "customer",
    visual: "bar",
    limit: 5,
    page_id: "overview",
    ...patch,
  }
}

function action(html: string, label: string) {
  return (
    [...html.matchAll(/<button\b[^>]*>.*?<\/button>/g)].find(([button]) =>
      button.includes(label)
    )?.[0] ?? ""
  )
}

describe("ReportInspector", () => {
  it("圖表庫提供全部 16 種具有名稱的視覺效果", () => {
    const html = gallery()
    expect(html.match(/<button\b/g)).toHaveLength(16)
    for (const label of Object.values(VISUALS))
      expect(html).toContain(`aria-label="${label}"`)
    expect(html).not.toContain("disabled=")
  })

  it("快照不能選月份趨勢，拜訪不能選雙交易數值圖表，並提供原因", () => {
    const snapshot = gallery("overdue")
    expect(snapshot.match(/disabled=""/g)).toHaveLength(4)
    expect(snapshot).toContain("此數據是目前快照，無法按日期顯示歷史趨勢")
    expect(snapshot).toContain("此圖表需要兩個不同的交易指標")
    expect(gallery("visits").match(/disabled=""/g)).toHaveLength(2)
    expect(gallery("net_margin")).not.toContain("disabled=")
  })

  it("矩陣的欄分組排除列分組，而移動按鈕依所選頁面判斷", () => {
    const selected = card("matrix", {
      visual: "matrix",
      dimension: "customer_type",
      legend: "owner",
    })
    const html = inspector(
      [card("other-page", { page_id: "details" }), selected, card("next")],
      selected
    )
    const legend =
      html.match(
        /<select[^>]*aria-label="欄階層 1"[^>]*>(.*?)<\/select>/
      )?.[1] ?? ""
    expect(legend).toContain('value="owner"')
    expect(legend).toContain('value="month"')
    expect(legend).not.toContain('value="customer_type"')
    expect(action(html, "往前排列")).toContain("disabled=")
    expect(action(html, "往後排列")).not.toContain("disabled=")
  })

  it("每頁 12 張停用複製，最後一張仍可刪除", () => {
    const full = inspector(
      Array.from({ length: 12 }, (_, index) => card(`card-${index}`))
    )
    expect(action(full, "複製圖表")).toContain("disabled=")
    expect(action(full, "刪除圖表")).not.toContain("disabled=")
    expect(action(inspector([card("only")]), "刪除圖表")).not.toContain(
      "disabled="
    )
  })
})

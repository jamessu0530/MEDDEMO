import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReportMatrix } from "@/components/reports/report-matrix"
import { ReportMatrixFields } from "@/components/reports/report-matrix-fields"
import { matrixPathId } from "@/lib/report-matrix"
import {
  reportMatrixOptions,
  type ReportCard,
  type ReportMatrixData,
  type ReportMatrixNode,
} from "@/lib/reports"

const card: ReportCard = {
  id: "matrix",
  title: "業務分析",
  metric: "sales",
  dimension: "owner",
  legend: "product",
  visual: "matrix",
  limit: 3,
  matrix: {
    rows: ["owner", "customer"],
    columns: ["product"],
    metrics: ["sales", "net_margin_rate", "order_count"],
  },
}
const row: ReportMatrixNode = {
  id: matrixPathId([{ dimension: "owner", key: "S1" }]),
  path: [{ dimension: "owner", key: "S1", label: "業務甲" }],
  label: "業務甲",
  depth: 1,
  has_children: true,
  expanded: false,
  show_values: true,
}
const column: ReportMatrixNode = {
  id: matrixPathId([{ dimension: "product", key: "P1" }]),
  path: [{ dimension: "product", key: "P1", label: "商品甲" }],
  label: "商品甲",
  depth: 1,
  has_children: false,
  expanded: false,
  show_values: true,
}
const data: ReportMatrixData = {
  options: reportMatrixOptions(card),
  rows: [row],
  columns: [column],
  cells: [
    {
      row_id: row.id,
      column_id: column.id,
      values: { sales: 100, net_margin_rate: null, order_count: 1 },
      row_count: 1,
      comparisons: {},
    },
    {
      row_id: "[]",
      column_id: "[]",
      values: { sales: 100, net_margin_rate: 0.5, order_count: 1 },
      row_count: 1,
      comparisons: {},
    },
  ],
  totals: { sales: 100, net_margin_rate: 0.5, order_count: 1 },
  row_total: 46,
  column_total: 1,
  row_page: 1,
  column_page: 1,
  row_page_size: 25,
  column_page_size: 10,
  note: "總計不受分頁影響",
}

describe("矩陣介面", () => {
  it("多指標有各自單位與空值，展開及分頁控制可由鍵盤操作", () => {
    const html = renderToStaticMarkup(
      createElement(ReportMatrix, {
        card,
        data,
        onViewChange: () => undefined,
        onSelect: () => undefined,
      })
    )
    for (const text of [
      "100 元",
      "無法計算",
      "1 張",
      "50%",
      "總計",
      "總計不受分頁影響",
    ])
      expect(html).toContain(text)
    expect(html).toContain('aria-label="展開列：業務甲"')
    expect(html).toContain('aria-label="下一頁列"')
    expect(html).toContain("列 · 第 1／2 頁")
    expect(html).not.toContain("46 個分組")
    expect(html).toContain("overflow-auto")
  })
  it("編輯器列出多層軸與所有相容交易指標，最後一個指標不能刪除", () => {
    const html = renderToStaticMarkup(
      createElement(ReportMatrixFields, { card, onChange: () => undefined })
    )
    for (const label of [
      "列階層 1",
      "列階層 2",
      "欄階層 1",
      "新增列階層",
      "新增欄階層",
      "平均客單價",
      "顯示階層小計",
      "預設列展開層數",
    ])
      expect(html).toContain(label)
    const one = renderToStaticMarkup(
      createElement(ReportMatrixFields, {
        card: {
          ...card,
          metric: "visits",
          matrix: { rows: ["owner"], columns: [], metrics: ["visits"] },
        },
        onChange: () => undefined,
      })
    )
    expect(one).not.toContain("平均客單價")
    expect(one).toContain('type="checkbox"')
    expect(one).toContain('disabled=""')
  })
})

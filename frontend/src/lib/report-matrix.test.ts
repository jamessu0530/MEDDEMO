import { describe, expect, it } from "vitest"
import {
  MATRIX_ROOT,
  matrixAllDepth,
  matrixFilters,
  matrixHeaders,
  matrixPathExpanded,
  matrixPathId,
  matrixSelection,
  matrixRenderKey,
  toggleMatrixPath,
} from "@/lib/report-matrix"
import {
  normalizeCard,
  pruneReportSelections,
  reportCsv,
  reportDataKey,
  reportMatrixOptions,
  validReportSelection,
  type ReportCard,
  type ReportMatrixData,
  type ReportMatrixNode,
} from "@/lib/reports"

const card: ReportCard = {
  id: "matrix",
  title: "矩陣",
  metric: "sales",
  dimension: "owner",
  legend: "year",
  visual: "matrix",
  limit: 3,
  matrix: {
    rows: ["owner", "customer_type", "customer"],
    columns: ["year", "quarter", "month"],
    metrics: ["sales", "net_margin_rate", "order_count"],
  },
}
function node(
  path: ReportMatrixNode["path"],
  changes: Partial<ReportMatrixNode> = {}
): ReportMatrixNode {
  return {
    id: matrixPathId(path),
    path,
    label: path.at(-1)?.label ?? "總計",
    depth: path.length,
    has_children: false,
    expanded: false,
    show_values: true,
    ...changes,
  }
}
const row = node([
  { dimension: "owner", key: "S1", label: "業務甲" },
  { dimension: "customer_type", key: "clinic", label: "診所" },
  { dimension: "customer", key: "C1", label: "客戶甲" },
])
const column = node([
  { dimension: "year", key: "2031", label: "2031 年" },
  { dimension: "quarter", key: "2031-Q1", label: "第一季" },
  { dimension: "month", key: "2031-01", label: "一月" },
])

describe("階層矩陣", () => {
  it("載入中只重用固定範圍相同的矩陣，避免互動後捲動位置重設", () => {
    const query = {
      name: "矩陣",
      template: "manager" as const,
      period: "this_month" as const,
      owner_id: null,
      customer_type: null,
      cards: [card],
    }
    const key = matrixRenderKey(query, card.id)
    expect(
      matrixRenderKey(
        {
          ...query,
          matrix_views: { matrix: { column_page: 2 } },
          selection_groups: [
            { source_id: card.id, points: [matrixSelection(row, column)!] },
          ],
        },
        card.id
      )
    ).toBe(key)
    expect(
      matrixRenderKey({ ...query, period: "six_months" }, card.id)
    ).not.toBe(key)
    expect(
      matrixRenderKey(
        {
          ...query,
          cards: [{ ...card, filters: [{ dimension: "customer", key: "C1" }] }],
        },
        card.id
      )
    ).not.toBe(key)
    expect(
      matrixRenderKey(
        { ...query, cards: [{ ...card, visual: "column" }] },
        card.id
      )
    ).toBeNull()
    const legacy = { ...card, matrix: undefined }
    expect(reportDataKey({ ...query, cards: [legacy] })).not.toBe(
      reportDataKey({ ...query, cards: [{ ...legacy, visual: "column" }] })
    )
  })
  it("儲存格攜帶全部六個祖先條件與所選指標，總計不偽造條件", () => {
    const point = matrixSelection(row, column, "net_margin_rate")!
    expect(point.filters).toHaveLength(6)
    expect(point.metric).toBe("net_margin_rate")
    expect(validReportSelection(card, point)).toBe(true)
    expect(matrixSelection(MATRIX_ROOT, MATRIX_ROOT)).toBeNull()
    expect(
      validReportSelection(card, matrixSelection(MATRIX_ROOT, column)!)
    ).toBe(true)
    expect(matrixFilters(row)).not.toEqual(row.path)
    expect(matrixFilters(row)[0]).not.toHaveProperty("label")
  })
  it("不連續或不屬於矩陣的條件不能保留，組合點依完整前綴比較", () => {
    expect(
      validReportSelection(card, {
        label: "跳層",
        filters: [{ dimension: "customer", key: "C1" }],
      })
    ).toBe(false)
    expect(
      validReportSelection(card, {
        label: "其他",
        filters: [{ dimension: "product", key: "P1" }],
      })
    ).toBe(false)
    const point = matrixSelection(row, column)!
    expect(
      pruneReportSelections([{ source_id: "matrix", points: [point] }], {
        name: "資料",
        template: "sales",
        period: "this_month",
        owner_id: null,
        customer_type: null,
        cards: [card],
      })
    ).toHaveLength(1)
  })
  it("展開所有可被單一收合覆寫，暫時檢視不改寫報表", () => {
    const path = matrixFilters(node(row.path.slice(0, 1)))
    const expanded = matrixAllDepth({}, "rows", 3)
    expect(matrixPathExpanded(card, expanded, "rows", path)).toBe(true)
    const collapsed = toggleMatrixPath(expanded, "rows", path, true)
    expect(matrixPathExpanded(card, collapsed, "rows", path)).toBe(false)
    expect(card.matrix).not.toHaveProperty("expanded_rows")
    expect(collapsed.row_page).toBe(1)
  })
  it("階層欄標題正確跨越指標，小計與總計保留完整標題格", () => {
    const year = node(column.path.slice(0, 1), {
      has_children: true,
      expanded: true,
    })
    const quarter = node(column.path.slice(0, 2))
    const headers = matrixHeaders(card, [year, quarter, MATRIX_ROOT], {
      column_expand_depth: 2,
    })
    expect(headers).toHaveLength(2)
    expect(headers[0][0].colSpan).toBe(6)
    expect(headers[0][1].label).toBe("總計")
    expect(headers[0][1].rowSpan).toBe(2)
    expect(headers[1].map((cell) => cell.label)).toEqual(["小計", "第一季"])
    expect(headers[1][1].fullLabel).toBe("2031 年 / 第一季")
    expect(headers[1][1].toggle).toBe(false)
  })
  it("舊矩陣仍可開啟，新矩陣可沒有欄，切換來源清理不相容維度與指標", () => {
    const legacy = { ...card, matrix: undefined }
    expect(reportMatrixOptions(legacy).rows).toEqual(["owner"])
    expect(reportMatrixOptions(legacy).columns).toEqual(["year"])
    const noColumn = normalizeCard({
      ...card,
      matrix: { rows: ["owner"], columns: [], metrics: ["sales"] },
    })
    expect(noColumn.legend).toBeNull()
    const snapshot = normalizeCard({ ...card, metric: "customers" })
    expect(snapshot.matrix?.columns).toEqual([])
    expect(snapshot.matrix?.metrics).toEqual(["customers"])
    expect(normalizeCard({ ...card, visual: "bar" }).matrix).toBeNull()
  })
  it("階層、指標與分頁會改變查詢鍵，更名不會", () => {
    const config = {
      name: "矩陣",
      template: "sales" as const,
      period: "this_month" as const,
      owner_id: null,
      customer_type: null,
      cards: [card],
    }
    expect(
      reportDataKey({ ...config, matrix_views: { matrix: { row_page: 2 } } })
    ).not.toBe(reportDataKey(config))
    expect(
      reportDataKey({
        ...config,
        cards: [{ ...card, matrix: { ...card.matrix!, metrics: ["sales"] } }],
      })
    ).not.toBe(reportDataKey(config))
    expect(
      reportDataKey({ ...config, cards: [{ ...card, title: "新名稱" }] })
    ).toBe(reportDataKey(config))
  })
  it("畫面彙總 CSV 匯出多指標與階層整體值，空比率不寫成零", () => {
    const data: ReportMatrixData = {
      options: reportMatrixOptions(card),
      rows: [row],
      columns: [column],
      totals: { sales: 400, net_margin_rate: 0.5, order_count: 1 },
      cells: [
        {
          row_id: row.id,
          column_id: column.id,
          values: { sales: 400, net_margin_rate: null, order_count: 1 },
          row_count: 1,
          comparisons: {},
        },
        {
          row_id: "[]",
          column_id: "[]",
          values: { sales: 400, net_margin_rate: 0.5, order_count: 1 },
          row_count: 1,
          comparisons: {},
        },
      ],
      row_total: 1,
      column_total: 1,
      row_page: 1,
      column_page: 1,
      row_page_size: 25,
      column_page_size: 10,
      note: "真實總計",
    }
    const csv = reportCsv(card, {
      id: "matrix",
      total: 400,
      points: [],
      note: null,
      matrix: data,
    })
    expect(csv).toContain('"2031 年 / 第一季 / 一月"')
    expect(csv).toContain('"業務甲 / 診所 / 客戶甲","淨毛利率（%）",""')
    expect(csv).toContain('"總計","淨毛利率（%）","","50"')
  })
})

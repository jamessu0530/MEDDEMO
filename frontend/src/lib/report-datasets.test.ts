import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import {
  chartCompatible,
  dataDirty,
  defaultDataChart,
  suggestedDataRecipe,
} from "@/lib/report-datasets"
import { DataTable, ProfileTable } from "@/components/reports/report-datasets"
import type {
  DataAnalysis,
  DataPreview,
  DataRecipe,
  DataSource,
} from "@/api/report-datasets"

const columns = [
  { id: "c1", name: "客戶編號", kind: "text" as const },
  { id: "c2", name: "金額", kind: "number" as const },
]
const recipe: DataRecipe = {
  columns: columns.map((column) => ({ ...column, include: true })),
  trim: true,
  drop_blank: true,
  deduplicate: false,
  invalid: "reject",
}
const source = { id: "test", name: "訂單", recipe, columns } as DataSource

describe("匯入資料報表", () => {
  it("數值資料可聚合，只有文字時使用列數，保留實際欄位識別碼", () => {
    const chart = defaultDataChart(columns)
    expect(chart).toMatchObject({
      group_by: "c1",
      value: "c2",
      aggregation: "sum",
    })
    expect(defaultDataChart(columns.slice(0, 1))).toMatchObject({
      group_by: "c1",
      value: null,
      aggregation: "count",
    })
  })
  it("AI 建議只進入草稿，不移除欄位或更改使用者的清理選項", () => {
    const original = {
      ...recipe,
      deduplicate: true,
      columns: [{ ...recipe.columns[0], include: false }, recipe.columns[1]],
    }
    const analysis = {
      columns: [{ id: "c1", name: "編號", kind: "text", reason: "保留前導零" }],
    } as DataAnalysis
    const next = suggestedDataRecipe(original, analysis)
    expect(next.columns[0]).toMatchObject({
      id: "c1",
      name: "編號",
      include: false,
    })
    expect(next.deduplicate).toBe(true)
    expect(original.columns[0].name).toBe("客戶編號")
  })
  it("欄位移除或型別變更前，辨識受到影響的圖表與篩選", () => {
    const chart = defaultDataChart(columns)
    expect(chartCompatible(chart, columns)).toBe(true)
    expect(chartCompatible(chart, columns.slice(0, 1))).toBe(false)
    expect(
      chartCompatible(
        chart,
        columns.map((column) => ({ ...column, kind: "text" }))
      )
    ).toBe(false)
    expect(
      chartCompatible(
        {
          ...chart,
          filters: [{ column: "missing", operator: "eq", value: "1" }],
        },
        columns
      )
    ).toBe(false)
  })
  it("改名及整理設定會觸發未儲存保護", () => {
    expect(dataDirty(source, structuredClone(recipe), "訂單")).toBe(false)
    expect(dataDirty(source, recipe, "新訂單")).toBe(true)
    expect(dataDirty(source, { ...recipe, deduplicate: true }, "訂單")).toBe(
      true
    )
  })
  it("預覽以文字呈現檔案內容，顯示前導零、空值及全表統計", () => {
    const preview: DataPreview = {
      columns,
      rows: [
        ["001", 1200],
        ["<script>alert(1)</script>", null],
      ],
      row_count: 100,
      page: 1,
      page_size: 50,
      profiles: [
        {
          ...columns[1],
          empty: 1,
          distinct: 99,
          examples: ["1200"],
          top: [],
          sum: 9900,
          average: 100,
        },
      ],
      changes: null,
    }
    const table = renderToStaticMarkup(createElement(DataTable, { preview }))
    expect(table).toContain("001")
    expect(table).toContain("&lt;script&gt;")
    expect(table).not.toContain("<script>")
    expect(table).toContain("空白")
    const profiles = renderToStaticMarkup(
      createElement(ProfileTable, { preview })
    )
    expect(profiles).toContain("100 列")
    expect(profiles).toContain("9,900")
  })
})

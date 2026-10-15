import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReportChart } from "@/components/reports/report-chart"
import { ReportMatrix } from "@/components/reports/report-matrix"
import { ReportFormatFields } from "@/components/reports/report-format-fields"
import { matrixPathId } from "@/lib/report-matrix"
import {
  reportMatrixOptions,
  type CardData,
  type ReportCard,
  type ReportMatrixData,
  type ReportMatrixNode,
  type ReportVisual,
} from "@/lib/reports"

const card: ReportCard = {
  id: "sales",
  title: "業績",
  metric: "sales",
  dimension: "month",
  visual: "column",
  limit: 5,
  format: {
    numbers: { sales: { unit: "none", decimals: 1 } },
    conditional: {
      sales: {
        color_mode: "rules",
        rules: [
          { minimum: null, maximum: 200, color: "#112233" },
          { minimum: 200, maximum: null, color: "#445566" },
        ],
      },
    },
    axes: {
      show_x: false,
      show_y: false,
      show_grid: false,
      show_titles: true,
      x_title: "交易月份",
      y_title: "銷售額",
    },
  },
}
const data: CardData = {
  id: "sales",
  total: 400,
  row_count: 3,
  points: [
    {
      key: "2031-03",
      label: "2031/03",
      value: 100,
      row_count: 1,
      secondary_value: 0.1,
    },
    {
      key: "2031-04",
      label: "2031/04",
      value: 300,
      row_count: 2,
      secondary_value: 0.3,
    },
  ],
  note: null,
}

describe("報表格式呈現", () => {
  it("前期、差額與聯動數值沿用指標的顯示單位", () => {
    const styled: ReportCard = {
      ...card,
      format: { numbers: { sales: { unit: "thousand", decimals: 1 } } },
    }
    const supplied: CardData = {
      ...data,
      comparison: {
        mode: "previous_month",
        start: "2031-02-01",
        end: "2031-02-28",
        note: "相同條件",
        value: {
          previous: 1000,
          delta: -600,
          relative_change: -0.6,
          previous_rows: 2,
          status: "ok",
        },
      },
      highlight: {
        total: 100,
        points: [data.points[0], { ...data.points[1], value: 0 }],
        comparison: null,
      },
    }
    const html = renderToStaticMarkup(
      createElement(ReportChart, { card: styled, data: supplied })
    )
    expect(html).toContain("前期 1.0 千元")
    expect(html).toContain("差額 -0.6 千元")
    expect(html).toContain("聯動選取合計：0.1 千元")
    expect(html).toContain("業績：400 元")
  })
  it("散佈圖在主指標沒有色彩規則時使用第二指標規則", () => {
    const styled: ReportCard = {
      ...card,
      visual: "scatter",
      secondary_metric: "net_margin_rate",
      format: {
        metric_colors: { net_margin_rate: "#ff0000" },
        conditional: {
          net_margin_rate: {
            color_mode: "rules",
            rules: [{ minimum: 0.2, maximum: null, color: "#ff00aa" }],
          },
        },
      },
    }
    const html = renderToStaticMarkup(
      createElement(ReportChart, { card: styled, data })
    )
    expect(html).toMatch(/<circle[^>]*fill="#ff00aa"/)
    expect(html).toMatch(/data-axis="y"[^>]*fill:#ff0000/)
    const primary = renderToStaticMarkup(
      createElement(ReportChart, {
        card: {
          ...styled,
          format: {
            ...styled.format,
            conditional: {
              ...styled.format!.conditional,
              sales: card.format!.conditional!.sales,
            },
          },
        },
        data,
      })
    )
    expect(primary).toMatch(/<circle[^>]*fill="#445566"/)
    expect(primary).not.toMatch(/<circle[^>]*fill="#ff00aa"/)
  })
  it.each([
    "bar",
    "column",
    "stacked_bar",
    "stacked_column",
    "percent_bar",
    "percent_column",
    "line",
    "area",
    "pie",
    "donut",
    "treemap",
    "combo",
    "scatter",
  ] as ReportVisual[])("%s 的色彩與顯示設定不改變資料", (visual) => {
    const stacked = visual.startsWith("stacked") || visual.startsWith("percent")
    const shaped = {
      ...card,
      visual,
      legend: stacked ? ("owner" as const) : null,
      secondary_metric: ["combo", "scatter"].includes(visual)
        ? ("net_margin_rate" as const)
        : null,
    }
    const supplied = stacked
      ? {
          ...data,
          series: [{ key: "S1", label: "業務甲", points: data.points }],
        }
      : data
    const html = renderToStaticMarkup(
      createElement(ReportChart, {
        card: shaped,
        data: supplied,
        onSelectData: () => undefined,
      })
    )
    expect(html).not.toMatch(/NaN|Infinity/)
    expect(html).toContain("400.0 元")
    const drawing = html.split("<details")[0]
    expect(drawing).toContain("#112233")
    expect(drawing).toContain("#445566")
    expect(data.total).toBe(400)
    expect(data.points[0].value).toBe(100)
    if (["column", "line", "area", "combo", "scatter"].includes(visual)) {
      expect(html).toMatch(/data-axis="x"[^>]*display:none/)
      expect(html).toMatch(/data-axis="y"[^>]*display:none/)
      expect(html).toContain("交易月份")
      expect(html).toContain("銷售額")
    }
  })
  it("數字卡與資料表套用精度和條件色彩，資料條保留可讀原值", () => {
    const kpi = renderToStaticMarkup(
      createElement(ReportChart, {
        card: { ...card, visual: "kpi", dimension: "none" },
        data,
      })
    )
    expect(kpi).toContain("400.0 元")
    expect(kpi).toContain("background-color:#445566")
    const table = renderToStaticMarkup(
      createElement(ReportChart, {
        card: {
          ...card,
          visual: "table",
          format: {
            ...card.format,
            conditional: {
              sales: {
                ...card.format!.conditional!.sales,
                data_bars: true,
                show_bar_value: false,
              },
            },
          },
        },
        data,
      })
    )
    expect(table).toContain("100.0 元")
    expect(table).toContain("report-value-text")
    expect(table).toContain("sr-only")
    expect(table).toContain("width:100%")
    expect(table).toContain("符合條件資料 2 筆")
  })
  it("關閉 tooltip 保留資料點鍵盤與原值，雙指標有獨立格式和配色", () => {
    const styled = {
      ...card,
      visual: "combo" as const,
      secondary_metric: "net_margin_rate" as const,
      format: {
        ...card.format,
        numbers: {
          sales: { unit: "thousand" as const, decimals: 2 },
          net_margin_rate: { decimals: 1 },
        },
        metric_colors: { net_margin_rate: "#ff0000" },
        tooltip: { show: false },
      },
    }
    const html = renderToStaticMarkup(
      createElement(ReportChart, {
        card: styled,
        data,
        onSelectData: () => undefined,
        expanded: true,
      })
    )
    expect(html).toContain("0.40 千元")
    expect(html).toContain("10.0%")
    expect(html).toContain("#ff0000")
    expect(html).toContain('tabindex="0"')
    expect(html).not.toContain("符合條件資料")
    expect(html).not.toContain('title="2031/03')
  })
  it("矩陣使用完整色階範圍與每個指標格式，父層色彩可獨立控制", () => {
    const matrixCard: ReportCard = {
      ...card,
      visual: "matrix",
      dimension: "customer",
      legend: null,
      matrix: {
        rows: ["customer"],
        columns: [],
        metrics: ["sales", "net_margin_rate"],
      },
      format: {
        numbers: {
          sales: { unit: "none", decimals: 2 },
          net_margin_rate: { decimals: 1 },
        },
        conditional: {
          sales: {
            color_mode: "gradient",
            minimum: 0,
            maximum: 400,
            low_color: "#000000",
            high_color: "#ffffff",
            data_bars: true,
          },
          net_margin_rate: {
            color_mode: "rules",
            rules: [{ minimum: 0, maximum: 1, color: "#259688" }],
          },
        },
      },
    }
    const row: ReportMatrixNode = {
      id: matrixPathId([{ dimension: "customer", key: "C1" }]),
      path: [{ dimension: "customer", key: "C1", label: "客戶甲" }],
      label: "客戶甲",
      depth: 1,
      has_children: false,
      expanded: false,
      show_values: true,
    }
    const matrix: ReportMatrixData = {
      options: reportMatrixOptions(matrixCard),
      rows: [row],
      columns: [],
      cells: [
        {
          row_id: row.id,
          column_id: "[]",
          values: { sales: 100, net_margin_rate: 0.5069 },
          row_count: 1,
          comparisons: {},
        },
        {
          row_id: "[]",
          column_id: "[]",
          values: { sales: 100, net_margin_rate: 0.5069 },
          row_count: 1,
          comparisons: {},
        },
      ],
      totals: { sales: 100, net_margin_rate: 0.5069 },
      format_domains: { sales: { minimum: 0, maximum: 400 } },
      row_total: 100,
      column_total: 0,
      row_page: 1,
      column_page: 1,
      row_page_size: 25,
      column_page_size: 10,
      note: "全範圍",
    }
    const html = renderToStaticMarkup(
      createElement(ReportMatrix, {
        card: matrixCard,
        data: matrix,
        onSelect: () => undefined,
      })
    )
    expect(html).toContain("100.00 元")
    expect(html).toContain("50.7%")
    expect(html).toContain("客戶甲 · 淨毛利率：50.69% · 符合條件資料 1 筆")
    // 無欄矩陣的指標欄是值，列總計才依 apply_totals 控制。
    expect(html).toContain("background-color:#404040")
    expect(html).toContain("background-color:#259688")
    const all = renderToStaticMarkup(
      createElement(ReportMatrix, {
        card: {
          ...matrixCard,
          format: {
            ...matrixCard.format,
            conditional: {
              sales: {
                ...matrixCard.format!.conditional!.sales,
                apply_totals: true,
              },
            },
          },
        },
        data: matrix,
      })
    )
    expect(all).toContain("background-color:#404040")
    expect(all).toContain("width:25%")
  })
  it("編輯器提供各指標、規則範圍、數值、軸與 tooltip 選項", () => {
    const html = renderToStaticMarkup(
      createElement(ReportFormatFields, {
        card,
        data,
        onChange: () => undefined,
      })
    )
    expect(html).toContain("數值")
    expect(html).toContain("條件式格式")
    expect(html).toContain("規則 1下限")
    expect(html).toContain("顯示 X 軸標籤")
    expect(html).toContain("顯示 Tooltip")
    expect(html).toContain("千分位分隔")
  })
})

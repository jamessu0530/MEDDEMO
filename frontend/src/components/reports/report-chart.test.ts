import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ReportChart } from "@/components/reports/report-chart"
import {
  VISUALS,
  chartSelection,
  type CardData,
  type ReportCard,
  type ReportVisual,
} from "@/lib/reports"
import { ReportVisualIcon } from "@/components/reports/report-visual-icon"

function card(patch: Partial<ReportCard> = {}): ReportCard {
  return {
    id: "sales",
    title: "客戶業績",
    metric: "sales",
    dimension: "customer",
    visual: "bar",
    limit: 3,
    ...patch,
  }
}

function render(
  values: number[],
  cardPatch: Partial<ReportCard> = {},
  dataPatch: Partial<CardData> = {}
) {
  const data: CardData = {
    id: "sales",
    total: values.reduce((sum, value) => sum + value, 0),
    points: values.map((value, index) => ({
      key: `row-${index}`,
      label: `客戶 ${index + 1}`,
      value,
    })),
    note: null,
    ...dataPatch,
  }
  return renderToStaticMarkup(
    createElement(ReportChart, { card: card(cardPatch), data })
  )
}

describe("ReportChart", () => {
  it("資料點的可讀名稱說明目前是下鑽或逐筆明細動作", () => {
    for (const label of ["下鑽", "查看逐筆明細"]) {
      const html = renderToStaticMarkup(
        createElement(ReportChart, {
          card: card({ visual: "column" }),
          data: {
            id: "sales",
            total: 100,
            points: [{ key: "C1", label: "診所", value: 100 }],
            note: null,
          },
          onSelectData: () => undefined,
          pointActionLabel: label,
        })
      )
      expect(html).toContain(`點選${label}`)
      expect(html).not.toContain("點選篩選")
    }
  })
  it("系列資料點與矩陣儲存格同時攜帶主分組和圖例", () => {
    const point = { key: "2031-04", label: "2031/04", value: 100 }
    expect(
      chartSelection(card({ dimension: "month", legend: "owner" }), point, {
        key: "u01",
        label: "業務甲",
      })
    ).toEqual({
      label: "2031/04 / 業務甲",
      filters: [
        { dimension: "month", key: "2031-04" },
        { dimension: "owner", key: "u01" },
      ],
    })
  })
  it("醒目提示保留完整合計並提供實際選取金額，包含負值", () => {
    const html = render(
      [100, -50],
      { metric: "net_margin", interaction: "highlight" },
      {
        total: 50,
        highlight: {
          total: -20,
          points: [
            { key: "row-0", label: "客戶 1", value: 0 },
            { key: "row-1", label: "客戶 2", value: -20 },
          ],
        },
      }
    )
    expect(html).toContain('title="所選範圍 · 淨毛利：50 元"')
    expect(html).toContain("聯動選取合計：-20 元")
    expect(html).toContain("選取 -20 元")
  })
  it("排行榜只列前幾名，但合計仍是完整範圍，精確值也能閱讀", () => {
    const html = render([100000, 50000, 25000], {}, { total: 270003.25 })
    expect(html).toContain("所選範圍合計")
    expect(html).toContain("27 萬")
    expect(html).toContain("270,003.25 元")
    expect(html).toContain("100,000 元")
    expect(html).not.toContain(">17.5 萬<")
  })

  it("虧損長條位於零線左側，正數位於右側", () => {
    const html = render([-30, 0, 90], { metric: "net_margin" })
    expect(html).toContain("-30 元")
    expect(html).toContain('style="left:25%"')
    expect(html).toContain('style="left:0%;width:25%;')
    expect(html).toContain('style="left:25%;width:75%')
    expect(html).toContain("bg-destructive/80")
  })

  it.each([
    { label: "全部為負", values: [-100, -50] },
    { label: "全部為零", values: [0, 0, 0] },
    { label: "正負混合", values: [-100, 0, 100] },
  ])("$label 時，每根長條都在圖表範圍內且沒有非法座標", ({ values }) => {
    const html = render(values, { metric: "net_margin" })
    expect(html).not.toMatch(/NaN|Infinity/)
    const bars = [...html.matchAll(/style="left:([-\d.]+)%;width:([-\d.]+)%/g)]
    expect(bars).toHaveLength(values.length)
    for (const [, left, width] of bars) {
      expect(Number(left)).toBeGreaterThanOrEqual(0)
      expect(Number(width)).toBeGreaterThanOrEqual(0)
      expect(Number(left) + Number(width)).toBeLessThanOrEqual(100)
    }
    if (values.every((value) => value === 0))
      expect(bars.every(([, , width]) => Number(width) === 0)).toBe(true)
  })

  it("沒有資料時顯示可操作的空狀態，合計仍為零", () => {
    const html = render([])
    expect(html).toContain("目前範圍沒有資料")
    expect(html).toContain("可以調整期間或篩選條件")
    expect(html).toContain("0 元")
    expect(html).not.toContain("<ol")
  })

  it("精確貨幣最多兩位小數，不把浮點數誤差展開到手機畫面", () => {
    const html = render([0.1 + 0.2, 1234567.895], { visual: "table" })
    expect(html).toContain("0.3 元")
    expect(html).toContain("1,234,567.9 元")
    expect(html).not.toContain("0.30000000000000004")
    expect(html).not.toContain("1234567.895")
  })

  it("數字卡使用完整合計，零客戶數仍有正確單位", () => {
    const html = render([], {
      metric: "customers",
      visual: "kpi",
      dimension: "none",
    })
    expect(html).toContain("0 家")
    expect(html).not.toContain("目前範圍沒有資料")
  })

  it("月份趨勢保留每個月的可讀數值，不受排行筆數限制", () => {
    const points = Array.from({ length: 12 }, (_, index) => ({
      key: `2026-${index + 1}`,
      label: `2026/${String(index + 1).padStart(2, "0")}`,
      value: index === 0 ? -100 : index * 100,
    }))
    const html = render(
      [],
      { metric: "net_margin", visual: "line", dimension: "month", limit: 3 },
      { points, total: 6500 }
    )
    expect(html).toContain("<polyline")
    expect(html).toContain("<details")
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/)
    expect(html).toContain("查看分組彙總數值")
    expect(html).toContain("<table")
    expect(
      html.match(/<tbody[^>]*>(.*?)<\/tbody>/)?.[1].match(/<tr>/g)
    ).toHaveLength(12)
    for (const point of points) expect(html).toContain(point.label)
    expect(html).toContain("-100 元")
    expect(html).toContain("1,100 元")
    expect(html).not.toMatch(/NaN|Infinity/)
  })

  it.each([[0, 0], [-100, -200], [0], [100]])(
    "零、虧損與單月趨勢都保留有限座標：%j",
    (...values) => {
      const html = render(values, {
        visual: "line",
        dimension: "month",
        metric: "net_margin",
      })
      expect(html).not.toMatch(/NaN|Infinity/)
      const circles = [
        ...html.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/g),
      ]
      const bounds = html.match(/viewBox="0 0 (\d+) (\d+)"/)
      expect(bounds).not.toBeNull()
      expect(circles).toHaveLength(values.length)
      for (const [, x, y] of circles) {
        expect(Number(x)).toBeGreaterThanOrEqual(0)
        expect(Number(x)).toBeLessThanOrEqual(Number(bounds?.[1]))
        expect(Number(y)).toBeGreaterThanOrEqual(0)
        expect(Number(y)).toBeLessThanOrEqual(Number(bounds?.[2]))
      }
    }
  )
})

describe("Power BI 圖表呈現", () => {
  const data: CardData = {
    id: "sales",
    total: 600,
    points: [
      { key: "2026-09", label: "2026/09", value: 100, secondary_value: 10 },
      { key: "2026-10", label: "2026/10", value: 200, secondary_value: -20 },
    ],
    series: [
      {
        key: "chain",
        label: "連鎖藥局",
        points: [
          { key: "2026-09", label: "2026/09", value: 25 },
          { key: "2026-10", label: "2026/10", value: 50 },
        ],
      },
      {
        key: "clinic",
        label: "診所",
        points: [
          { key: "2026-09", label: "2026/09", value: 75 },
          { key: "2026-10", label: "2026/10", value: 150 },
        ],
      },
    ],
    note: null,
  }
  const visuals = Object.keys(VISUALS) as ReportVisual[]
  function visualHtml(
    visual: ReportVisual,
    patch: Partial<ReportCard> = {},
    supplied = data,
    expanded = false
  ) {
    const multiple = [
      "stacked_bar",
      "stacked_column",
      "percent_bar",
      "percent_column",
      "matrix",
      "line",
      "area",
    ].includes(visual)
    return renderToStaticMarkup(
      createElement(ReportChart, {
        card: card({
          visual,
          dimension: "month",
          legend: multiple ? "customer_type" : null,
          secondary_metric:
            visual === "combo" || visual === "scatter" ? "net_margin" : null,
          color: "#123456",
          ...patch,
        }),
        data: multiple ? supplied : { ...supplied, series: undefined },
        expanded,
      })
    )
  }

  it.each(visuals)("%s 呈現對應圖形且保留完整合計", (visual) => {
    const html = visualHtml(visual)
    expect(html).toContain("600 元")
    expect(html).not.toMatch(/NaN|Infinity/)
    const shape: Record<ReportVisual, string> = {
      kpi: "所選範圍合計",
      bar: "<ol",
      column: "<rect",
      stacked_bar: "連鎖藥局",
      stacked_column: "<rect",
      percent_bar: "25%",
      percent_column: "75%",
      line: "<polyline",
      area: "<polygon",
      pie: "<path",
      donut: "圖中分類合計",
      treemap: "<rect",
      combo: "<polyline",
      scatter: "<circle",
      table: "<table",
      matrix: "連鎖藥局",
    }
    expect(html).toContain(shape[visual])
  })

  it("圖表選單有 16 個不同圖示", () => {
    const icons = visuals.map((visual) =>
      renderToStaticMarkup(createElement(ReportVisualIcon, { visual }))
    )
    expect(icons).toHaveLength(16)
    expect(new Set(icons).size).toBe(16)
  })

  it("堆疊圖使用每個真實系列的數值，百分比以各分類合計計算", () => {
    const percent = visualHtml("percent_bar")
    expect(percent).toContain("連鎖藥局 · 業績：25 元 · 圖中占比 25%")
    expect(percent).toContain("診所 · 業績：75 元 · 圖中占比 75%")
    expect(percent).toContain("連鎖藥局 · 業績：50 元 · 圖中占比 25%")
    expect(percent).toContain("診所 · 業績：150 元 · 圖中占比 75%")
    expect(percent).toContain("每個分類合計為 100%")
    const stacked = visualHtml("stacked_column")
    expect(stacked.match(/<rect /g)).toHaveLength(4)
    expect(stacked).toContain("50 元")
    expect(stacked).toContain("150 元")
  })

  it("矩陣欄位使用系列名稱與對應列值，缺少的分類交叉值是零", () => {
    const supplied = {
      ...data,
      series: [
        { ...data.series![0], points: data.series![0].points.slice(0, 1) },
        data.series![1],
      ],
    }
    const html = visualHtml("matrix", {}, supplied)
    expect(html).toContain("連鎖藥局")
    expect(html).toContain("診所")
    expect(html).toContain("合計")
    const rows = html.match(/<tbody[^>]*>(.*?)<\/tbody>/)?.[1]
    expect(rows).toContain("25 元")
    expect(rows).toContain("75 元")
    expect(rows).toContain("0 元")
    expect(rows).toContain("150 元")
    expect(rows).toContain("200 元")
  })

  it.each([
    "pie",
    "donut",
    "treemap",
    "percent_bar",
    "percent_column",
  ] as ReportVisual[])("%s 遇到负值明確解釋，不畫誤導的占比", (visual) => {
    const supplied = {
      ...data,
      points: [{ key: "loss", label: "虧損", value: -10 }],
      series: [
        {
          key: "clinic",
          label: "診所",
          points: [{ key: "loss", label: "虧損", value: -10 }],
        },
      ],
    }
    const html = visualHtml(visual, { metric: "net_margin" }, supplied)
    expect(html).toContain('role="status"')
    expect(html).toContain("負值")
    expect(html).toContain("-10 元")
    expect(html).not.toContain("<rect")
    expect(html).not.toContain("<circle")
  })

  it.each(["pie", "donut", "treemap"] as ReportVisual[])(
    "%s 全部為零時不創造假占比",
    (visual) => {
      const html = visualHtml(
        visual,
        {},
        { ...data, points: [{ key: "zero", label: "零", value: 0 }] }
      )
      expect(html).toContain("分類數值皆為 0")
      expect(html).not.toContain("100%")
      expect(html).not.toMatch(/NaN|Infinity/)
    }
  )

  it("圓餅百分比以顯示分類合計，與完整範圍合計清楚區別", () => {
    const html = visualHtml("pie")
    expect(html).toContain("33.3%")
    expect(html).toContain("66.7%")
    expect(html).toContain("600 元")
    expect(html).toContain("占比以圖中分類合計計算")
  })

  it("組合圖具有兩個獨立數值軸，使用真實負值第二指標", () => {
    const html = visualHtml("combo")
    expect(html).toContain("業績（左軸）與淨毛利（右軸），兩軸刻度獨立")
    expect(html).toContain("淨毛利：-20 元")
    expect(html).toContain("<rect")
    expect(html).toContain("<polyline")
  })

  it("散佈圖使用實際第二指標座標，不依索引製造數字", () => {
    const html = visualHtml("scatter")
    const circles = [...html.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/g)]
    expect(circles).toHaveLength(2)
    expect(Number(circles[0][1])).toBeLessThan(Number(circles[1][1]))
    // First point has 10 in y, second has -20: SVG y increases downward.
    expect(Number(circles[0][2])).toBeLessThan(Number(circles[1][2]))
    expect(html).toContain("淨毛利：-20 元")
    const missing = visualHtml(
      "scatter",
      {},
      {
        ...data,
        points: data.points.map((point) => ({
          ...point,
          secondary_value: null,
        })),
      }
    )
    expect(missing).toContain("沒有第二指標")
    expect(missing).not.toContain("<circle")
  })

  it("折線與面積圖使用實際系列，可關閉圖例與資料標籤", () => {
    const line = visualHtml("line")
    expect(line.match(/<polyline /g)).toHaveLength(2)
    expect(line).toContain('aria-label="圖例"')
    expect(line).toContain("連鎖藥局")
    const area = visualHtml("area", { show_legend: false, show_labels: false })
    expect(area.match(/<polygon /g)).toHaveLength(2)
    expect(area).not.toContain('aria-label="圖例"')
    expect(area).toContain('fill="#123456"')
  })

  it("目標擴充圖表刻度，並有可讀數值與 KPI 達成率", () => {
    const column = visualHtml("column", { target: 1000 })
    expect(column).toContain("目標：1,000 元")
    expect(column).toContain('stroke-dasharray="5 3"')
    const kpi = visualHtml("kpi", { target: 1000 })
    expect(kpi).toContain("60%")
    const zero = visualHtml("kpi", { target: 0 })
    expect(zero).not.toMatch(/Infinity|NaN/)
  })

  it("展開後直接顯示完整資料表，圖形可用鍵盤選取且顯示選取狀態", () => {
    const html = renderToStaticMarkup(
      createElement(ReportChart, {
        card: card({ visual: "column" }),
        data: { ...data, series: undefined },
        expanded: true,
        selectedKey: "2026-09",
        onSelectPoint: () => {},
      })
    )
    expect(html).toContain("<table")
    expect(html).not.toContain("<details")
    expect(html).toContain('role="button" tabindex="0"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain("點選篩選")
  })

  it("占比圖高度與水平長條列距可以依卡片設定調整", () => {
    expect(visualHtml("pie", { height: "compact" })).toContain(
      'viewBox="0 0 360 150"'
    )
    expect(visualHtml("pie", { height: "tall" })).toContain(
      'viewBox="0 0 360 260"'
    )
    expect(visualHtml("bar", { height: "compact" })).toContain("space-y-2")
    expect(visualHtml("bar", { height: "tall" })).toContain("space-y-5")
  })
})

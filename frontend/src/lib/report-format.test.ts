import { describe, expect, it } from "vitest"
import {
  reportBarGeometry,
  reportCellStyle,
  reportConditionalColor,
  reportDisplayValue,
  reportFormatDomain,
  reportSeriesColor,
  reportTooltip,
} from "@/lib/report-format"
import {
  formatReportValue,
  reportDataKey,
  type CardData,
  type ReportCard,
} from "@/lib/reports"

const card: ReportCard = {
  id: "sales",
  title: "業績",
  metric: "sales",
  dimension: "customer",
  visual: "bar",
  limit: 5,
}
const domain = { minimum: -100, maximum: 300 }
describe("報表格式計算", () => {
  it("修改自動格式的分隔符不會把彙總表縮放或改變數字卡的自動精度", () => {
    const styled: ReportCard = {
      ...card,
      format: { numbers: { sales: { grouping: false } } },
    }
    expect(reportDisplayValue(styled, 14500.25)).toBe("14500.25 元")
    expect(reportDisplayValue(styled, 1234.567, "sales", "compact")).toBe(
      "1235 元"
    )
    expect(reportDisplayValue(styled, 14500.25, "sales", "compact")).toBe(
      "1.5 萬元"
    )
  })
  it("舊設定保留原始顯示，縮放與精度僅影響呈現", () => {
    expect(reportDisplayValue(card, 14500, "sales", "compact")).toBe(
      formatReportValue(14500, "sales")
    )
    const formatted = {
      ...card,
      format: {
        numbers: {
          sales: {
            unit: "ten_thousand" as const,
            decimals: 3,
            grouping: false,
          },
          net_margin_rate: { decimals: 1 },
        },
      },
    }
    expect(reportDisplayValue(formatted, 14500)).toBe("1.450 萬元")
    expect(reportDisplayValue(formatted, -14500)).toBe("-1.450 萬元")
    expect(reportDisplayValue(formatted, 0.506896, "net_margin_rate")).toBe(
      "50.7%"
    )
    expect(reportDisplayValue(formatted, null)).toBe("無法計算")
    expect(
      reportDisplayValue(
        {
          ...card,
          format: {
            numbers: {
              sales: {
                unit: "none",
                decimals: 2,
                show_unit: false,
                grouping: false,
              },
            },
          },
        },
        1234.567
      )
    ).toBe("1234.57")
  })
  it("配色依編號而非排序位置保存，指標與圖例可獨立配色", () => {
    const styled = {
      ...card,
      legend: "owner" as const,
      format: {
        series_colors: [
          { dimension: "owner" as const, key: "S1", color: "#112233" },
        ],
        metric_colors: { sales: "#334455" },
      },
    }
    expect(reportSeriesColor(styled, "S1", 0)).toBe("#112233")
    expect(reportSeriesColor(styled, "S1", 4)).toBe("#112233")
    expect(reportSeriesColor(styled, "S2", 1)).not.toBe("#334455")
    expect(reportSeriesColor(styled, "primary", 1, "none")).toBe("#334455")
  })
  it("規則包含下限不包含上限，重疊先取第一條，null 不著色", () => {
    const styled = {
      ...card,
      format: {
        conditional: {
          sales: {
            color_mode: "rules" as const,
            rules: [
              { minimum: 0, maximum: 100, color: "#112233" },
              { minimum: 50, maximum: null, color: "#445566" },
            ],
          },
        },
      },
    }
    expect(reportConditionalColor(styled, 50, domain)).toBe("#112233")
    expect(reportConditionalColor(styled, 100, domain)).toBe("#445566")
    expect(reportConditionalColor(styled, -1, domain)).toBeUndefined()
    expect(reportConditionalColor(styled, null, domain)).toBeUndefined()
    expect(
      reportConditionalColor(styled, 50, domain, "sales", true)
    ).toBeUndefined()
  })
  it("連續色階有穩定中間色與邊界，常數範圍不除零", () => {
    const styled = {
      ...card,
      format: {
        conditional: {
          sales: {
            color_mode: "gradient" as const,
            low_color: "#000000",
            high_color: "#ffffff",
            minimum: 0,
            maximum: 100,
            apply_totals: true,
          },
        },
      },
    }
    expect(reportConditionalColor(styled, 50, domain)).toBe("#808080")
    expect(reportConditionalColor(styled, -100, domain)).toBe("#000000")
    expect(reportConditionalColor(styled, 1000, domain)).toBe("#ffffff")
    expect(reportCellStyle(styled, 0, domain)).toEqual({
      backgroundColor: "#000000",
      color: "#ffffff",
    })
    const constant = {
      ...card,
      format: {
        conditional: {
          sales: {
            color_mode: "gradient" as const,
            low_color: "#000000",
            high_color: "#ffffff",
          },
        },
      },
    }
    expect(
      reportConditionalColor(constant, 5, { minimum: 5, maximum: 5 })
    ).toBe("#808080")
  })
  it("正負資料條共用零軸，手動邊界截長度而不改原值，null 不畫", () => {
    const styled = {
      ...card,
      format: {
        conditional: {
          sales: {
            data_bars: true,
            bar_minimum: -100,
            bar_maximum: 300,
            show_bar_value: false,
          },
        },
      },
    }
    expect(reportBarGeometry(styled, -100, domain)).toMatchObject({
      left: 0,
      width: 25,
      zero: 25,
      showValue: false,
      clipped: false,
    })
    expect(reportBarGeometry(styled, 300, domain)).toMatchObject({
      left: 25,
      width: 75,
      zero: 25,
    })
    expect(reportBarGeometry(styled, 1000, domain)).toMatchObject({
      width: 75,
      clipped: true,
    })
    expect(reportBarGeometry(styled, 0, domain)).toMatchObject({
      width: 0,
      clipped: false,
    })
    expect(reportBarGeometry(styled, null, domain)).toBeNull()
  })
  it("矩陣使用完整分組範圍，不用目前頁面的總計定義刻度", () => {
    const data: CardData = {
      id: "sales",
      total: 999999,
      points: [{ key: "C1", label: "甲", value: 30 }],
      note: null,
      matrix: {
        options: { rows: ["customer"], columns: [], metrics: ["sales"] },
        rows: [],
        columns: [],
        cells: [],
        totals: { sales: 999999 },
        row_total: 100,
        column_total: 0,
        row_page: 1,
        column_page: 1,
        row_page_size: 25,
        column_page_size: 10,
        note: "",
        format_domains: { sales: { minimum: 10, maximum: 700 } },
      },
    }
    expect(reportFormatDomain(card, data)).toEqual({
      minimum: 10,
      maximum: 700,
    })
    expect(reportFormatDomain(card, { ...data, matrix: null })).toEqual({
      minimum: 30,
      maximum: 30,
    })
  })
  it("tooltip 保留原始單位與完整路徑，筆數和選取資訊可單獨關閉", () => {
    const styled = {
      ...card,
      format: {
        numbers: { sales: { unit: "ten_thousand" as const, decimals: 0 } },
        tooltip: { show_rows: false },
      },
    }
    const text = reportTooltip(
      styled,
      { label: "客戶完整名稱 / 商品甲", value: 14500, row_count: 7 },
      { share: 0.5, highlight: 100 }
    )!
    expect(text).toContain("14,500 元")
    expect(text).toContain("客戶完整名稱 / 商品甲")
    expect(text).toContain("圖中占比 50%")
    expect(text).toContain("聯動選取 100 元")
    expect(text).not.toContain("7 筆")
    expect(
      reportTooltip(
        { ...card, format: { tooltip: { show: false } } },
        { label: "甲", value: 1 }
      )
    ).toBeUndefined()
    const missing = reportTooltip(
      card,
      { label: "客戶甲", value: 100 },
      {
        comparison: {
          previous: null,
          delta: null,
          relative_change: null,
          previous_rows: 0,
          status: "no_previous_data",
        },
      }
    )
    expect(missing).toContain("前期 無比較資料")
    expect(missing).not.toContain("前期 無法計算")
  })
  it("格式不更動資料查詢鍵、排序或權限條件", () => {
    const config = {
      name: "分析",
      template: "sales" as const,
      period: "this_month" as const,
      owner_id: null,
      customer_type: null,
      cards: [card],
    }
    expect(
      reportDataKey({
        ...config,
        cards: [
          {
            ...card,
            format: {
              numbers: { sales: { decimals: 6 } },
              conditional: { sales: { data_bars: true } },
              axes: { show_y: false },
            },
          },
        ],
      })
    ).toBe(reportDataKey(config))
  })
})

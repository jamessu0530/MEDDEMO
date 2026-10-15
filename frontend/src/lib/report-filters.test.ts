import { describe, expect, it } from "vitest"
import {
  dateRangeError,
  emptyFilterOptions,
  filterOptionLabel,
  searchFilterOptions,
  setReportSlicer,
  reportPeriodRange,
} from "@/lib/report-filters"
import { normalizeCard, reportDataKey, type ReportConfig } from "@/lib/reports"

function config(patch: Partial<ReportConfig> = {}): ReportConfig {
  return {
    name: "報表",
    template: "sales",
    period: "this_month",
    owner_id: null,
    customer_type: null,
    cards: [
      {
        id: "card",
        title: "業績",
        metric: "sales",
        dimension: "customer",
        visual: "bar",
        limit: 5,
      },
    ],
    ...patch,
  }
}

describe("日期與多選篩選", () => {
  it("載入中的預設日期仍沿用所選期間，跨年和閏月正確", () => {
    expect(reportPeriodRange("last_month", "2028-03-17")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    })
    expect(reportPeriodRange("six_months", "2031-04-17")).toEqual({
      start: "2030-11-01",
      end: "2031-04-17",
    })
    expect(reportPeriodRange("quarter", "2031-04-17")).toEqual({
      start: "2031-04-01",
      end: "2031-04-17",
    })
    expect(reportPeriodRange("year", "2031-04-17")).toEqual({
      start: "2030-05-01",
      end: "2031-04-17",
    })
    expect(
      reportPeriodRange("custom", "2031-04-17", {
        start: "2031-01-15",
        end: "2031-04-10",
      })
    ).toEqual({ start: "2031-01-15", end: "2031-04-10" })
  })
  it("搜尋名稱和編號，忽略大小寫、頭尾空白與全形差異", () => {
    const options = [
      { key: "P1", label: "魚油" },
      { key: "P2", label: "維他命" },
    ]
    expect(searchFilterOptions(options, " ｐ１ ")).toEqual([options[0]])
    expect(searchFilterOptions(options, "魚油")).toEqual([options[0]])
    expect(searchFilterOptions(options, "不存在")).toEqual([])
  })
  it("同一欄位多選保持唯一且不修改其他條件，清空即移除此欄位", () => {
    const original = [{ dimension: "owner" as const, keys: ["S1"] }]
    const next = setReportSlicer(original, "customer", ["C1", "C2", " C1 "])
    expect(next).toEqual([
      ...original,
      { dimension: "customer", keys: ["C1", "C2"] },
    ])
    expect(setReportSlicer(next, "customer", [])).toEqual(original)
    expect(original).toEqual([{ dimension: "owner", keys: ["S1"] }])
  })
  it("只解析真實的 ISO 日期，允許同日起訖，拒絕顛倒、未來與過長範圍", () => {
    expect(
      dateRangeError({ start: "2031-04-17", end: "2031-04-17" }, "2031-04-17")
    ).toBeNull()
    for (const range of [
      { start: "", end: "2031-04-17" },
      { start: "2031-02-30", end: "2031-04-17" },
      { start: "2031-04-18", end: "2031-04-17" },
      { start: "2031-04-01", end: "2031-04-18" },
      { start: "2000-01-01", end: "2031-04-17" },
    ])
      expect(dateRangeError(range, "2031-04-17")).not.toBeNull()
    expect(
      dateRangeError({ start: "2028-02-29", end: "2028-02-29" })
    ).toBeNull()
  })
  it("已失效或沒有權限的選項可見且可清除，不推測其名稱", () => {
    expect(filterOptionLabel(emptyFilterOptions(), "customer", "C3")).toBe(
      "已無可用選項（C3）"
    )
    expect(
      filterOptionLabel(emptyFilterOptions(), "customer_type", "clinic")
    ).toBe("診所")
  })
  it("快取考慮自訂日期與三層條件，與選取順序無關", () => {
    const base = config()
    const owners = [{ dimension: "owner" as const, keys: ["S1", "S2"] }]
    const filtered = config({ slicers: owners })
    expect(reportDataKey(filtered)).not.toBe(reportDataKey(base))
    expect(reportDataKey(filtered)).toBe(
      reportDataKey(
        config({ slicers: [{ dimension: "owner", keys: ["S2", "S1"] }] })
      )
    )
    expect(
      reportDataKey(
        config({ pages: [{ id: "overview", name: "頁", slicers: owners }] })
      )
    ).not.toBe(reportDataKey(base))
    expect(
      reportDataKey(config({ cards: [{ ...base.cards[0], slicers: owners }] }))
    ).not.toBe(reportDataKey(base))
    const custom = config({
      period: "custom",
      date_range: { start: "2031-01-01", end: "2031-04-17" },
    })
    expect(reportDataKey(custom)).not.toBe(
      reportDataKey({
        ...custom,
        date_range: { start: "2031-01-02", end: "2031-04-17" },
      })
    )
    expect(reportDataKey({ ...base, date_range: custom.date_range })).toBe(
      reportDataKey(base)
    )
  })
  it("移動到有不同條件的頁面重新查詢，相同條件頁不重抓", () => {
    const base = config({
      pages: [
        { id: "overview", name: "一" },
        {
          id: "other",
          name: "二",
          slicers: [{ dimension: "owner", keys: ["S1"] }],
        },
      ],
    })
    const moved = { ...base, cards: [{ ...base.cards[0], page_id: "other" }] }
    expect(reportDataKey(moved)).not.toBe(reportDataKey(base))
    const noFilters = {
      ...base,
      pages: [
        { id: "overview", name: "一" },
        { id: "other", name: "二" },
      ],
    }
    expect(reportDataKey({ ...moved, pages: noFilters.pages })).toBe(
      reportDataKey(noFilters)
    )
  })
  it("切換快照指標移除不支援的商品多選，保留客戶條件", () => {
    const base = config().cards[0]
    expect(
      normalizeCard({
        ...base,
        metric: "customers",
        slicers: [
          { dimension: "product", keys: ["P1"] },
          { dimension: "customer", keys: ["C1"] },
        ],
      }).slicers
    ).toEqual([{ dimension: "customer", keys: ["C1"] }])
  })
})

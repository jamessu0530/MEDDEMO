import { describe, expect, it } from "vitest"

import {
  formatReportValue,
  moveReportCard,
  normalizeCard,
  normalizeReportConfig,
  reorderReportPage,
  reportCsv,
  reportDataKey,
  validDimensions,
  toggleReportSelection,
  pruneReportSelections,
  type ReportCard,
  type ReportConfig,
  type ReportMetric,
  type ReportSelectionPoint,
} from "@/lib/reports"

function card(patch: Partial<ReportCard> = {}): ReportCard {
  return {
    id: "customer-sales",
    title: "客戶業績",
    metric: "sales",
    dimension: "customer",
    visual: "bar",
    limit: 5,
    ...patch,
  }
}

function config(patch: Partial<ReportConfig> = {}): ReportConfig {
  return {
    name: "我的業務報表",
    template: "sales",
    period: "six_months",
    owner_id: null,
    customer_type: null,
    cards: [
      card(),
      card({
        id: "margin",
        title: "淨毛利",
        metric: "net_margin",
        dimension: "none",
        visual: "kpi",
      }),
    ],
    ...patch,
  }
}

describe("normalizeCard", () => {
  it("換成拜訪指標時，商品分組改成可用的客戶分組", () => {
    expect(validDimensions("visits")).not.toContain("product")
    expect(
      normalizeCard(card({ metric: "visits", dimension: "product" }))
    ).toMatchObject({ metric: "visits", dimension: "customer", visual: "bar" })
  })

  it.each(["overdue", "customers"] as ReportMetric[])(
    "%s 快照不能產生虛構的逐月趨勢",
    (metric) => {
      expect(validDimensions(metric)).not.toContain("month")
      expect(validDimensions(metric)).not.toContain("product")
      expect(
        normalizeCard(card({ metric, dimension: "month", visual: "line" }))
      ).toMatchObject({ metric, dimension: "customer", visual: "bar" })
      expect(
        normalizeCard(card({ metric, dimension: "product", visual: "table" }))
          .dimension
      ).toBe("customer")
    }
  )

  it("數字卡取消分組，換回比較圖補上分組，趨勢圖使用月份", () => {
    const kpi = normalizeCard(card({ visual: "kpi" }))
    expect(kpi.dimension).toBe("none")
    expect(normalizeCard({ ...kpi, visual: "bar" }).dimension).toBe("customer")
    expect(
      normalizeCard(card({ visual: "line", dimension: "owner" })).dimension
    ).toBe("month")
  })

  it("保留支援的比較方式，且不修改原本的卡片", () => {
    const original = card({
      metric: "net_margin",
      dimension: "product",
      visual: "table",
    })
    const before = structuredClone(original)
    expect(normalizeCard(original)).toEqual(before)
    normalizeCard({ ...original, metric: "customers" })
    expect(original).toEqual(before)
  })
})

describe("精確聯動選取", () => {
  const april: ReportSelectionPoint = {
    label: "四月 / 診所",
    filters: [
      { dimension: "month", key: "2031-04" },
      { dimension: "customer_type", key: "clinic" },
    ],
  }
  const march: ReportSelectionPoint = {
    label: "三月 / 藥局",
    filters: [
      { dimension: "month", key: "2031-03" },
      { dimension: "customer_type", key: "independent" },
    ],
  }
  it("同圖保留精確的成對多選，不把月份與系列拆成笛卡兒組合", () => {
    const first = toggleReportSelection([], "trend", april, true)
    const both = toggleReportSelection(first, "trend", march, true)
    expect(both[0].points).toEqual([april, march])
    expect(toggleReportSelection(both, "trend", april, true)[0].points).toEqual(
      [march]
    )
    expect(toggleReportSelection(first, "trend", april, true)).toEqual([])
    expect(first[0].points).toEqual([april])
  })
  it("不同圖保留各自條件，單選只替換該來源圖", () => {
    const other = {
      label: "客戶甲",
      filters: [{ dimension: "customer" as const, key: "c01" }],
    }
    const groups = toggleReportSelection(
      toggleReportSelection([], "trend", april, true),
      "customer-sales",
      other,
      false
    )
    const next = toggleReportSelection(groups, "trend", march, false)
    expect(next).toEqual([
      { source_id: "customer-sales", points: [other] },
      { source_id: "trend", points: [march] },
    ])
  })
  it("查詢快取包含選取与互動模式，但選取順序與標籤不改變資料需求", () => {
    const groups = [{ source_id: "trend", points: [april, march] }]
    const key = reportDataKey({ ...config(), selection_groups: groups })
    expect(key).not.toBe(reportDataKey(config()))
    expect(key).toBe(
      reportDataKey({
        ...config(),
        selection_groups: [
          { source_id: "trend", points: [{ ...march, label: "更名" }, april] },
        ],
      })
    )
    expect(
      reportDataKey(config({ cards: [card({ interaction: "none" })] }))
    ).not.toBe(reportDataKey(config({ cards: [card()] })))
  })
  it("刪圖或換分組移除過期選取，其他系列不當成單一分類", () => {
    const groups = [{ source_id: "trend", points: [april] }]
    expect(pruneReportSelections(groups, config())).toEqual([])
    const report = config({
      cards: [
        card({ id: "trend", dimension: "month", legend: "customer_type" }),
      ],
    })
    expect(pruneReportSelections(groups, report)).toEqual(groups)
    expect(
      pruneReportSelections(
        groups,
        config({ cards: [card({ id: "trend", dimension: "month" })] })
      )
    ).toEqual([])
    expect(
      toggleReportSelection(
        [],
        "trend",
        { label: "其他", filters: [{ dimension: "owner", key: "__other__" }] },
        true
      )
    ).toEqual([])
  })
})

describe("reportDataKey", () => {
  it("圖例、第二指標與排序影響查詢，色彩與分頁排版不影響", () => {
    const original = config()
    const changedCard = (patch: Partial<ReportCard>) =>
      config({ cards: [card(patch), original.cards[1]] })
    for (const patch of [
      { legend: "customer_type" as const },
      { secondary_metric: "net_margin" as const },
      { sort: "value_asc" as const },
      { filters: [{ dimension: "owner" as const, key: "u01" }] },
    ])
      expect(reportDataKey(changedCard(patch))).not.toBe(
        reportDataKey(original)
      )
    expect(
      reportDataKey(
        changedCard({
          color: "#2878b5",
          page_id: "analysis",
          width: "full",
          height: "tall",
          show_labels: false,
        })
      )
    ).toBe(reportDataKey(original))
    expect(
      reportDataKey(
        config({ filters: [{ dimension: "customer", key: "c01" }] })
      )
    ).not.toBe(reportDataKey(original))
  })
  it("更名、長條改成表格、卡片重新排列都沿用相同資料", () => {
    const original = config()
    const rearranged = config({
      name: "經理晨會",
      cards: [
        { ...original.cards[1], title: "毛利總計" },
        { ...original.cards[0], title: "客戶排行", visual: "table" },
      ],
    })
    expect(reportDataKey(rearranged)).toBe(reportDataKey(original))
  })

  it("改指標、分組、筆數或期間需要重新取資料", () => {
    const original = config()
    const key = reportDataKey(original)
    for (const changed of [
      config({ period: "this_month" }),
      config({ cards: [card({ metric: "net_margin" }), original.cards[1]] }),
      config({ cards: [card({ dimension: "owner" }), original.cards[1]] }),
      config({ cards: [card({ limit: 10 }), original.cards[1]] }),
      config({ cards: original.cards.slice(0, 1) }),
    ])
      expect(reportDataKey(changed)).not.toBe(key)
  })

  it("改業務或客戶類型篩選不會沿用舊範圍的資料", () => {
    expect(reportDataKey(config({ owner_id: "user-2" }))).not.toBe(
      reportDataKey(config())
    )
    expect(reportDataKey(config({ customer_type: "clinic" }))).not.toBe(
      reportDataKey(config())
    )
  })

  it("從客戶長條改成月份趨勢會更新分組查詢", () => {
    const original = config()
    const changed = {
      ...original,
      cards: [
        normalizeCard({ ...original.cards[0], visual: "line" }),
        original.cards[1],
      ],
    }
    expect(reportDataKey(changed)).not.toBe(reportDataKey(original))
  })
})

describe("Power BI 編輯設定", () => {
  it("堆疊圖自動配置有效圖例，矩陣可保留月份欄位", () => {
    expect(
      normalizeCard(card({ visual: "stacked_column", dimension: "month" }))
    ).toMatchObject({ legend: "customer_type" })
    expect(
      normalizeCard(
        card({ visual: "stacked_bar", dimension: "owner", legend: "owner" })
      ).legend
    ).toBe("customer_type")
    expect(
      normalizeCard(card({ visual: "matrix", legend: "month" })).legend
    ).toBe("month")
    expect(
      normalizeCard(card({ visual: "line", legend: "owner" })).legend
    ).toBe("owner")
    expect(
      normalizeCard(card({ visual: "column", legend: "customer_type" })).legend
    ).toBe("customer_type")
    expect(
      normalizeCard(card({ visual: "combo", legend: "owner" })).legend
    ).toBeNull()
  })
  it("組合與散佈圖配置真實第二指標，快照無法套用", () => {
    expect(normalizeCard(card({ visual: "combo" }))).toMatchObject({
      dimension: "month",
      secondary_metric: "net_margin",
    })
    expect(
      normalizeCard(card({ visual: "scatter", metric: "net_margin" }))
    ).toMatchObject({ secondary_metric: "sales" })
    expect(
      normalizeCard(card({ visual: "scatter", metric: "customers" })).visual
    ).toBe("bar")
  })
  it("舊設定補齊分頁與格式預設，避免第一次儲存後狀態不一致", () => {
    const canonical = normalizeReportConfig(config())
    expect(canonical.pages).toEqual([{ id: "overview", name: "總覽" }])
    expect(canonical.cards[0]).toMatchObject({
      page_id: "overview",
      color: "#6455c7",
      show_labels: true,
      filters: [],
    })
    expect(normalizeReportConfig(canonical)).toEqual(canonical)
  })
  it("拖曳及上下移只重排同一分頁的視覺效果", () => {
    const original = config({
      cards: [
        card({ id: "one", page_id: "a" }),
        card({ id: "two", page_id: "b" }),
        card({ id: "three", page_id: "a" }),
      ],
    })
    expect(
      reorderReportPage(original, "three", "one").cards.map((item) => item.id)
    ).toEqual(["three", "two", "one"])
    expect(
      moveReportCard(original, "one", 1).cards.map((item) => item.id)
    ).toEqual(["three", "two", "one"])
    expect(reorderReportPage(original, "one", "two")).toBe(original)
    expect(original.cards.map((item) => item.id)).toEqual([
      "one",
      "two",
      "three",
    ])
  })
  it("CSV 保留第二指標、矩陣資料、雙引號，並防止文字公式注入", () => {
    const csv = reportCsv(card({ secondary_metric: "net_margin" }), {
      id: "customer-sales",
      total: 10,
      note: null,
      points: [
        {
          key: "c1",
          label: '=HYPERLINK("test")',
          value: 10,
          secondary_value: -2,
        },
      ],
      series: [
        {
          key: "s1",
          label: "連鎖藥局",
          points: [{ key: "c1", label: "客戶", value: 4 }],
        },
      ],
    })
    expect(csv).toContain('"客戶","業績","淨毛利","連鎖藥局"')
    expect(csv).toContain('"\'=HYPERLINK(""test"")","10","-2","4"')
    expect(csv.startsWith("\uFEFF")).toBe(true)
  })
})

describe("moveReportCard", () => {
  it("依卡片 ID 排序且保留原版以便復原", () => {
    const original = config()
    const moved = moveReportCard(original, "margin", -1)
    expect(moved.cards.map((item) => item.id)).toEqual([
      "margin",
      "customer-sales",
    ])
    expect(original.cards.map((item) => item.id)).toEqual([
      "customer-sales",
      "margin",
    ])
    expect(reportDataKey(moved)).toBe(reportDataKey(original))
  })

  it("邊界或不存在的卡片維持原順序", () => {
    const original = config()
    expect(moveReportCard(original, "customer-sales", -1)).toBe(original)
    expect(moveReportCard(original, "margin", 1)).toBe(original)
    expect(moveReportCard(original, "missing", 1)).toBe(original)
  })
})

describe("formatReportValue", () => {
  it("大額金額使用萬，小額使用元，虧損保留負號", () => {
    expect(formatReportValue(2511468, "sales")).toBe("251.1 萬")
    expect(formatReportValue(-2511468, "net_margin")).toBe("−251.1 萬")
    expect(formatReportValue(-2500, "net_margin")).toBe("−2,500 元")
    expect(formatReportValue(0, "overdue")).toBe("0 元")
  })

  it("拜訪與客戶數使用正確單位", () => {
    expect(formatReportValue(12000, "visits")).toBe("12,000 次")
    expect(formatReportValue(12000, "customers")).toBe("12,000 家")
    expect(formatReportValue(0, "customers")).toBe("0 家")
  })
})

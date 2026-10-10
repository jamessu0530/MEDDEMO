import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MonthlySales, TopCustomers } from "@/components/me/sales-charts"

describe("TopCustomers", () => {
  it("五列，長條照第一名的比例，數字寫萬", () => {
    const html = renderToStaticMarkup(
      createElement(TopCustomers, {
        items: [
          { customer_id: "C1", name: "康泰連鎖藥局 · 內湖店", amount: 2511468 },
          { customer_id: "C2", name: "康泰連鎖藥局 · 忠孝店", amount: 1255734 },
        ],
      })
    )
    expect(html).toContain("康泰連鎖藥局 · 內湖店")
    expect(html).toContain("251.1 萬")
    expect(html).toContain("--w:100%")
    expect(html).toContain("--w:50%")
  })
})

describe("MonthlySales", () => {
  const months = [
    { month: "2026-05", amount: 2920623, through: null },
    { month: "2026-06", amount: 2788825, through: null },
    { month: "2026-10", amount: 1865839, through: "2026-10-28" },
  ]
  const html = renderToStaticMarkup(createElement(MonthlySales, { months }))

  it("月份在下面，只標最高的那個月與這個月的數字", () => {
    expect(html).toContain("5 月")
    expect(html).toContain("292.1")
    expect(html).toContain("186.6")
    // 每根長條的 <title> 提示裡有數字；沒標的月份只是圖上沒有那個字
    expect(html).not.toContain(">278.9<")
  })

  it("這個月畫淡色並註明算到哪天", () => {
    expect(html).toContain("10 月只算到 10/28")
    expect(html).toContain("data-partial")
  })

  it("很小的月份（不到最高的 3%）、零的月份：長條不畫到底線下面", () => {
    const tiny = renderToStaticMarkup(
      createElement(MonthlySales, {
        months: [
          { month: "2026-09", amount: 2920623, through: null },
          { month: "2026-10", amount: 30000, through: "2026-10-28" },
          { month: "2026-11", amount: 0, through: null },
        ],
      })
    )
    // 長條的路徑裡每個 V（往下或往上畫到哪）都不超過底線 160，圓角不會翻到底線下面
    const paths = [...tiny.matchAll(/<path[^>]* d="([^"]+)"/g)].map((match) => match[1])
    expect(paths).toHaveLength(3)
    for (const d of paths) {
      for (const [, v] of d.matchAll(/V(-?[\d.]+)/g)) expect(Number(v)).toBeLessThanOrEqual(160)
      expect(d).not.toContain("NaN")
    }
  })
})

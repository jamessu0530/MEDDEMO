import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CustomerPurchaseComparison } from "./customer-purchase-comparison"
import { buildPurchaseComparison } from "@/lib/customer-purchase-comparison"

describe("客戶進貨疊圖", () => {
  it("顯示兩條折線、統計截止日與可用鍵盤操作的日期選擇", () => {
    const html = renderToStaticMarkup(
      createElement(CustomerPurchaseComparison, {
        today: "2026-10-18",
        comparison: buildPurchaseComparison(
          [
            {
              month: "2026-09",
              daily: [{ date: "2026-09-01", amount: 10000 }],
            },
            {
              month: "2026-10",
              daily: [{ date: "2026-10-18", amount: 20000 }],
            },
          ],
          "2026-10-18"
        ),
      })
    )
    expect(html).toContain('data-series="current"')
    expect(html).toContain('data-series="previous"')
    expect(html).toContain('stroke-dasharray="5 4"')
    expect(html).toContain('aria-label="選擇比較日期"')
    expect(html).toContain('type="range"')
    expect(html).toContain("NT$20,000")
    expect(html).toContain("NT$10,000")
    expect(html).toContain("本月統計至 10/18")
    expect(html).not.toContain("NaN")
    expect(html).not.toContain("Infinity")
  })

  it("兩個月都沒有進貨時顯示空狀態", () => {
    const html = renderToStaticMarkup(
      createElement(CustomerPurchaseComparison, {
        today: "2026-10-18",
        comparison: buildPurchaseComparison([], "2026-10-18"),
      })
    )
    expect(html).toContain("本月與上月尚無進貨紀錄")
    expect(html).not.toContain("<path")
  })
})

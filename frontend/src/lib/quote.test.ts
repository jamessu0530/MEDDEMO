import { describe, expect, it } from "vitest"

import { discountSteps } from "@/lib/approval"
import { packDeal, quoteBlocked, quoteTotal } from "@/lib/quote"

describe("quoteTotal", () => {
  it("只打沒促銷的列，口照每口售價", () => {
    // 人工淚液 133 元打 98 折是 130.34 元 × 20，加小口 5,500 元
    expect(quoteTotal([{ qty: 20, unitPrice: 133 }], [{ packs: 1, dealPrice: 5500 }], 2)).toBe(8107)
    expect(quoteTotal([], [{ packs: 2, dealPrice: 3100 }], 0)).toBe(6200)
    // 405 元打 97 折是 392.85 元，跟後端一樣到分
    expect(quoteTotal([{ qty: 100, unitPrice: 405 }], [], 3)).toBe(39285)
  })
})

describe("quoteBlocked", () => {
  const base = { plainCount: 1, packCount: 0, discount: 0, route: discountSteps(0), reason: "" }
  it("照順序說明送不出去的原因", () => {
    expect(quoteBlocked({ ...base, plainCount: 0 })).toBe("至少要有一項數量大於 0")
    expect(quoteBlocked({ ...base, plainCount: 20, packCount: 11 })).toBe("一張報價最多 30 項")
    expect(quoteBlocked({ ...base, discount: 2.3, route: discountSteps(2.3) })).toBe(discountSteps(2.3).text)
    expect(quoteBlocked({ ...base, plainCount: 0, packCount: 1, discount: 2, route: discountSteps(2) })).toBe(
      "折扣只套在沒促銷的品項上"
    )
    expect(quoteBlocked({ ...base, discount: 5, route: discountSteps(5) })).toBe("要送簽核，請寫申請理由")
    expect(quoteBlocked({ ...base, packCount: 1, discount: 5, route: discountSteps(5), reason: "量大" })).toBeNull()
    expect(quoteBlocked({ ...base, plainCount: 0, packCount: 1 })).toBeNull()
  })
})

describe("packDeal", () => {
  it("買幾送幾；直走價不送同品", () => {
    expect(packDeal({ buy_qty: 22, free_qty: 1 })).toBe("買 22 送 1")
    expect(packDeal({ buy_qty: 7, free_qty: 0 })).toBe("直走 7")
  })
})

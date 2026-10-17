import { describe, expect, it } from "vitest"
import {
  createPageContexts,
  mergePageContext,
  pageContextFor,
} from "@/ask/page-context"

describe("頁面情境", () => {
  it("銷售各分頁與客戶有各自情境", () => {
    expect(pageContextFor("/orders", "?view=products").title).toBe("商品型錄")
    expect(pageContextFor("/orders", "?view=promotions").title).toBe("促銷方案")
    expect(pageContextFor("/customers/C01").facts).toEqual(["客戶編號：C01"])
    expect(pageContextFor("/manager", "?view=oa").title).toBe("簽核")
  })
  it("各頁篩選只合併到當前路徑，保留全部條件並限制大小", () => {
    const merged = mergePageContext(
      pageContextFor("/orders", "?view=products"),
      [{ facts: ["搜尋：鈣", "商品分類：保健品"] }]
    )
    expect(merged.facts).toEqual(["搜尋：鈣", "商品分類：保健品"])
    expect(
      mergePageContext(merged, [
        {
          facts: Array.from(
            { length: 30 },
            (_, i) => `${i}${"字".repeat(600)}`
          ),
        },
      ]).facts
    ).toHaveLength(16)
    expect(
      mergePageContext(merged, [{ facts: ["字".repeat(600)] }]).facts.at(-1)
    ).toHaveLength(500)
  })
  it("舊頁卸載不會移除新頁情境；登出可清空", () => {
    const store = createPageContexts()
    const old = store.register("/customers/C01", { title: "康泰" })
    store.register("/customers/C02", { title: "新客戶" })
    old()
    expect(store.getSnapshot()).toMatchObject([
      { key: "/customers/C02", details: { title: "新客戶" } },
    ])
    store.clear()
    expect(store.getSnapshot()).toEqual([])
  })
})

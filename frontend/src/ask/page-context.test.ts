import { describe, expect, it } from "vitest"
import {
  createPageContexts,
  mergePageContext,
  pageContextFor,
} from "@/ask/page-context"

describe("頁面情境", () => {
  it.each([
    "/orders",
    "/orders/new",
    "/orders/demo",
    "/orders/O01",
    "/orders?view=products",
    "/orders?view=promotions",
    "/customers",
    "/customers/C01",
    "/customers/C01/quote",
    "/customers/C01/contract",
    "/customers/C01/record",
    "/customers/C01/negotiation",
    "/route",
    "/route/edit",
    "/route/edit/add",
    "/route/habits",
    "/calendar",
    "/reports",
    "/channels",
    "/channels/2",
    "/channels/search",
    "/channels/2/threads",
    "/oa/apps",
    "/oa/forms",
    "/oa/forms/123",
    "/oa/forms/123/edit",
    "/oa/new/6071",
    "/manager",
    "/manager?view=priority",
    "/manager?view=oa",
    "/manager?view=methods",
    "/methods",
    "/me",
    "/settings",
    "/first-week",
    "/first-week/lessons/ask-v1",
    "/learning/products",
    "/learning/products/supplement/1",
    "/documents/policy.md",
    "/visits/V01",
    "/admin",
    "/rides",
    "/mascots",
  ])("%s 有該畫面的說明、範例問題與下一步", (path) => {
    const url = new URL(path, "https://meddemo.test")
    const page = pageContextFor(url.pathname, url.search)
    expect(page.hint).toBeTruthy()
    expect(page.suggestions.length).toBeGreaterThanOrEqual(2)
    expect(page.followUps.length).toBeGreaterThanOrEqual(2)
    expect(page.suggestions).not.toContain("這個頁面可以做什麼？")
    expect(
      [...page.suggestions, ...page.followUps].every(
        (text) => text.length <= 500
      )
    ).toBe(true)
  })
  it("新開放的頁面有正確名稱，授權憑證不會進入提問情境", () => {
    expect(pageContextFor("/channels/2/threads").title).toBe("客戶討論串清單")
    expect(pageContextFor("/channels/search").suggestions).toContain(
      "可以用照片找相似圖片嗎？"
    )
    expect(pageContextFor("/customers/C01/record").title).toBe("拜訪錄音")
    expect(pageContextFor("/route/edit").title).toBe("調整行程")
    expect(pageContextFor("/route/edit/add").title).toBe("行程加一站")
    expect(pageContextFor("/login").title).toBe("登入")
    expect(pageContextFor("/register").title).toBe("註冊")
    expect(pageContextFor("/privacy").title).toBe("隱私權政策")
    const callback = pageContextFor(
      "/auth/github/callback",
      "?code=private-code&state=private-state"
    )
    expect(callback.title).toBe("帳號授權")
    expect(JSON.stringify(callback)).not.toContain("private-")
    expect(callback.path).toBe("/auth/github/callback")
  })
  it("銷售各分頁與客戶有各自情境", () => {
    expect(pageContextFor("/orders", "?view=products").title).toBe("商品型錄")
    expect(pageContextFor("/orders", "?view=promotions").title).toBe("促銷方案")
    expect(pageContextFor("/customers/C01").facts).toEqual(["客戶編號：C01"])
    expect(pageContextFor("/manager", "?view=oa").title).toBe("簽核")
    expect(pageContextFor("/manager", "?view=asks").title).toBe("團隊行程")
  })
  it("OA 目錄、填寫與明細有各自的頁面情境及建議問題", () => {
    expect(pageContextFor("/oa/apps").title).toBe("OA 表單中心")
    expect(pageContextFor("/oa/new/6071").suggestions).toContain(
      "這張表單還缺什麼資料？"
    )
    expect(pageContextFor("/oa/forms/123/edit").title).toBe("OA 表單填寫")
    expect(pageContextFor("/oa/forms/123").facts).toContain("申請單編號：123")
    expect(pageContextFor("/oa/forms", "?application=expense").facts).toContain(
      "應用篩選：expense"
    )
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

import { describe, expect, it } from "vitest"
import { hasPageAssistant } from "./page-assistant"

describe("各頁的 AI 輸入方式", () => {
  it("路線、報表與頻道不重疊顯示另一個輸入列", () => {
    for (const path of [
      "/route",
      "/route/",
      "/route/edit",
      "/reports",
      "/channels",
      "/channels/2",
    ])
      expect(hasPageAssistant(path)).toBe(false)
    expect(hasPageAssistant("/manager", "?view=priority")).toBe(false)
  })
  it("一般頁面就地提問，主管其他分頁也可用", () => {
    for (const path of [
      "/orders",
      "/orders/new",
      "/customers",
      "/customers/C01",
      "/calendar",
      "/me",
      "/settings",
    ])
      expect(hasPageAssistant(path)).toBe(true)
    expect(hasPageAssistant("/manager", "?view=oa")).toBe(true)
  })
  it("登入和錄音流程不插入 AI 操作", () => {
    expect(hasPageAssistant("/login")).toBe(false)
    expect(hasPageAssistant("/customers/C01/record")).toBe(false)
  })
})

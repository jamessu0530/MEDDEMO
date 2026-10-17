import { describe, expect, it } from "vitest"
import { pageAssistantPlacement } from "./page-assistant"

describe("各頁的 AI 輸入方式", () => {
  it("已有專用輸入列的頁面仍可用浮動入口開啟共用助理", () => {
    for (const path of [
      "/route",
      "/route/",
      "/route/edit",
      "/reports",
      "/channels",
      "/channels/2",
      "/channels/search",
      "/channels/2/threads",
    ])
      expect(pageAssistantPlacement(path)).toBe("floating")
  })
  it("一般頁面與主管各分頁使用相同的底部詢問欄", () => {
    for (const path of [
      "/orders",
      "/orders/new",
      "/customers",
      "/customers/C01",
      "/calendar",
      "/me",
      "/settings",
      "/manager",
      "/manager/",
      "/oa/new/expense",
      "/oa/forms/123/edit",
      "/oa/apps",
      "/oa/forms",
      "/oa/forms/123",
    ])
      expect(pageAssistantPlacement(path)).toBe("dock")
  })
  it("公開頁和錄音頁也保留助理入口", () => {
    for (const path of [
      "/login",
      "/register",
      "/privacy",
      "/auth/google/callback",
      "/auth/github/callback",
      "/customers/C01/record",
    ])
      expect(pageAssistantPlacement(path)).toBe("floating")
  })
})

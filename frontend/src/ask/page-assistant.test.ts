import { describe, expect, it } from "vitest"
import { pageAssistantPlacement } from "./page-assistant"

describe("各頁的 AI 輸入方式", () => {
  it("路線頁只保留原有的 AI 輸入列", () => {
    for (const path of ["/route", "/route/", "/route/edit", "/route/edit/"])
      expect(pageAssistantPlacement(path)).toBe("none")
  })
  it("頻道相關頁面透過 @熊熊滾 提問，不顯示底部詢問欄", () => {
    for (const path of [
      "/channels",
      "/channels/",
      "/channels/2",
      "/channels/2/",
      "/channels/search",
      "/channels/search/",
      "/channels/2/threads",
      "/channels/2/threads/",
    ])
      expect(pageAssistantPlacement(path)).toBe("none")
  })
  it("一般頁面與主管各分頁使用相同的底部詢問欄", () => {
    for (const path of [
      "/reports",
      "/reports/",
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
  it("公開頁和錄音頁也使用底部詢問欄", () => {
    for (const path of [
      "/login",
      "/register",
      "/privacy",
      "/auth/google/callback",
      "/auth/github/callback",
      "/customers/C01/record",
    ])
      expect(pageAssistantPlacement(path)).toBe("dock")
  })
})

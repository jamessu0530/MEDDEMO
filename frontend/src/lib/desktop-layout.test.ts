import { describe, expect, it } from "vitest"

import { desktopSamePage, pageWidth, trimPath } from "@/lib/desktop-layout"

describe("pageWidth", () => {
  it("自己排成兩欄以上的六種頁是寬版", () => {
    for (const path of ["/", "/channels", "/channels/12", "/manager", "/customers/C0123", "/customers/C0123/quote"]) {
      expect(pageWidth(path), path).toBe("wide")
    }
  })

  it("結尾多一個斜線也一樣", () => {
    expect(pageWidth("/channels/12/")).toBe("wide")
    expect(pageWidth("/manager/")).toBe("wide")
    expect(pageWidth("/ask/")).toBe("column")
  })

  it("沒登入的頁與錄音頁不畫側邊欄", () => {
    for (const path of ["/login", "/register", "/privacy", "/auth/github/callback", "/auth/google/callback", "/customers/C0123/record"]) {
      expect(pageWidth(path), path).toBe("bare")
    }
  })

  it("其他頁放在中間一欄", () => {
    for (const path of [
      "/ask",
      "/customers",
      "/channels/search",
      "/channels/12/threads",
      "/customers/C0123/negotiation",
      "/customers/C0123/contract",
      "/visits/5",
      "/oa/forms/3",
      "/admin",
      "/settings",
    ]) {
      expect(pageWidth(path), path).toBe("column")
    }
  })
})

describe("desktopSamePage", () => {
  it("頻道清單與各頻道的對話是電腦版的同一頁", () => {
    expect(desktopSamePage("/channels", "/channels/12")).toBe(true)
    expect(desktopSamePage("/channels/12", "/channels/21/")).toBe(true)
  })

  it("搜尋、討論串清單與別的頁不算", () => {
    expect(desktopSamePage("/channels/12", "/channels/search")).toBe(false)
    expect(desktopSamePage("/channels/12", "/channels/12/threads")).toBe(false)
    expect(desktopSamePage("/", "/channels")).toBe(false)
  })
})

describe("trimPath", () => {
  it("拿掉結尾的斜線，首頁照舊是 /", () => {
    expect(trimPath("/manager/")).toBe("/manager")
    expect(trimPath("/")).toBe("/")
  })
})

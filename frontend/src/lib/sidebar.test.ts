import { describe, expect, it } from "vitest"

import { homePath, type Role } from "@/lib/auth"
import { isActiveItem, profilePath, sidebarItems, type SidebarItem } from "@/lib/sidebar"

const labels = (role: Role) => {
  const { main, more } = sidebarItems(role)
  return { main: main.map((item) => item.label), more: more.map((item) => item.label) }
}
const item = (role: Role, label: string): SidebarItem => {
  const { main, more } = sidebarItems(role)
  const found = [...main, ...more].find((i) => i.label === label)
  if (!found) throw new Error(`沒有 ${label}`)
  return found
}

describe("sidebarItems", () => {
  it("業務：銷售整合訂單與型錄，報表列入主要入口", () => {
    expect(labels("sales")).toEqual({
      main: ["銷售", "路線", "頻道", "報表"],
      more: ["日曆", "方法卡", "我的申請單"],
    })
  })

  it("主管：主管端的四個分頁，加上頻道", () => {
    expect(labels("manager")).toEqual({ main: ["團隊行程", "客戶策略", "簽核", "方法卡"], more: ["我的報表", "訂單", "頻道", "商品與促銷"] })
  })

  it("IT：組織管理在最前面，接著是主管端", () => {
    expect(labels("it")).toEqual({ main: ["組織管理", "團隊行程", "客戶策略", "簽核", "方法卡"], more: ["我的報表", "訂單", "頻道", "商品與促銷"] })
  })

  it("數字掛在對的項目上", () => {
    expect(item("sales", "銷售").badge).toBe("uploads")
    expect(item("sales", "頻道").badge).toBe("channels")
    expect(item("manager", "簽核").badge).toBe("oa")
    expect(item("it", "頻道").badge).toBe("channels")
  })

  it("主管端的項目連到各自的分頁", () => {
    expect(item("manager", "團隊行程").to).toBe("/manager")
    expect(item("manager", "簽核").to).toBe("/manager?view=oa")
  })
})

describe("homePath", () => {
  it("業務登入先看訂單，主管與 IT 保留各自的首頁", () => {
    expect(homePath("sales")).toBe("/orders")
    expect(homePath("manager")).toBe("/manager")
    expect(homePath("it")).toBe("/admin")
    expect(sidebarItems("sales").main[0].to).toBe(homePath("sales"))
  })
})

describe("isActiveItem", () => {
  it("訂單和路線各自選中自己的頁面", () => {
    expect(isActiveItem(item("sales", "銷售"), "/orders", "")).toBe(true)
    expect(isActiveItem(item("sales", "銷售"), "/route", "")).toBe(false)
    expect(isActiveItem(item("sales", "路線"), "/route/", "?view=map")).toBe(true)
    expect(isActiveItem(item("sales", "路線"), "/route/edit", "")).toBe(true)
    expect(isActiveItem(item("sales", "路線"), "/orders", "")).toBe(false)
  })

  it("其他項目連它底下的頁都算（訂單明細算訂單、搜尋算頻道）", () => {
    expect(isActiveItem(item("sales", "銷售"), "/orders/123", "")).toBe(true)
    expect(isActiveItem(item("sales", "頻道"), "/channels/search", "")).toBe(true)
    expect(isActiveItem(item("sales", "我的申請單"), "/oa/forms/3/", "")).toBe(true)
    expect(isActiveItem(item("sales", "銷售"), "/products-old", "")).toBe(false)
  })

  it("主管端照 view 判斷，沒帶或不認得的 view 是團隊行程", () => {
    expect(isActiveItem(item("manager", "團隊行程"), "/manager", "")).toBe(true)
    expect(isActiveItem(item("manager", "團隊行程"), "/manager", "?view=routes&rep=U01")).toBe(true)
    expect(isActiveItem(item("manager", "團隊行程"), "/manager", "?view=xyz")).toBe(true)
    expect(isActiveItem(item("manager", "團隊行程"), "/manager", "?view=asks")).toBe(true)
    expect(isActiveItem(item("manager", "客戶策略"), "/manager", "?view=priority")).toBe(true)
    expect(isActiveItem(item("manager", "團隊行程"), "/manager", "?view=priority")).toBe(false)
    expect(isActiveItem(item("manager", "簽核"), "/manager", "?view=oa&item=4")).toBe(true)
    expect(isActiveItem(item("manager", "簽核"), "/manager", "?view=notices")).toBe(false)
    expect(isActiveItem(item("manager", "簽核"), "/oa/forms/4", "")).toBe(false)
  })
})

describe("profilePath", () => {
  it("業務的名字進個人頁，主管與 IT 進帳號設定", () => {
    expect(profilePath("sales")).toBe("/me")
    expect(profilePath("manager")).toBe("/settings")
    expect(profilePath("it")).toBe("/settings")
  })
})

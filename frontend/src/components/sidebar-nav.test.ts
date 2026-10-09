import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { SidebarNav } from "@/components/sidebar-nav"
import { sidebarItems, type SidebarBadge } from "@/lib/sidebar"

const render = (role: "sales" | "manager", counts: Partial<Record<SidebarBadge, number>>, pathname = "/", search = "") =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(SidebarNav, { groups: sidebarItems(role), counts, pathname, search }))
  )
// 標了 aria-current 的那一個連結裡面的字
const activeText = (html: string) => html.match(/<a[^>]*aria-current="page"[^>]*>(.*?)<\/a>/)?.[1] ?? ""

describe("SidebarNav", () => {
  it("每一項連到自己的網址，目前這一項標 aria-current", () => {
    const html = render("sales", {}, "/ask")
    expect(html).toContain('href="/calendar"')
    expect(activeText(html)).toContain("問答")
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it("有數字才顯示，超過 99 寫 99+", () => {
    const html = render("sales", { uploads: 2, channels: 120, replies: 0 })
    expect(html).toContain(">2<")
    expect(html).toContain(">99+<")
    expect(html).not.toContain(">0<")
  })

  it("拿不到數字（沒給）就不顯示", () => {
    expect(render("manager", {}, "/manager", "?view=oa")).not.toMatch(/rounded-full bg-destructive/)
  })

  it("主管端的分頁照 view 標目前這一項", () => {
    const html = render("manager", { notices: 3 }, "/manager", "?view=notices")
    expect(activeText(html)).toContain("風險通報")
    expect(html).toContain(">3<")
  })
})

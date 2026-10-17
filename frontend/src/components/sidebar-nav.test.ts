import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { SidebarNav } from "@/components/sidebar-nav"
import { sidebarItems, type SidebarBadge } from "@/lib/sidebar"

const render = (role: "sales" | "manager", counts: Partial<Record<SidebarBadge, number>>, pathname = "/", search = "", collapsed = false) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(SidebarNav, { groups: sidebarItems(role), counts, pathname, search, collapsed }))
  )
// 標了 aria-current 的那一個連結裡面的字
const activeText = (html: string) => html.match(/<a[^>]*aria-current="page"[^>]*>(.*?)<\/a>/)?.[1] ?? ""

describe("SidebarNav", () => {
  it("每一項連到自己的網址，目前這一項標 aria-current", () => {
    const html = render("sales", {}, "/orders")
    expect(html).toContain('href="/calendar"')
    expect(activeText(html)).toContain("銷售")
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it("有數字才顯示，超過 99 寫 99+", () => {
    const html = render("sales", { uploads: 2, channels: 120 })
    expect(html).toContain(">2<")
    expect(html).toContain(">99+<")
    expect(html).not.toContain(">0<")
  })

  it("拿不到數字（沒給）就不顯示", () => {
    expect(render("manager", {}, "/manager", "?view=oa")).not.toMatch(/rounded-full bg-destructive/)
  })

  it("主管端的分頁照 view 標目前這一項", () => {
    const html = render("manager", { oa: 3 }, "/manager", "?view=oa")
    expect(activeText(html)).toContain("簽核")
    expect(html).toContain(">3<")
  })

  it("收合後保留導覽名稱、提示、未讀數字與目前頁面", () => {
    const html = render("sales", { channels: 120 }, "/channels", "", true)
    expect(activeText(html)).toContain("頻道")
    expect(html).toContain('title="頻道（120）"')
    expect(html).toContain('class="sr-only">頻道</span>')
    expect(html).toContain(">99+<")
    expect(html).toContain('href="/orders"')
    expect(html).toContain('href="/calendar"')
  })
})

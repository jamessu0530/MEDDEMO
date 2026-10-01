import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import type { RepRoute } from "@/api/team-routes"
import { RepRouteCard } from "@/components/manager/rep-route-card"
import { repRoute, teamStop } from "@/lib/team-routes.fixtures"

const render = (route: RepRoute) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RepRouteCard, { route })))

describe("RepRouteCard", () => {
  it("名字、進度、下一站，點了進這位業務的詳細", () => {
    const html = render(repRoute())
    expect(html).toContain("林昱辰")
    expect(html).toContain("1/3 站 · 共 18.2 公里 · 約 16:40 收工")
    expect(html).toContain("下一站：第 2 站 客戶2 · 大安 · 10:40 到")
    expect(html).toContain('href="/manager?view=routes&amp;rep=U01"')
    expect(html).toContain('aria-valuenow="1"')
  })

  it("還沒動過是灰色的一行", () => {
    const html = render(repRoute())
    expect(html).toContain("照系統建議，還沒動過")
    expect(html).not.toContain("拿掉系統排的")
  })

  it("拿掉系統排的站是紅字、會晚到是琥珀色", () => {
    const html = render(
      repRoute({
        untouched: false,
        removed: [{ customer_id: "C9", customer_name: "和康藥局 · 松山", area: "松山", lat: 25.06, lng: 121.55, label: "帳款逾期", reason: "x" }],
        stops: [teamStop(1, "done"), teamStop(2, "next", { late_minutes: 25 })],
      })
    )
    expect(html).toMatch(/text-destructive[^>]*>(<svg[\s\S]*?<\/svg>)?拿掉系統排的 1 站：和康藥局 · 松山（帳款逾期）/)
    expect(html).toMatch(/text-warning[^>]*>(<svg[\s\S]*?<\/svg>)?1 站會晚到 25 分鐘/)
    expect(html).not.toContain("照系統建議，還沒動過")
  })

  it("位置是紫色的一行", () => {
    const html = render(repRoute({ location: { text: "在杏林診所附近", lat: 25.03, lng: 121.54, at: null, live: true } }))
    expect(html).toMatch(/text-primary[^>]*>(<svg[\s\S]*?<\/svg>)?在杏林診所附近/)
  })
})

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { RepRoutePath } from "@/components/manager/rep-route-path"
import { repRoute, teamStop } from "@/lib/team-routes.fixtures"

const render = (route = repRoute()) => renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(RepRoutePath, { route, backTo: "/manager?view=routes&rep=U01" }))
)

describe("主管查看業務的今日路線", () => {
  it("共用業務的站點、完成勾選與交通膠囊；只查看，不提供換交通方式、出發與自己的圖鑑", () => {
    const html = render()
    expect(html).toContain("林昱辰的今日路線")
    expect(html).toContain('data-stop-node="done"')
    expect(html).toContain('data-stop-node="next"')
    expect(html).toContain('data-stop-node="todo"')
    expect(html).toContain("開車 約 10 分")
    expect(html).toContain(">下一站<")
    expect(html).not.toContain(">出發<")
    expect(html).not.toContain("換交通方式")
    expect(html).not.toContain('href="/rides"')
    expect(html).toContain('href="/customers/C2"')
  })

  it("座騎跟著實際到站時間停在對應縣市，主管不能重播", () => {
    const html = render(repRoute({ stops: [
      teamStop(1, "done", { arrived_at: "2026-10-28T02:05:00Z", city: "新竹市", travel_mode: "scooter" }),
      teamStop(2, "next"),
    ] }))
    expect(html).toContain("10:05 到過")
    const park = html.indexOf("data-ride-park")
    expect(park).toBeGreaterThan(html.indexOf('data-ride-anchor="C1"'))
    expect(park).toBeLessThan(html.indexOf('data-ride-anchor="C2"'))
    expect(html).toContain('data-city="新竹市"')
    expect(html).not.toContain("重播")
  })

  it("沒有辦公室時由第一站起；沒有行程時顯示空狀態", () => {
    expect(render(repRoute({ office_start: false, origin: null, start_city: null }))).not.toContain('data-ride-anchor="office"')
    const html = render(repRoute({ stops: [], done: 0, total: 0 }))
    expect(html).toContain("今天沒有排定的拜訪。")
    expect(html).not.toContain("data-stop-node")
    expect(html).not.toContain("收工")
  })
})

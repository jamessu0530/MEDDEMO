import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { MapStop, RouteStop, TravelMode } from "@/api/route"
import { MapStopCard } from "@/components/route/map-stop-card"

function pin(number: number, status: MapStop["status"]): MapStop {
  return { number, customer_id: `C${number}`, customer_name: `康泰連鎖藥局 民生店`, status, lat: 25.0478, lng: 121.5319 }
}

const detail = (extra: Partial<RouteStop> = {}) =>
  ({ planned_time: "11:00", signal: "commitment", travel_minutes: 12, late_minutes: 0, window_kind: null, visit_id: null, ...extra }) as RouteStop

const render = (stop: MapStop, found: RouteStop | undefined, estimated = false, mode: TravelMode = "drive") =>
  renderToStaticMarkup(createElement(MapStopCard, { stop, detail: found, estimated, mode }))

describe("MapStopCard", () => {
  it("下一站：第幾站、到達時間、店名、理由與車程，加一顆導航", () => {
    const html = render(pin(3, "next"), detail())
    expect(html).toContain("下一站 · 第 3 站 · 11:00 到")
    expect(html).toContain("康泰連鎖藥局 民生店")
    expect(html).toMatch(/text-destructive[^>]*>承諾逾期/)
    expect(html).toContain("開車約 12 分")
    expect(html).toContain("Google Maps")
    expect(html).toContain('href="https://www.google.com/maps/dir/?api=1&amp;destination=25.0478,121.5319&amp;travelmode=driving"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain("導航")
  })

  it("車程是估算的就寫（估計），不掛 Google 的名字", () => {
    const html = render(pin(3, "todo"), detail(), true)
    expect(html).toMatch(/開車約 12 分<\/span><wbr\/><span class="whitespace-nowrap"><span>（估計）<\/span>/)
    expect(html).not.toContain("Google Maps")
  })

  it("約的時間趕不上：理由讓位給會晚到幾分", () => {
    const html = render(pin(3, "todo"), detail({ window_kind: "at", late_minutes: 25 }))
    expect(html).toMatch(/text-destructive[^>]*>會晚到 25 分/)
    expect(html).not.toContain("承諾逾期")
  })

  it("跑完的站：寫已完成（有回寫就說），不用導航", () => {
    const html = render(pin(1, "done"), detail({ planned_time: "09:10", visit_id: "V1", travel_minutes: null }))
    expect(html).toContain("第 1 站 · 09:10 完成")
    expect(html).toContain("已完成 · 已回寫")
    expect(html).not.toContain("導航")
  })

  it("首頁的行程裡找不到這一站：只有站號與店名，照樣能導航", () => {
    const html = render(pin(2, "next"), undefined)
    expect(html).toContain("下一站 · 第 2 站")
    expect(html).toContain("導航")
    expect(html).not.toContain("約 12 分")
  })

  it("騎機車：寫機車約幾分、導航開機車路線，Google 的機車路線註明是測試版", () => {
    const html = render(pin(3, "next"), detail(), false, "scooter")
    expect(html).toContain("機車約 12 分")
    expect(html).toContain("travelmode=two-wheeler")
    expect(html).toContain("Google 的機車路線是測試版")
    expect(render(pin(3, "next"), detail(), true, "scooter")).not.toContain("測試版")
  })

  it("搭大眾運輸：寫大眾運輸約幾分、導航開大眾運輸", () => {
    const html = render(pin(3, "next"), detail({ travel_minutes: 28 }), false, "transit")
    expect(html).toContain("大眾運輸約 28 分")
    expect(html).toContain("travelmode=transit")
  })
})

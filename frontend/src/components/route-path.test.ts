import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import type { LegMode, RouteStop } from "@/api/route"
import { RoutePath } from "@/components/route-path"

function stop(id: string, status: RouteStop["status"], extra: Partial<RouteStop> = {}): RouteStop {
  return {
    customer_id: id,
    customer_name: `客戶${id}`,
    type: "independent",
    grade: "A",
    planned_time: "10:00",
    status,
    signal: "ar",
    reason: "帳款最久拖了 78 天",
    visit_id: null,
    source: "model",
    duration_minutes: 40,
    late_minutes: 0,
    travel_minutes: 10,
    travel_km: 3.2,
    window_kind: null,
    window_time: null,
    note: null,
    locked: false,
    habit_ids: [],
    travel_mode: "drive",
    travel_estimated: false,
    city: "台北市",
    ...extra,
  }
}

const render = (stops: RouteStop[], onPickMode?: (from: string | null, to: string, mode: LegMode) => void) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RoutePath, { stops, onPickMode })))

describe("RoutePath 的出處與舊資料", () => {
  it("還沒走的段有 Google 算的才標 Google Maps", () => {
    const gone = (extra: Partial<RouteStop>) => [stop("a", "done"), stop("b", "next", extra)]
    expect(render(gone({ travel_estimated: false }))).toContain("Google Maps")
    expect(render(gone({ travel_estimated: true }))).not.toContain("Google Maps")
    // 只有已走完的段是 Google 算的：不算
    expect(render([stop("a", "done", { travel_estimated: false }), stop("b", "next", { travel_estimated: true })])).not.toContain(
      "Google Maps"
    )
  })

  it("0 公里的段（兩站同一個座標）不算 Google 的", () => {
    expect(render([stop("a", "next", { travel_estimated: false, travel_km: 0 })])).not.toContain("Google Maps")
  })

  it("沒有辦公室起點時，第一段不算 Google 的", () => {
    // 沒有辦公室的第一段是同一點到同一點：0 公里、後端標成不是估算
    const stops = [stop("a", "next", { travel_estimated: false, travel_km: 0 }), stop("b", "todo", { travel_estimated: true })]
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RoutePath, { stops, officeStart: false })))
    expect(html).not.toContain("Google Maps")
    // 第二段有公里數、不是估算：照樣標
    const second = [stops[0], stop("b", "todo", { travel_estimated: false })]
    expect(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RoutePath, { stops: second, officeStart: false })))).toContain("Google Maps")
  })

  it("站沒有 travel_mode（舊快取）時不丟錯，寫開車", () => {
    const old = stop("b", "next", { travel_mode: undefined as never })
    expect(render([old])).toContain("開車")
  })
})

describe("RoutePath", () => {
  const day = [stop("a", "done", { visit_id: "v1" }), stop("b", "done"), stop("c", "next"), stop("d", "todo"), stop("e", "todo")]

  it("三種狀態的圓鈕，已完成的打勾、其他寫站號", () => {
    const html = render(day)
    expect(html.match(/data-stop-node="done"/g)).toHaveLength(2)
    expect(html.match(/data-stop-node="next"/g)).toHaveLength(1)
    expect(html.match(/data-stop-node="todo"/g)).toHaveLength(2)
    expect(html).toContain(">3<")
    expect(html).toContain("10:00 完成 · 已回寫")
  })

  it("只有下一站有「出發」，連到客戶檔案", () => {
    const html = render(day)
    expect(html.match(/>出發</g)).toHaveLength(1)
    expect(html).toContain('href="/customers/c"')
  })

  it("小卡一開始是收起來的", () => {
    const html = render(day)
    expect(html).not.toContain("data-stop-popover")
    // 5 顆圓鈕 + 3 顆還沒走完的膠囊（走完的段不能展開，沒有 aria-expanded）
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(8)
  })

  it("熊熊滾騎著到下一站那一段的座騎停在下一站旁邊，點了重播；不再連到問答", () => {
    const stops = [
      stop("a", "done", { city: "新北市" }),
      stop("b", "done", { city: "新北市" }),
      stop("c", "next", { city: "新竹市", travel_mode: "scooter" }),
      stop("d", "todo", { city: "新竹市" }),
    ]
    const html = render(stops)
    expect(html.match(/data-ride-park/g)).toHaveLength(1)
    expect(html).toContain('data-city="新竹市"')
    expect(html).toContain('data-mode="scooter"')
    expect(html).toMatch(/aria-label="熊熊滾騎著貢丸的機車，點一下重播這一段"/)
    expect(html).not.toContain('href="/ask"')
    expect(html).not.toContain("mascot-yay")
    expect(html).toContain(">收工<")
  })

  it("座騎停在下一站那一列", () => {
    const html = render(day)
    // 座騎在下一站（c）的圓鈕之後、下一顆圓鈕（d）之前
    const ride = html.indexOf("data-ride-park")
    expect(ride).toBeGreaterThan(html.indexOf('aria-label="第 3 站 客戶c，下一站"'))
    expect(ride).toBeLessThan(html.indexOf('aria-label="第 4 站 客戶d，待拜訪"'))
  })

  it("改了到下一站那段的交通方式，停著的座騎跟著換", () => {
    const html = render([stop("a", "done"), stop("b", "next", { travel_mode: "walk" })])
    expect(html).toContain('data-mode="walk"')
    expect(html).toContain("熊熊滾騎著小籠包的走路")
  })

  it("要自動騎到下一站時，停著的座騎先藏起來，等一下從上一站騎過來", () => {
    const stops = [stop("a", "done"), stop("b", "next")]
    const auto = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RoutePath, { stops, autoRide: true })))
    expect(auto).toContain("motion-safe:opacity-0")
    expect(render(stops)).not.toContain("motion-safe:opacity-0")
  })

  it("沒有站就沒有座騎", () => {
    expect(render([])).not.toContain("data-ride-park")
  })

  it("全部跑完時終點寫跑完幾站，熊熊滾跳起來，不騎座騎", () => {
    const html = render([stop("a", "done"), stop("b", "done"), stop("c", "done")])
    expect(html).toContain("今天 3 站都跑完了")
    expect(html).toContain("mascot-yay")
    expect(html).not.toContain("data-ride-park")
    expect(html).not.toContain('href="/ask"')
    expect(html).not.toContain(">出發<")
  })

  it("收 startCity（第一段的出發縣市）", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RoutePath, { stops: [stop("a", "next", { city: "新北市" })], startCity: "台北市" }))
    )
    expect(html).toContain('data-city="新北市"')
  })

  it("有約的時間又趕不上，標籤第二行改成紅字會晚到幾分", () => {
    const html = render([stop("a", "next", { window_kind: "before", window_time: "10:00", late_minutes: 25 }), stop("b", "todo")])
    expect(html).toContain("會晚到 25 分")
    expect(html.match(/會晚到/g)).toHaveLength(1)
  })

  it("每站上面一顆膠囊寫怎麼過來；第一站從辦公室", () => {
    const html = render(
      [
        stop("a", "next", { travel_minutes: 18, travel_estimated: true }),
        stop("b", "todo", { travel_mode: "scooter", travel_minutes: 11 }),
      ],
      () => {}
    )
    expect(html.match(/data-leg-chip/g)).toHaveLength(2)
    expect(html).toContain("從辦公室")
    expect(html).toContain("開車 約 18 分")
    expect(html).toContain("機車 11 分")
  })

  it("已經走完的段不能點；沒給 onPickMode 時全部不能點", () => {
    const done = render([stop("a", "done", { travel_minutes: null }), stop("b", "next")], () => {})
    expect(done.match(/disabled=""/g)).toHaveLength(1)
    const readOnly = render([stop("a", "next"), stop("b", "todo")])
    expect(readOnly.match(/disabled=""/g)).toHaveLength(2)
  })

  it("沒有辦公室起點時第一站上面不放膠囊", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(RoutePath, { stops: [stop("a", "next"), stop("b", "todo")], officeStart: false, onPickMode: () => {} })
      )
    )
    expect(html.match(/data-leg-chip/g)).toHaveLength(1)
    expect(html).not.toContain("從辦公室")
  })
})

describe("RoutePath 的座騎圖鑑入口", () => {
  const withCollected = (collected?: { ridden: number; total: number } | null) =>
    renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RoutePath, { stops: [stop("a", "next")], collected }))
    )

  it("收工旗子下面寫座騎圖鑑 N/28，連到 /rides", () => {
    const html = withCollected({ ridden: 3, total: 28 })
    expect(html).toContain("座騎圖鑑 3/28")
    expect(html).toContain('href="/rides"')
  })

  it("拿不到數字就只寫座騎圖鑑", () => {
    const html = withCollected(null)
    expect(html).toContain("座騎圖鑑")
    expect(html).not.toContain("座騎圖鑑 ")
  })
})

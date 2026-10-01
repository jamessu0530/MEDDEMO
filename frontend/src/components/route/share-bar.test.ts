import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ShareBarView } from "@/components/route/share-bar"
import type { BarState } from "@/lib/location-share"

const HOURS = { weekdays: [1, 2, 3, 4, 5], start: "08:30", end: "18:30" }
const noop = () => {}

const render = (state: BarState) =>
  renderToStaticMarkup(
    createElement(ShareBarView, {
      state,
      managerName: "陳建宏",
      hours: HOURS,
      busy: false,
      error: null,
      onPause: noop,
      onResume: noop,
      onHelp: noop,
    })
  )

describe("ShareBarView", () => {
  it("分享中：綠點、到幾點、暫停", () => {
    const html = render("sharing")
    expect(html).toContain("位置分享中，陳建宏看得到你在哪（到 18:30）")
    expect(html).toContain("bg-success")
    expect(html).toContain(">暫停<")
  })

  it("暫停中：琥珀點、繼續", () => {
    const html = render("paused")
    expect(html).toContain("已暫停分享，陳建宏會看到「暫停分享」")
    expect(html).toContain("bg-warning")
    expect(html).toContain(">繼續<")
  })

  it("沒有權限：怎麼開", () => {
    const html = render("denied")
    expect(html).toContain("沒有開定位權限，陳建宏看不到你在哪")
    expect(html).toContain(">怎麼開<")
  })

  it("下班時間與還沒同意都不顯示分享列", () => {
    expect(render("hidden")).toBe("")
    expect(render("consent")).toBe("")
  })
})

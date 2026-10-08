import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { RideOnRoute } from "@/components/rides/ride-on-route"
import { parkFlipped, parkSide, parkTop, parkWidth, ROUTE_WIDTH } from "@/lib/ride-on-route"
import type { Leg } from "@/lib/rides"

describe("parkSide", () => {
  it("停在圓鈕沒有名字的那一側：置中或偏左停左邊，偏右停右邊", () => {
    expect(parkSide(0)).toBe("left")
    expect(parkSide(-40)).toBe("left")
    expect(parkSide(-64)).toBe("left")
    expect(parkSide(40)).toBe("right")
    expect(parkSide(64)).toBe("right")
  })
})

describe("parkWidth", () => {
  it("那一側從圓鈕邊到路線邊的空間減 4px：中線的站最寬、偏越多越窄", () => {
    // 390 寬的手機，左右各留 16px：路線寬 358
    expect(parkWidth(0, 358)).toBe(120)
    expect(parkWidth(40, 358)).toBe(106)
    expect(parkWidth(-40, 358)).toBe(106)
    expect(parkWidth(64, 358)).toBe(84)
    expect(parkWidth(-64, 358)).toBe(84)
  })

  it("夾在 84～120 之間", () => {
    expect(parkWidth(0, 1000)).toBe(120)
    expect(parkWidth(64, 200)).toBe(84)
  })

  it("量不到寬度時照 390 寬的手機排", () => {
    expect(ROUTE_WIDTH).toBe(358)
  })
})

describe("parkFlipped", () => {
  it("都面向圓鈕：座騎畫的是朝右，停在左邊不翻、停在右邊翻過來", () => {
    expect(parkFlipped(0)).toBe(false)
    expect(parkFlipped(-64)).toBe(false)
    expect(parkFlipped(40)).toBe(true)
  })
})

describe("parkTop", () => {
  it("座騎的地面線（框的 93.5%）對齊圓鈕底邊（54px）", () => {
    for (const width of [84, 106, 120]) {
      const height = Math.round((width * 2) / 3)
      expect(parkTop(width) + height * 0.935).toBeCloseTo(54, 5)
    }
  })
})

describe("RideOnRoute", () => {
  const leg = (extra: Partial<Leg> = {}): Leg => ({
    from: "a",
    to: "b",
    fromCity: "新北市",
    toCity: "新竹市",
    mode: "scooter",
    ...extra,
  })
  const render = (props: Partial<Parameters<typeof RideOnRoute>[0]> = {}) =>
    renderToStaticMarkup(createElement(RideOnRoute, { leg: leg(), offset: 0, containerWidth: 358, ...props }))

  it("是一顆按鈕，寫騎著哪個特產的什麼交通方式、點了重播", () => {
    const html = render()
    expect(html).toContain("<button")
    expect(html).toContain("data-ride-park")
    expect(html).toContain('aria-label="熊熊滾騎著貢丸的機車，點一下重播這一段"')
  })

  it("座騎是目的地縣市的、那一段的交通方式，停著不動", () => {
    const html = render({ leg: leg({ toCity: "台南市", mode: "transit" }) })
    expect(html).toContain('data-city="台南市"')
    expect(html).toContain('data-mode="transit"')
    expect(html).toContain("ride-still")
    expect(html).toContain('aria-label="熊熊滾騎著虱目魚的大眾運輸，點一下重播這一段"')
  })

  it("不在七個縣市裡：熊熊滾自己走過去", () => {
    const html = render({ leg: leg({ toCity: "花蓮縣" }) })
    expect(html).toContain('data-city="other"')
    expect(html).toContain('aria-label="熊熊滾正走去下一站，點一下重播這一段"')
  })

  it("停在左邊不翻、停在右邊翻過來；寬度照停的那一側算", () => {
    const left = render({ offset: -64 })
    expect(left).not.toContain("matrix(-1 0 0 1 300 0)")
    expect(left).toContain('width="84"')
    const right = render({ offset: 40 })
    expect(right).toContain("matrix(-1 0 0 1 300 0)")
    expect(right).toContain('width="106"')
  })
})

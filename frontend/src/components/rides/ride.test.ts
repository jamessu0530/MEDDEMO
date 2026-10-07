import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Ride } from "@/components/rides/ride"
import { LEG_MODES } from "@/lib/travel-mode"

const render = (props: Parameters<typeof Ride>[0]) => renderToStaticMarkup(createElement(Ride, props))

describe("Ride", () => {
  it("新竹的四種座騎都畫得出來，熊坐在上面", () => {
    for (const mode of LEG_MODES) {
      const svg = render({ city: "新竹市", mode })
      expect(svg, mode).toContain('viewBox="0 0 300 200"')
      expect(svg, mode).toContain(`data-mode="${mode}"`)
      expect(svg, mode).toContain('data-city="新竹市"')
      expect(svg, mode).toContain("mascot mascot-ride")
    }
  })

  it("大小照寬度算，高度是寬的三分之二", () => {
    const svg = render({ city: "新竹市", mode: "drive", size: 150 })
    expect(svg).toContain('width="150"')
    expect(svg).toContain('height="100"')
  })

  it("往左走時整組翻過來；still 時停住", () => {
    expect(render({ city: "新竹市", mode: "drive", flipped: true })).toContain("matrix(-1 0 0 1 300 0)")
    expect(render({ city: "新竹市", mode: "drive", still: true })).toContain("ride-still")
  })

  it("沒有座騎的縣市：熊用等待的踏步自己走", () => {
    const svg = render({ city: "桃園市", mode: "scooter" })
    expect(svg).toContain('data-city="other"')
    expect(svg).toContain("mascot mascot-wait")
  })

  it("預設是裝飾；有 label 時讀屏唸得出來", () => {
    expect(render({ city: "新竹市", mode: "walk" })).toContain('aria-hidden="true"')
    const svg = render({ city: "新竹市", mode: "walk", label: "熊熊滾踩著貢丸走過去" })
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="熊熊滾踩著貢丸走過去"')
  })
})

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Ride } from "@/components/rides/ride"
import { RIDE_CITIES } from "@/lib/rides"
import { LEG_MODES } from "@/lib/travel-mode"

const render = (props: Parameters<typeof Ride>[0]) => renderToStaticMarkup(createElement(Ride, props))

/** 不算縣市新色的：熊熊滾的主色、淺紫、深色、舌頭、道具淺紫、黃、白，與地面的線 */
const SHARED_COLORS = new Set(["#9B51E0", "#EADBFD", "#2B1B47", "#FF8FB3", "#C9A2F5", "#FFC93C", "#FFFFFF", "#E6E2EC"])

/** svg 裡的色碼，一律大寫、三位數的展開成六位數（#fff 與 #FFFFFF 算同一色） */
function hexColors(svg: string) {
  return (svg.match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g) ?? []).map((hex) => {
    const upper = hex.toUpperCase()
    return upper.length === 4 ? `#${[...upper.slice(1)].map((digit) => digit + digit).join("")}` : upper
  })
}

describe("Ride", () => {
  it("七個縣市 × 四種交通方式，28 種座騎都畫得出來，熊坐在上面", () => {
    for (const city of RIDE_CITIES) {
      for (const mode of LEG_MODES) {
        const svg = render({ city, mode })
        expect(svg, `${city} ${mode}`).toContain('viewBox="0 0 300 200"')
        expect(svg, `${city} ${mode}`).toContain(`data-city="${city}"`)
        expect(svg, `${city} ${mode}`).toContain(`data-mode="${mode}"`)
        expect(svg, `${city} ${mode}`).toContain("mascot mascot-ride")
      }
    }
  })

  it.each(RIDE_CITIES)("%s 的四種座騎只多用自己特產的顏色：扣掉熊熊滾與地面，最多 3 個色碼", (city) => {
    const svgs = LEG_MODES.map((mode) => render({ city, mode }))
    // 顏色只能寫成色碼（或 none），不然具名色、rgb()、漸層會繞過下面的計數
    const paints = svgs.flatMap((svg) => [...svg.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1]))
    expect(paints.filter((paint) => paint !== "none" && !/^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/.test(paint))).toEqual([])
    const own = new Set(svgs.flatMap(hexColors).filter((hex) => !SHARED_COLORS.has(hex)))
    expect(own.size, [...own].sort().join(" ")).toBeLessThanOrEqual(3)
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

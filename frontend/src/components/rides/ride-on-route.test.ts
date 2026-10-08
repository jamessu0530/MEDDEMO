import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { RideOnRoute } from "@/components/rides/ride-on-route"
import {
  easeInOut,
  legPoints,
  parkCenterX,
  parkFlipped,
  parkSide,
  parkTop,
  parkWidth,
  rideKeyframes,
  ROUTE_WIDTH,
  samplePath,
  shouldFlip,
  timeline,
} from "@/lib/ride-on-route"
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

  it("要自動騎這一段時，開始騎之前先藏起來（減少動態效果時不藏，直接停在這裡）", () => {
    expect(render({ autoPlay: true })).toContain("motion-safe:opacity-0")
    // 藏起來時不能聚焦、不被讀出來
    const openTag = (html: string) => html.slice(0, html.indexOf(">"))
    expect(openTag(render({ autoPlay: true }))).toContain('aria-hidden="true"')
    expect(openTag(render({ autoPlay: true }))).toContain('tabindex="-1"')
    expect(openTag(render())).not.toContain("aria-hidden")
    expect(openTag(render())).not.toContain("tabindex")
    expect(render()).not.toContain("opacity-0")
  })

  it("停著的時候只有一台座騎，沒有煙也沒有縣市名", () => {
    const html = render()
    expect(html.match(/<svg/g)).toHaveLength(1)
    expect(html).not.toContain("data-ride-puff")
    expect(html).not.toContain("data-ride-tag")
  })
})

describe("parkCenterX", () => {
  it("停著的座騎著地點離圓鈕中心多遠：圓鈕半寬 + 10px + 座騎半寬，停左邊是負的", () => {
    expect(parkCenterX(0, 358)).toBe(-(29 + 10 + 60))
    expect(parkCenterX(40, 358)).toBe(29 + 10 + 53)
    expect(parkCenterX(-64, 358)).toBe(-(29 + 10 + 42))
  })
})

describe("samplePath", () => {
  const from = { x: 0, y: 0 }
  const control = { x: 100, y: 0 }
  const to = { x: 100, y: 100 }

  it("取 n 點，頭尾就是起點與終點", () => {
    const points = samplePath(from, control, to, 16)
    expect(points).toHaveLength(16)
    expect(points[0]).toEqual(from)
    expect(points[15]).toEqual(to)
  })

  it("正中間那一點是二次貝茲的 t=0.5：起點、終點各 1/4，控制點 1/2", () => {
    const [, mid] = samplePath(from, control, to, 3)
    expect(mid.x).toBeCloseTo(75)
    expect(mid.y).toBeCloseTo(25)
  })

  it("給 ease：頭尾不變，起步比等速慢，正中間還在曲線正中間（ease-in-out 對稱）", () => {
    const eased = samplePath(from, control, to, 5, easeInOut)
    const even = samplePath(from, control, to, 5)
    expect(eased[0]).toEqual(from)
    expect(eased[4]).toEqual(to)
    expect(eased[1].x).toBeLessThan(even[1].x)
    expect(eased[2].x).toBeCloseTo(75)
    expect(eased[2].y).toBeCloseTo(25)
  })
})

describe("shouldFlip", () => {
  it("座騎畫的是朝右：往左走翻過來，往右或直直往下不翻", () => {
    expect(shouldFlip({ x: 100, y: 0 }, { x: 20, y: 90 })).toBe(true)
    expect(shouldFlip({ x: 20, y: 0 }, { x: 100, y: 90 })).toBe(false)
    expect(shouldFlip({ x: 20, y: 0 }, { x: 20, y: 90 })).toBe(false)
  })
})

describe("timeline", () => {
  it("共 3 秒：0.3 秒冒出來、2.4 秒沿路走、0.3 秒到站壓扁回彈", () => {
    const t = timeline(false)
    expect(t).toMatchObject({ total: 3000, popEnd: 300, moveEnd: 2700 })
    expect(t.swap).toBeNull()
    expect(t.puff).toBeNull()
    expect(t.tag).toBeNull()
  })

  it("跨縣市：走到一半換車，煙 0.4 秒、最濃的那一刻剛好換；頭上的縣市名從換車起 1 秒", () => {
    const t = timeline(true)
    expect(t.swap).toBe(1500)
    expect(t.puff).toEqual({ start: 1300, end: 1700 })
    expect(t.tag).toEqual({ start: 1500, end: 2500 })
  })
})

describe("legPoints", () => {
  // 圓鈕 58×54：給中心 x 與上緣
  const node = (x: number, top: number) => ({ left: x - 29, right: x + 29, top, bottom: top + 54 })

  it("起點是上一站停的地方，控制點在兩站之間膠囊那一列的正中間；都以終點（停著的著地點）為原點", () => {
    // 上一站在中線（195），下一站偏右 40（235）
    const end = { x: 235 + 92, y: 300 }
    const points = legPoints({
      end,
      node: node(235, 246),
      legRow: { top: 100, bottom: 144 },
      prev: { node: node(195, 10), offset: 0 },
      offset: 40,
      containerWidth: 358,
    })
    expect(points.to).toEqual({ x: 0, y: 0 })
    expect(points.from).toEqual({ x: 195 - 99 - end.x, y: 64 - end.y })
    expect(points.control).toEqual({ x: (195 + 235) / 2 - end.x, y: 122 - end.y })
    // 上一站停的寬（120）比這一站（106）寬：從那個大小縮過來
    expect(points.scale).toBeCloseTo(120 / 106)
  })

  it("從辦公室出發：從這一站正上方、膠囊那一列底下冒出來，先往停的那一側再往下", () => {
    const end = { x: 195 - 99, y: 162 }
    const points = legPoints({
      end,
      node: node(195, 108),
      legRow: { top: 8, bottom: 52 },
      prev: null,
      offset: 0,
      containerWidth: 358,
    })
    expect(points.from).toEqual({ x: 99, y: 52 - 162 })
    expect(points.control).toEqual({ x: 0, y: 52 - 162 })
    expect(points.to).toEqual({ x: 0, y: 0 })
    expect(points.scale).toBe(1)
  })
})

describe("rideKeyframes", () => {
  const points = { from: { x: -200, y: -150 }, control: { x: -100, y: -60 }, to: { x: 0, y: 0 }, scale: 1 }
  const at = (frame: Keyframe) => frame.offset as number

  it("在起點從 0.6 倍彈出來，沿路 16 點，到站壓扁回彈，最後回到停的位置", () => {
    const frames = rideKeyframes(points, timeline(false))
    expect(frames[0]).toMatchObject({ offset: 0, opacity: 0, transform: "translate(-200px, -150px) scale(0.6, 0.6)" })
    expect(frames.at(-1)).toMatchObject({ offset: 1, opacity: 1, transform: "translate(0px, 0px) scale(1, 1)" })
    const offsets = frames.map(at)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
    // 彈出來時放大到 1.1
    expect(frames.some((frame) => at(frame) < 0.1 && String(frame.transform).endsWith("scale(1.1, 1.1)"))).toBe(true)
    // 沿路那 16 點：0.3 秒還在起點、2.7 秒到終點
    const moving = frames.filter((frame) => at(frame) >= 0.1 && at(frame) <= 0.9)
    expect(moving).toHaveLength(16)
    expect(moving[0].transform).toBe("translate(-200px, -150px) scale(1, 1)")
    expect(moving[15].transform).toBe("translate(0px, 0px) scale(1, 1)")
    // 到站壓扁（橫 1.1、直 0.9）
    expect(frames.some((frame) => at(frame) > 0.9 && String(frame.transform).endsWith("scale(1.1, 0.9)"))).toBe(true)
  })

  it("上一站停得比較寬：從那個大小沿路慢慢變成這一站的大小", () => {
    const frames = rideKeyframes({ ...points, scale: 1.2 }, timeline(false))
    expect(frames[0].transform).toBe("translate(-200px, -150px) scale(0.72, 0.72)")
    const moving = frames.filter((frame) => at(frame) >= 0.1 && at(frame) <= 0.9)
    expect(moving[0].transform).toBe("translate(-200px, -150px) scale(1.2, 1.2)")
    expect(moving[15].transform).toBe("translate(0px, 0px) scale(1, 1)")
  })
})

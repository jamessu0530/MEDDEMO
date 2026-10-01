import { describe, expect, it } from "vitest"

import { avatarTone } from "@/lib/presence"
import {
  boundsOf,
  decodePolyline,
  formatDriveTime,
  headerLine,
  lateLine,
  legPaths,
  nextStopLine,
  progressLine,
  removedLine,
  ROUTE_COLOR_VARS,
  routeColorVar,
  totalsLine,
  windowLabel,
  withLocation,
  withLocations,
} from "@/lib/team-routes"
import { repRoute, teamRoutes, teamStop } from "@/lib/team-routes.fixtures"

const removed = (name: string, label: string) => ({
  customer_id: name, customer_name: name, area: "松山", lat: 25.06, lng: 121.55, label, reason: "帳款最久拖了 78 天",
})

describe("團隊總覽的文字", () => {
  it("頁首寫日期、範圍、幾位業務與更新時間", () => {
    expect(headerLine(teamRoutes())).toBe("10/28（三）· 北區 2 位業務 · 11:02 更新")
    expect(headerLine(teamRoutes({ scope: "全公司", reps: [] }))).toBe("10/28（三）· 全公司 0 位業務 · 11:02 更新")
  })

  it("進度、公里與收工時間；跑完了就沒有收工時間", () => {
    expect(progressLine(repRoute())).toBe("1/3 站 · 共 18.2 公里 · 約 16:40 收工")
    expect(progressLine(repRoute({ done: 3, travel_km: 0, finish_time: null }))).toBe("3/3 站 · 共 0 公里")
  })

  it("下一站寫站號、店名與到達時間", () => {
    expect(nextStopLine(repRoute().stops)).toBe("下一站：第 2 站 客戶2 · 大安 · 10:40 到")
    expect(nextStopLine([teamStop(1, "done")])).toBeNull()
  })

  it("拿掉系統排的站：店名加理由類別，好幾家用頓號分開", () => {
    expect(removedLine([])).toBeNull()
    expect(removedLine([removed("和康藥局 · 松山", "帳款逾期")])).toBe("拿掉系統排的 1 站：和康藥局 · 松山（帳款逾期）")
    expect(removedLine([removed("甲", "帳款逾期"), removed("乙", "例行拜訪")])).toBe(
      "拿掉系統排的 2 站：甲（帳款逾期）、乙（例行拜訪）"
    )
  })

  it("會晚到只算還沒跑的站", () => {
    expect(lateLine(repRoute().stops)).toBeNull()
    expect(lateLine([teamStop(1, "done", { late_minutes: 30 }), teamStop(2, "next", { late_minutes: 25 })])).toBe(
      "1 站會晚到 25 分鐘"
    )
    expect(lateLine([teamStop(1, "next", { late_minutes: 10 }), teamStop(2, "todo", { late_minutes: 25 })])).toBe(
      "2 站會晚到，最多 25 分鐘"
    )
  })
})

describe("一位業務的詳細", () => {
  it("車程寫成幾小時幾分", () => {
    expect(formatDriveTime(0)).toBe("0 分")
    expect(formatDriveTime(45)).toBe("45 分")
    expect(formatDriveTime(60)).toBe("1 小時")
    expect(formatDriveTime(85)).toBe("1 小時 25 分")
  })

  it("地圖下面那一行標明是 Google 的道路車程還是估計", () => {
    expect(totalsLine(repRoute())).toBe("共 18.2 公里 · 車程 1 小時 25 分（估計）")
    expect(totalsLine(repRoute({ estimated: false }))).toBe("共 18.2 公里 · 車程 1 小時 25 分（Google 道路車程）")
  })

  it("約的時間", () => {
    expect(windowLabel(teamStop(1, "todo"))).toBeNull()
    expect(windowLabel(teamStop(1, "todo", { window_kind: "at", window_time: "11:00" }))).toBe("約 11:00 到")
    expect(windowLabel(teamStop(1, "todo", { window_kind: "before", window_time: "11:00" }))).toBe("11:00 以前到")
    expect(windowLabel(teamStop(1, "todo", { window_kind: "after", window_time: "14:00" }))).toBe("14:00 以後到")
  })
})

describe("地圖", () => {
  it("路線顏色跟頭像底色同一套、同一個順序", () => {
    // 跟 components/user-avatar.tsx 的 TONES 同一個順序，改一邊沒跟著改的話這裡會壞
    expect(ROUTE_COLOR_VARS).toEqual(["--primary", "--chart-4", "--chart-5", "--warning", "--muted-foreground"])
    for (const id of ["U01", "U02", "U03", "M01"]) {
      expect(routeColorVar(id)).toBe(ROUTE_COLOR_VARS[avatarTone(id, ROUTE_COLOR_VARS.length)])
    }
  })

  it("解得開 Google 的編碼折線", () => {
    // Google 文件上的例子
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ])
    expect(decodePolyline("")).toEqual([])
  })

  it("每一段有折線用折線，沒有就從上一點連直線到這一站", () => {
    const route = repRoute({
      legs: [
        { polyline: "_p~iF~ps|U_ulLnnqC", done: true },
        { polyline: null, done: false },
        { polyline: null, done: false },
      ],
    })
    const paths = legPaths(route)
    expect(paths).toHaveLength(3)
    expect(paths[0]).toEqual({ done: true, path: [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }] })
    expect(paths[1]).toEqual({ done: false, path: [route.stops[0], route.stops[1]].map(({ lat, lng }) => ({ lat, lng })) })
    // 沒有出發點：第一段從第 1 站開到第 2 站
    const noOffice = legPaths(repRoute({ origin: null, legs: [{ polyline: null, done: false }, { polyline: null, done: false }] }))
    expect(noOffice[0].path).toEqual([route.stops[0], route.stops[1]].map(({ lat, lng }) => ({ lat, lng })))
  })

  it("地圖範圍框住所有的點", () => {
    expect(boundsOf([])).toBeNull()
    expect(boundsOf([{ lat: 25, lng: 121.5 }, { lat: 24, lng: 121.6 }, { lat: 24.5, lng: 121.4 }])).toEqual({
      north: 25,
      south: 24,
      east: 121.6,
      west: 121.4,
    })
  })
})

describe("即時位置", () => {
  const here = { text: "往第 2 站客戶2途中 · 1 分鐘前", lat: 25.04, lng: 121.55, at: "2026-10-01T03:00:00Z", live: true }

  it("只換掉位置與更新時間，行程不動", () => {
    const data = teamRoutes()
    const next = withLocations(data, { updated_at: "11:05", locations: { U01: here } })
    expect(next.updated_at).toBe("11:05")
    expect(next.reps[0].location).toEqual(here)
    expect(next.reps[0].stops).toBe(data.reps[0].stops)
    // 沒給的業務照舊
    expect(next.reps[1]).toBe(data.reps[1])
  })

  it("一位業務的詳細也一樣", () => {
    const route = repRoute()
    expect(withLocation(route, { updated_at: "11:05", locations: { U01: here } }).location).toEqual(here)
    expect(withLocation(route, { updated_at: "11:05", locations: {} })).toBe(route)
  })
})

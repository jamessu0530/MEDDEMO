import type { RouteSignal } from "@/api/route"

/**
 * 今日路線像 Duolingo 的路一樣左右蛇行（components/route-path.tsx）。這裡只管排法：
 * 第幾站往左右偏多少、名字標在哪一邊、熊熊滾站在哪一站旁邊。
 */

// 圓鈕中心離畫面中線多少 px（正的往右），8 站一個來回
export const PATH_OFFSETS = [0, 40, 64, 40, 0, -40, -64, -40] as const

export function pathOffset(index: number): number {
  return PATH_OFFSETS[index % PATH_OFFSETS.length]
}

/** 名字標在圓鈕空出來的那一側：圓鈕偏右就標左邊，置中或偏左就標右邊 */
export function labelSide(offset: number): "left" | "right" {
  return offset > 0 ? "left" : "right"
}

/**
 * 熊熊滾站在哪一站的左邊：從下一站（沒標下一站就從第一個還沒去的）往後找第一個置中的站，
 * 置中的站名字標在右邊，左邊剛好空著。找不到、或全部跑完了，回 null，站在終點旁邊。
 */
export function bearStopIndex(stops: { status: "done" | "next" | "todo" }[]): number | null {
  let start = stops.findIndex((stop) => stop.status === "next")
  if (start < 0) start = stops.findIndex((stop) => stop.status === "todo")
  if (start < 0) return null
  for (let index = start; index < stops.length; index += 1) {
    if (pathOffset(index) === 0) return index
  }
  return null
}

/** 理由的顏色：商機是唯一的好消息（綠），例行是平常（灰），其他都是要注意的事（紅） */
export function signalTone(signal: RouteSignal): "good" | "alert" | "plain" {
  if (signal === "opportunity") return "good"
  if (signal === "routine") return "plain"
  return "alert"
}

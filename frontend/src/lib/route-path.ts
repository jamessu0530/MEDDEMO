import type { RouteSignal } from "@/api/route"

/**
 * 今日路線像 Duolingo 的路一樣左右蛇行（components/route-path.tsx）。這裡只管排法：
 * 第幾站往左右偏多少、名字標在哪一邊。熊熊滾的座騎停在哪裡在 lib/ride-on-route.ts。
 */

// 圓鈕 58×54（跟 Duolingo 一樣略寬）：半寬與高，跟 route-path.tsx 的 w-[58px] h-[54px] 一致
export const HALF_NODE = 29
export const NODE_HEIGHT = 54

// 圓鈕中心離畫面中線多少 px（正的往右），8 站一個來回
export const PATH_OFFSETS = [0, 40, 64, 40, 0, -40, -64, -40] as const

export function pathOffset(index: number): number {
  return PATH_OFFSETS[index % PATH_OFFSETS.length]
}

/** 名字標在圓鈕空出來的那一側：圓鈕偏右就標左邊，置中或偏左就標右邊 */
export function labelSide(offset: number): "left" | "right" {
  return offset > 0 ? "left" : "right"
}

/** 理由的顏色：商機是唯一的好消息（綠），例行是平常（灰），其他都是要注意的事（紅） */
export function signalTone(signal: RouteSignal): "good" | "alert" | "plain" {
  if (signal === "opportunity") return "good"
  if (signal === "routine") return "plain"
  return "alert"
}

/** 理由類別的字色：商機綠、警示紅、例行灰 */
export const TONE_CLASS = { good: "text-success", alert: "text-destructive", plain: "text-muted-foreground" } as const

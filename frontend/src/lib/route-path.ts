import type { RouteSignal, RouteStop } from "@/api/route"

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

/** 商機用綠色，例行與經營策略用中性色，風險訊號用警示色。 */
export function signalTone(signal: RouteSignal): "good" | "alert" | "plain" {
  if (signal === "opportunity") return "good"
  if (signal === "routine" || signal === "priority" || signal === "manager_priority") return "plain"
  return "alert"
}

/** 理由類別的字色：商機綠、警示紅、例行灰 */
export const TONE_CLASS = { good: "text-success", alert: "text-destructive", plain: "text-muted-foreground" } as const

/**
 * 哪一列上面多留「出發」泡泡的空間（mt-14）。平常是下一站；熊在騎的時候照開始騎時那一列（held），
 * 點的就是下一站時，回應把它標成到過、下一站換人，路線在熊上方也不會騎到一半往上移 56px，騎完再平順搬過去。
 */
export function departureRow(
  stops: readonly Pick<RouteStop, "customer_id" | "status">[],
  held: string | null,
  riding: boolean
): string | null {
  if (riding) return held
  return stops.find((stop) => stop.status === "next")?.customer_id ?? null
}

import type { Medal, MedalKind } from "@/api/me"
import { formatDate } from "@/lib/format"

/*
 * 個人頁的獎牌（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）：
 * 兩類各三級，門檻在後端 achievements.MEDAL_TIERS。這裡只管字、看過的記錄與圖表的刻度。
 */

export const MEDAL_KIND_LABEL: Record<MedalKind, string> = { stores: "跑過的藥局", cities: "跑過的縣市" }
export const MEDAL_UNIT: Record<MedalKind, string> = { stores: "家", cities: "個縣市" }
const WHAT: Record<MedalKind, string> = { stores: "家藥局", cities: "個縣市" }
export const TIER_NAME = { 1: "銅牌", 2: "銀牌", 3: "金牌" } as const
const COUNT = ["", "一", "兩", "三", "四", "五", "六"]

export const medalId = (m: Medal) => `${m.kind}${m.tier}`

/** 牌子下面那一行：「10/28 解鎖」或「還差 2 家」 */
export function medalStatus(m: Medal): string {
  return m.unlocked_on ? `${formatDate(m.unlocked_on)} 解鎖` : `還差 ${m.need - m.have} ${MEDAL_UNIT[m.kind]}`
}

/** 點了沒解鎖的那面：「再跑 2 家藥局就拿到金牌」 */
export function lockedHint(m: Medal): string {
  return `再跑 ${m.need - m.have} ${WHAT[m.kind]}就拿到${TIER_NAME[m.tier]}`
}

/** 立體獎牌背面的兩行 */
export function medalBack(m: Medal): [string, string] {
  if (m.unlocked_on) return [`${m.need} ${m.kind === "stores" ? "家" : "縣市"}`, formatDate(m.unlocked_on)]
  return [`差 ${m.need - m.have}`, "還沒解鎖"]
}

const what = (m: Medal) => `跑過 ${m.need} ${WHAT[m.kind]}`

/** 首頁那一句：同一級寫「解鎖兩面金牌：…、…」，不同級逐面寫 */
export function unlockedText(medals: Medal[]): string {
  if (medals.length > 1 && medals.every((m) => m.tier === medals[0].tier))
    return `解鎖${COUNT[medals.length]}面${TIER_NAME[medals[0].tier]}：${medals.map(what).join("、")}`
  return `解鎖${medals.map((m) => `${TIER_NAME[m.tier]}：${what(m)}`).join("；")}`
}

const seenKey = (userId: string) => `meddemo:medals-seen:${userId}`
// 看過的記錄鍵含解鎖的那一刻：系統日固定在決賽日，IT 重置前後解鎖日一樣，靠時間分辨，重置後再解鎖會再演一次
const seenTag = (m: Medal) => `${medalId(m)}@${m.unlocked_at}`

/** 這支手機看過哪幾面解鎖的；壞掉或不讓讀都當成沒看過 */
export function readSeen(userId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(seenKey(userId)) ?? "[]")
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
  } catch {
    return new Set()
  }
}

/** 把現在解鎖的都記成看過（只留解鎖的，鍵不會一直長） */
export function markSeen(userId: string, medals: Medal[]) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify(medals.filter((m) => m.unlocked_on).map(seenTag)))
  } catch {
    // 存不進去就算了，頂多下次再演一次
  }
}

/** 新解鎖、還沒看過的那幾面（medalId） */
export function freshIds(medals: Medal[], seen: Set<string>): string[] {
  return medals.filter((m) => m.unlocked_on && !seen.has(seenTag(m))).map(medalId)
}

const STEPS = [100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000]

/** 每月業績的格線：0 與三條，間隔取 10／20／50／100… 萬裡最小的、三格蓋得過最大值 */
export function niceTicks(max: number): number[] {
  const step = STEPS.find((s) => s * 3 >= max) ?? STEPS[STEPS.length - 1]
  return [0, step, step * 2, step * 3]
}

import type { Medal, MedalKind } from "@/api/me"
import { formatDate } from "@/lib/format"

/*
 * 個人頁的獎牌（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）：
 * 六類各三級，門檻與條件由後端提供。這裡只管字、看過的記錄與圖表的刻度。
 */

export const MEDAL_KIND_LABEL: Record<MedalKind, string> = {
  stores: "跑過的藥局", cities: "跑過的縣市", chronic: "慢性處方", otc: "一般用藥", wellness: "保健品", devices: "醫材",
}
export const MEDAL_UNIT: Record<MedalKind, string> = { stores: "家", cities: "個縣市", chronic: "關", otc: "關", wellness: "關", devices: "關" }
const WHAT: Partial<Record<MedalKind, string>> = { stores: "家藥局", cities: "個縣市" }
export const MEDAL_KINDS: MedalKind[] = ["stores", "cities", "chronic", "otc", "wellness", "devices"]
export const isProductMedal = (kind: MedalKind) => kind !== "stores" && kind !== "cities"
const MEDAL_NAMES: Record<MedalKind, [string, string, string]> = {
  stores: ["初次到訪", "街坊熟客", "藥局巡訪家"], cities: ["城市起點", "跨城探索", "縣市旅行家"],
  chronic: ["處方品類入門", "處方規格熟手", "處方品項達人"], otc: ["一般用藥入門", "用藥品項熟手", "一般用藥達人"],
  wellness: ["保健品入門", "保健品辨識員", "保健品達人"], devices: ["醫材入門", "器材辨識員", "醫材達人"],
}
export const medalName = (m: Medal) => m.title || MEDAL_NAMES[m.kind][m.tier - 1]
export function medalCondition(m: Medal): string {
  if (m.condition) return m.condition
  return isProductMedal(m.kind)
    ? `依序通過${MEDAL_KIND_LABEL[m.kind]}前 ${m.need} 關，每關全部答對。`
    : `在首頁累積到訪 ${m.need} ${m.kind === "stores" ? "家不同藥局" : "個不同縣市"}。`
}
export function medalProgress(m: Medal) {
  const completed = Math.max(0, Math.min(m.need, m.have))
  return { completed, total: m.need, percent: Math.min(100, Math.round(completed / Math.max(1, m.need) * 100)) }
}
export const medalAction = (m: Medal) => m.action_path || (isProductMedal(m.kind) ? `/learning/products/${m.kind}/${m.tier}` : "/")
export const TIER_NAME = { 1: "銅牌", 2: "銀牌", 3: "金牌" } as const
const COUNT = ["", "一", "兩", "三", "四", "五", "六"]

export const medalId = (m: Medal) => `${m.kind}${m.tier}`

/** 牌子下面那一行：「10/28 解鎖」或「還差 2 家」 */
export function medalStatus(m: Medal): string {
  return m.unlocked_on ? `${formatDate(m.unlocked_on)} 解鎖` : `還差 ${m.need - m.have} ${MEDAL_UNIT[m.kind]}`
}

/** 點了沒解鎖的那面：「再跑 2 家藥局就拿到金牌」 */
export function lockedHint(m: Medal): string {
  if (isProductMedal(m.kind)) return `${medalName(m)}：${medalCondition(m)}目前完成 ${m.have} / ${m.need} 關。`
  return `再跑 ${m.need - m.have} ${WHAT[m.kind]}就拿到${TIER_NAME[m.tier]}`
}

/** 立體獎牌背面的兩行 */
export function medalBack(m: Medal): [string, string] {
  if (m.unlocked_on) return [`${m.need} ${isProductMedal(m.kind) ? "關" : m.kind === "stores" ? "家" : "縣市"}`, formatDate(m.unlocked_on)]
  return [`差 ${m.need - m.have}`, "還沒解鎖"]
}

const what = (m: Medal) => isProductMedal(m.kind) ? medalName(m) : `跑過 ${m.need} ${WHAT[m.kind]}`

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

/** 更新這次呈現的獎牌；過關頁只傳一面，也要保留其他獎牌的看過紀錄。 */
export function markSeen(userId: string, medals: Medal[]) {
  try {
    const seen = readSeen(userId)
    for (const medal of medals) {
      const prefix = `${medalId(medal)}@`
      for (const tag of seen) if (tag.startsWith(prefix)) seen.delete(tag)
      if (medal.unlocked_on) seen.add(seenTag(medal))
    }
    localStorage.setItem(seenKey(userId), JSON.stringify([...seen]))
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

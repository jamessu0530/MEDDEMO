import { afterEach, describe, expect, it, vi } from "vitest"

import type { Medal } from "@/api/me"
import { freshIds, lockedHint, markSeen, medalBack, medalId, medalStatus, medalName, medalCondition, medalProgress, niceTicks, readSeen, unlockedText } from "@/lib/medals"

const medal = (kind: Medal["kind"], tier: Medal["tier"], need: number, have: number, unlocked_on: string | null = null): Medal => ({
  kind, tier, need, have, unlocked_on, unlocked_at: unlocked_on && `${unlocked_on}T09:18:04.123456+08:00`,
})

describe("獎牌的字", () => {
  it("品類成就有條件與名稱，已過的關數不讓進度條超過 100%", () => {
    const device = medal("devices", 2, 2, 1)
    expect(medalName(device)).toBe("器材辨識員")
    expect(medalCondition(device)).toContain("前 2 關，每關全部答對")
    expect(medalProgress(device)).toEqual({ completed: 1, total: 2, percent: 50 })
    expect(medalProgress({ ...device, have: 3 })).toEqual({ completed: 2, total: 2, percent: 100 })
    expect(lockedHint(device)).toContain("目前完成 1 / 2 關")
    expect(unlockedText([medal("wellness", 3, 3, 3, "2026-10-14")])).toBe("解鎖金牌：保健品達人")
  })
  it("解鎖的寫日期，沒解鎖的寫還差多少", () => {
    expect(medalStatus(medal("stores", 2, 3, 3, "2026-10-28"))).toBe("10/28 解鎖")
    expect(medalStatus(medal("stores", 3, 5, 3))).toBe("還差 2 家")
    expect(medalStatus(medal("cities", 3, 3, 2))).toBe("還差 1 個縣市")
  })

  it("點了沒解鎖的：再跑幾家就拿到哪一級", () => {
    expect(lockedHint(medal("stores", 3, 5, 3))).toBe("再跑 2 家藥局就拿到金牌")
    expect(lockedHint(medal("cities", 2, 2, 1))).toBe("再跑 1 個縣市就拿到銀牌")
  })

  it("背面兩行：解鎖的是門檻與日期，沒解鎖的是差幾個", () => {
    expect(medalBack(medal("stores", 1, 1, 1, "2026-10-28"))).toEqual(["1 家", "10/28"])
    expect(medalBack(medal("cities", 3, 3, 2))).toEqual(["差 1", "還沒解鎖"])
  })

  it("首頁那一句：一面或兩面", () => {
    expect(unlockedText([medal("stores", 2, 3, 3, "2026-10-28")])).toBe("解鎖銀牌：跑過 3 家藥局")
    expect(unlockedText([medal("stores", 3, 5, 5, "2026-10-28"), medal("cities", 3, 3, 3, "2026-10-28")])).toBe(
      "解鎖兩面金牌：跑過 5 家藥局、跑過 3 個縣市"
    )
    // 第一次點站通常是這樣：兩面銅牌
    expect(unlockedText([medal("stores", 1, 1, 1, "2026-10-28"), medal("cities", 1, 1, 1, "2026-10-28")])).toBe(
      "解鎖兩面銅牌：跑過 1 家藥局、跑過 1 個縣市"
    )
    expect(unlockedText([medal("stores", 2, 3, 3, "2026-10-28"), medal("cities", 1, 1, 1, "2026-10-28")])).toBe(
      "解鎖銀牌：跑過 3 家藥局；銅牌：跑過 1 個縣市"
    )
  })
})

describe("新解鎖、這支手機還沒看過的", () => {
  afterEach(() => vi.unstubAllGlobals())

  function fakeStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial))
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    })
    return data
  }

  it("看過的記在 localStorage，鍵含解鎖的那一刻", () => {
    fakeStorage()
    const open = medal("stores", 1, 1, 1, "2026-10-28")
    expect(freshIds([open, medal("stores", 2, 3, 1)], readSeen("U01"))).toEqual([medalId(open)])
    markSeen("U01", [open])
    expect(freshIds([open], readSeen("U01"))).toEqual([])
    // IT 重置後再解鎖：系統日固定，解鎖日一樣是 10/28，但解鎖的時間換了，要再演一次
    expect(freshIds([{ ...open, unlocked_at: "2026-10-28T11:02:40.5+08:00" }], readSeen("U01"))).toHaveLength(1)
  })

  it("壞掉的 JSON 或 localStorage 丟例外都當成沒看過，不會壞", () => {
    fakeStorage({ "meddemo:medals-seen:U01": "{壞" })
    expect(readSeen("U01").size).toBe(0)
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(readSeen("U01").size).toBe(0)
    expect(() => markSeen("U01", [medal("stores", 1, 1, 1, "2026-10-28")])).not.toThrow()
  })

  it("單面過關畫面保留其他已看過的獎牌，重置仍會清掉該面", () => {
    fakeStorage()
    const route = medal("stores", 1, 1, 1, "2026-10-28")
    const device = { ...route, kind: "devices" as const }
    markSeen("U01", [route])
    markSeen("U01", [device])
    expect(freshIds([route, device], readSeen("U01"))).toEqual([])
    markSeen("U01", [{ ...route, unlocked_on: null, unlocked_at: null }])
    expect(readSeen("U01").size).toBe(1)
    expect(freshIds([route, device], readSeen("U01"))).toEqual([medalId(route)])
  })
})

describe("niceTicks", () => {
  it("四條格線，最上面一條剛好蓋過最大值，間隔是整數的萬", () => {
    expect(niceTicks(2920623)).toEqual([0, 1000000, 2000000, 3000000])
    expect(niceTicks(450000)).toEqual([0, 200000, 400000, 600000])
    expect(niceTicks(0)).toEqual([0, 100000, 200000, 300000])
  })
})

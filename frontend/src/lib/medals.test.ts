import { afterEach, describe, expect, it, vi } from "vitest"

import type { Medal } from "@/api/me"
import { freshIds, lockedHint, markSeen, medalBack, medalId, medalStatus, niceTicks, readSeen, unlockedText } from "@/lib/medals"

const medal = (kind: Medal["kind"], tier: Medal["tier"], need: number, have: number, unlocked_on: string | null = null): Medal => ({
  kind, tier, need, have, unlocked_on,
})

describe("獎牌的字", () => {
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

  it("看過的記在 localStorage，鍵含解鎖日期", () => {
    fakeStorage()
    const open = medal("stores", 1, 1, 1, "2026-10-28")
    expect(freshIds([open, medal("stores", 2, 3, 1)], readSeen("U01"))).toEqual([medalId(open)])
    markSeen("U01", [open])
    expect(freshIds([open], readSeen("U01"))).toEqual([])
    // IT 重置後再解鎖（日期一樣也會換一次記錄：鍵含日期，這裡模擬不同日期）
    expect(freshIds([{ ...open, unlocked_on: "2026-10-29" }], readSeen("U01"))).toHaveLength(1)
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
})

describe("niceTicks", () => {
  it("四條格線，最上面一條剛好蓋過最大值，間隔是整數的萬", () => {
    expect(niceTicks(2920623)).toEqual([0, 1000000, 2000000, 3000000])
    expect(niceTicks(450000)).toEqual([0, 200000, 400000, 600000])
    expect(niceTicks(0)).toEqual([0, 100000, 200000, 300000])
  })
})

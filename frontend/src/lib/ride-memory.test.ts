import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { markPlayed, queueRides, readPlayed, takeQueuedRides } from "@/lib/ride-memory"

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

let storage: ReturnType<typeof fakeStorage>

beforeEach(() => {
  storage = fakeStorage()
  vi.stubGlobal("localStorage", storage)
})

afterEach(() => vi.unstubAllGlobals())

describe("播過的段", () => {
  it("沒記過是空的", () => expect(readPlayed("2026-10-08").size).toBe(0))

  it("記下來照日期分開，重複記只有一筆", () => {
    markPlayed("2026-10-08", "office>a")
    markPlayed("2026-10-08", "office>a")
    markPlayed("2026-10-08", "a>b")
    expect([...readPlayed("2026-10-08")]).toEqual(["office>a", "a>b"])
    expect(readPlayed("2026-10-09").size).toBe(0)
    expect(storage.data.has("meddemo:rides-played:2026-10-08")).toBe(true)
  })

  it("壞掉的 JSON 當作空的，之後還能寫", () => {
    storage.data.set("meddemo:rides-played:2026-10-08", "{oops")
    expect(readPlayed("2026-10-08").size).toBe(0)
    markPlayed("2026-10-08", "a>b")
    expect([...readPlayed("2026-10-08")]).toEqual(["a>b"])
  })

  it("存的不是陣列也當作空的", () => {
    storage.data.set("meddemo:rides-played:2026-10-08", '{"a":1}')
    expect(readPlayed("2026-10-08").size).toBe(0)
  })

  it("localStorage 丟例外時不會壞", () => {
    const boom = () => {
      throw new Error("denied")
    }
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom })
    expect(readPlayed("2026-10-08").size).toBe(0)
    expect(() => markPlayed("2026-10-08", "a>b")).not.toThrow()
    expect(() => queueRides([{ city: "台北市", mode: "drive" }])).not.toThrow()
    expect(takeQueuedRides()).toEqual([])
  })
})

describe("還沒送出去的騎乘記錄", () => {
  it("存起來、取出時清掉", () => {
    queueRides([{ city: "台北市", mode: "drive" }])
    queueRides([{ city: "新竹市", mode: "walk" }])
    expect(takeQueuedRides()).toEqual([
      { city: "台北市", mode: "drive" },
      { city: "新竹市", mode: "walk" },
    ])
    expect(takeQueuedRides()).toEqual([])
    expect(storage.data.has("meddemo:rides-queue")).toBe(false)
  })

  it("壞掉的資料當作空的，壞項目被丟掉", () => {
    storage.data.set("meddemo:rides-queue", "nope")
    expect(takeQueuedRides()).toEqual([])
    storage.data.set("meddemo:rides-queue", JSON.stringify([1, { city: "台北市", mode: "drive" }]))
    expect(takeQueuedRides()).toEqual([{ city: "台北市", mode: "drive" }])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { queueRides, takeQueuedRides } from "@/lib/ride-memory"

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
  }
}

let storage: ReturnType<typeof fakeStorage>

beforeEach(() => {
  storage = fakeStorage()
  vi.stubGlobal("localStorage", storage)
})

afterEach(() => vi.unstubAllGlobals())

describe("localStorage 不能用", () => {
  it("丟例外時不會壞", () => {
    const boom = () => {
      throw new Error("denied")
    }
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom })
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

  it("縣市或交通方式不合法的項目被丟掉", () => {
    storage.data.set(
      "meddemo:rides-queue",
      JSON.stringify([
        { city: "火星", mode: "drive" },
        { city: "台北市", mode: "rocket" },
        { city: "新竹市", mode: "walk" },
      ])
    )
    expect(takeQueuedRides()).toEqual([{ city: "新竹市", mode: "walk" }])
  })
})

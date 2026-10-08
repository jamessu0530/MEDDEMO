import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sendRides } from "@/api/vehicles"
import { queueRides, takeQueuedRides } from "@/lib/ride-memory"

const data = new Map<string, string>()
const calls: { rides: unknown[] }[] = []

beforeEach(() => {
  data.clear()
  calls.length = 0
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  })
})

afterEach(() => vi.unstubAllGlobals())

const ok = () =>
  vi.fn(async (_path: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string))
    return new Response(null, { status: 204 })
  })

describe("sendRides", () => {
  it("跟沒送出去的併在一起去重，一次最多 4 台", async () => {
    vi.stubGlobal("fetch", ok())
    queueRides([{ city: "台北市", mode: "drive" }])
    await sendRides([
      { city: "台北市", mode: "drive" },
      { city: "新北市", mode: "drive" },
      { city: "新竹市", mode: "drive" },
      { city: "台中市", mode: "drive" },
      { city: "彰化縣", mode: "walk" },
    ])
    expect(calls.map((c) => c.rides.length)).toEqual([4, 1])
    expect(takeQueuedRides()).toEqual([])
  })

  it("失敗時把還沒送到的存回去，不丟例外", async () => {
    let n = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++n === 1 ? new Response(null, { status: 204 }) : new Response(null, { status: 500 })))
    )
    const four = (["台北市", "新北市", "新竹市", "台中市"] as const).map((city) => ({ city, mode: "drive" as const }))
    await expect(sendRides([...four, { city: "彰化縣", mode: "walk" }, { city: "台南市", mode: "walk" }])).resolves.toBeUndefined()
    expect(takeQueuedRides()).toEqual([
      { city: "彰化縣", mode: "walk" },
      { city: "台南市", mode: "walk" },
    ])
  })

  it("4xx 的那一批丟掉不重送，後面的批次照送", async () => {
    let n = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init: RequestInit) => {
        calls.push(JSON.parse(init.body as string))
        return ++n === 1 ? new Response(JSON.stringify({ detail: "bad" }), { status: 422 }) : new Response(null, { status: 204 })
      })
    )
    const four = (["台北市", "新北市", "新竹市", "台中市"] as const).map((city) => ({ city, mode: "drive" as const }))
    await expect(sendRides([...four, { city: "彰化縣", mode: "walk" }])).resolves.toBeUndefined()
    expect(calls.map((c) => c.rides.length)).toEqual([4, 1])
    expect(takeQueuedRides()).toEqual([])
  })

  it("網路錯誤存回去", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))))
    await sendRides([{ city: "台北市", mode: "drive" }])
    expect(takeQueuedRides()).toEqual([{ city: "台北市", mode: "drive" }])
  })
})

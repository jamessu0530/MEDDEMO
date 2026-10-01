import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// 跟 skin.test.ts 一樣：一載入就讀 localStorage、掛 <html data-text-size>，每個測試重新載入模組
let stored: Record<string, string>
let dataset: Record<string, string>

beforeEach(() => {
  stored = {}
  dataset = {}
  vi.resetModules()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => void (stored[key] = value),
  })
  vi.stubGlobal("document", { documentElement: { dataset } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const load = () => import("@/lib/text-size")

describe("text size", () => {
  it("沒選過就是標準，<html> 上不掛東西", async () => {
    const { readTextSize } = await load()
    expect(readTextSize()).toBe("standard")
    expect(dataset.textSize).toBeUndefined()
  })

  it("選過特大，一載入就掛上；存的值壞掉當成標準", async () => {
    stored["meddemo:text-size"] = "xlarge"
    expect((await load()).readTextSize()).toBe("xlarge")
    expect(dataset.textSize).toBe("xlarge")
    vi.resetModules()
    stored["meddemo:text-size"] = "huge"
    expect((await load()).readTextSize()).toBe("standard")
  })

  it("換大小會存起來並更新 <html>，換回標準就拿掉", async () => {
    const { setTextSize } = await load()
    setTextSize("large")
    expect(stored["meddemo:text-size"]).toBe("large")
    expect(dataset.textSize).toBe("large")
    setTextSize("standard")
    expect(dataset.textSize).toBeUndefined()
  })

  it("讀不到 localStorage（無痕模式）就用標準", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
    })
    expect((await load()).readTextSize()).toBe("standard")
  })
})

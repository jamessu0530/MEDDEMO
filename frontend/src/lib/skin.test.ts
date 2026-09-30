import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// lib/skin.ts 一載入就讀 localStorage、掛 <html data-skin>；測試環境是 node，兩個都用假的補上，
// 每個測試重新載入模組，才看得到「一載入」那一下做了什麼
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

const load = () => import("@/lib/skin")

describe("skin", () => {
  it("沒選過就是紫色，<html> 上不掛東西", async () => {
    const { readSkin } = await load()
    expect(readSkin()).toBe("purple")
    expect(dataset.skin).toBeUndefined()
  })

  it("選過黑白灰，一載入就掛上 data-skin", async () => {
    stored["meddemo:skin"] = "mono"
    const { readSkin } = await load()
    expect(readSkin()).toBe("mono")
    expect(dataset.skin).toBe("mono")
  })

  it("存的值看不懂就當作紫色", async () => {
    stored["meddemo:skin"] = "rainbow"
    const { readSkin } = await load()
    expect(readSkin()).toBe("purple")
  })

  it("setSkin 會換掉 data-skin、記在手機裡，並通知畫面", async () => {
    const { onSkinChange, readSkin, setSkin } = await load()
    const listener = vi.fn()
    onSkinChange(listener)

    setSkin("mono")
    expect(readSkin()).toBe("mono")
    expect(dataset.skin).toBe("mono")
    expect(stored["meddemo:skin"]).toBe("mono")
    expect(listener).toHaveBeenCalledTimes(1)

    setSkin("mono") // 沒變就不通知
    expect(listener).toHaveBeenCalledTimes(1)

    setSkin("purple")
    expect(dataset.skin).toBeUndefined()
    expect(stored["meddemo:skin"]).toBe("purple")
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("手機存不進去（無痕模式）也照樣換，只是下次打開會回到紫色", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    })
    const { readSkin, setSkin } = await load()
    expect(readSkin()).toBe("purple")
    setSkin("mono")
    expect(readSkin()).toBe("mono")
    expect(dataset.skin).toBe("mono")
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { constrainManagerMapSize, managerMapLimits, readManagerMapSize, readManagerRouteSize, saveManagerMapSize, saveManagerRouteSize } from "@/lib/manager-map-size"

beforeEach(() => {
  const items = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("主管地圖尺寸", () => {
  it("行程清單另存尺寸，重開保留且不混用地圖或其他帳號的偏好", () => {
    const map = { widthPercent: 60, height: 420 }
    const routes = { widthPercent: 80, height: 360 }
    saveManagerMapSize("M01", map)
    saveManagerRouteSize("M01", routes)
    expect(readManagerRouteSize("M01")).toEqual(routes)
    expect(readManagerMapSize("M01")).toEqual(map)
    expect(readManagerRouteSize("M02")).toEqual({ widthPercent: null, height: null })
    saveManagerRouteSize("M01", { widthPercent: null, height: null })
    expect(localStorage.getItem("meddemo:manager-route-size:M01")).toBeNull()
    expect(readManagerMapSize("M01")).toEqual(map)
  })

  it("行程清單可以儲存整欄寬度，無效尺寸回到自然大小", () => {
    saveManagerRouteSize("M01", { widthPercent: 100, height: 400 })
    expect(readManagerRouteSize("M01")).toEqual({ widthPercent: 100, height: 400 })
    localStorage.setItem("meddemo:manager-route-size:M01", '{"widthPercent":101,"height":-1}')
    expect(readManagerRouteSize("M01")).toEqual({ widthPercent: null, height: null })
  })

  it("同一帳號重開會保留尺寸，其他帳號使用自己的預設；還原會清除偏好", () => {
    const size = { widthPercent: 65, height: 420 }
    saveManagerMapSize("M01", size)
    expect(readManagerMapSize("M01")).toEqual(size)
    expect(readManagerMapSize("M02")).toEqual({ widthPercent: null, height: null })
    saveManagerMapSize("M01", { widthPercent: null, height: null })
    expect(localStorage.getItem("meddemo:manager-map-size:M01")).toBeNull()
  })

  it("窄桌面與大字體時不讓清單被擠掉，也不讓地圖超過視窗可用高度", () => {
    const limits = managerMapLimits(600, 20, 600)
    expect(constrainManagerMapSize({ widthPercent: 90, height: 1200 }, limits)).toEqual({ widthPercent: 60, height: 400 })
    expect(constrainManagerMapSize({ widthPercent: 5, height: 50 }, limits)).toEqual({ widthPercent: 40, height: 320 })
  })

  it("換小視窗只限制顯示尺寸，不覆蓋原先保存的偏好", () => {
    const saved = { widthPercent: 75, height: 700 }
    saveManagerMapSize("M01", saved)
    const small = constrainManagerMapSize(readManagerMapSize("M01"), managerMapLimits(600, 20, 600))
    expect(small).toEqual({ widthPercent: 60, height: 400 })
    expect(readManagerMapSize("M01")).toEqual(saved)
    expect(constrainManagerMapSize(readManagerMapSize("M01"), managerMapLimits(2000, 16, 1000))).toEqual(saved)
  })

  it("極小視窗與尚未量到寬度時仍有合法的調整範圍", () => {
    const limits = managerMapLimits(0, 20, 200)
    expect(limits.minWidth).toBeLessThanOrEqual(limits.maxWidth)
    expect(limits.minHeight).toBeLessThanOrEqual(limits.maxHeight)
    expect(constrainManagerMapSize({ widthPercent: null, height: null }, limits)).toEqual({ widthPercent: null, height: null })
  })

  it("依頁首實際高度替圖例與高度把手留出視窗空間", () => {
    const limits = managerMapLimits(1000, 16, 720, 182)
    expect(limits.maxHeight).toBe(474)
    expect(limits.maxHeight + 182 + 4 * 16).toBeLessThanOrEqual(720)
  })

  it("Widget 與底部助理輸入列也計入可用高度，右下角把手不被遮擋", () => {
    const fontSize = 20
    const chrome = 11 * fontSize
    const limits = managerMapLimits(1000, fontSize, 800, 150, chrome)
    const size = constrainManagerMapSize({ widthPercent: 60, height: 900 }, limits)
    expect(size.height).toBe(430)
    expect(size.height! + 150 + chrome).toBe(800)
  })

  it("儲存內容毀損或欄位型別不對時安全回到預設", () => {
    const key = "meddemo:manager-map-size:M01"
    for (const value of ["{", "null", "[]", '{"widthPercent":"60","height":-1}', '{"widthPercent":101,"height":1e999}']) {
      localStorage.setItem(key, value)
      expect(readManagerMapSize("M01")).toEqual({ widthPercent: null, height: null })
    }
  })

  it("瀏覽器拒絕儲存時不影響目前畫面的調整", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError") },
      setItem: () => { throw new Error("QuotaExceededError") },
      removeItem: () => { throw new Error("SecurityError") },
    })
    expect(readManagerMapSize("M01")).toEqual({ widthPercent: null, height: null })
    expect(() => saveManagerMapSize("M01", { widthPercent: 60, height: 400 })).not.toThrow()
    expect(() => saveManagerMapSize("M01", { widthPercent: null, height: null })).not.toThrow()
  })
})

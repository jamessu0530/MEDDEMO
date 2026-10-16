import { describe, expect, it } from "vitest"
import type { Product } from "@/api/products"
import {
  discoverProducts,
  effectiveBrowseTime,
  horizontalSwap,
  productAffinities,
} from "@/lib/product-discovery"

const products: Product[] = Array.from({ length: 60 }, (_, i) => ({
  sku: `P${i}`,
  name: `商品 ${i}`,
  category: i < 30 ? "A" : "B",
  spec: "",
  aliases: [],
  unit: "盒",
  common: false,
}))
const now = Date.parse("2026-10-16T12:00:00Z")

describe("換一排商品", () => {
  it("保留全部商品，沒有重複或漏掉；同一批順序固定，換批才重新抽樣", () => {
    const first = discoverProducts(products, {}, "batch-a")
    expect(new Set(first.map((item) => item.sku))).toEqual(
      new Set(products.map((item) => item.sku))
    )
    expect(first).toHaveLength(products.length)
    expect(discoverProducts(products, {}, "batch-a")).toEqual(first)
    expect(discoverProducts(products, {}, "batch-b")).not.toEqual(first)
  })
  it("保持呼叫端已篩選的範圍，推薦不會把搜尋範圍以外的商品加進來", () => {
    const filtered = products.filter((product) => product.category === "A")
    expect(
      discoverProducts(filtered, {}, "another").every(
        (product) => product.category === "A"
      )
    ).toBe(true)
  })
  it("同類商品受有效停留與主動展開影響，其他帳號空白偏好不受影響", () => {
    const profile = {
      P0: {
        active_ms: 15000,
        opens: 2,
        last_seen: new Date(now).toISOString(),
      },
    }
    const affinity = productAffinities(products, profile, now)
    expect(affinity.get("P0")!).toBeGreaterThan(affinity.get("P1")!)
    expect(affinity.get("P1")!).toBeGreaterThan(affinity.get("P40")!)
    expect(
      [...productAffinities(products, {}, now).values()].every(
        (value) => value === 0
      )
    ).toBe(true)
  })
  it("超長掛著不會無限加分，舊偏好隨時間下降", () => {
    const signal = {
      active_ms: 60000,
      opens: 0,
      last_seen: new Date(now).toISOString(),
    }
    expect(productAffinities(products, { P0: signal }, now).get("P0")).toBe(
      productAffinities(
        products,
        { P0: { ...signal, active_ms: 86400000 } },
        now
      ).get("P0")
    )
    expect(
      productAffinities(products, { P0: signal }, now + 30 * 86400000).get(
        "P0"
      )!
    ).toBeLessThan(productAffinities(products, { P0: signal }, now).get("P0")!)
  })
  it("左右滑都是換批；垂直捲動、斜滑與短誤觸不換", () => {
    expect(horizontalSwap(-100, 10)).toBe("left")
    expect(horizontalSwap(100, -10)).toBe("right")
    expect(horizontalSwap(40, 2)).toBeNull()
    expect(horizontalSwap(60, 80)).toBeNull()
    expect(horizontalSwap(80, 70)).toBeNull()
  })
})

describe("有效停留時間", () => {
  const tick = {
    elapsed: 1000,
    now: 10000,
    lastActivity: 9500,
    visible: true,
    foreground: true,
    demo: false,
  }
  it("正常閱讀計時，長時間背景暫停後只計本次取樣上限", () => {
    expect(effectiveBrowseTime(tick)).toBe(1000)
    expect(effectiveBrowseTime({ ...tick, elapsed: 600000 })).toBe(1200)
  })
  it("背景、失焦、閒置與示範皆不計時", () => {
    for (const change of [
      { visible: false },
      { foreground: false },
      { lastActivity: -30000 },
      { demo: true },
    ])
      expect(effectiveBrowseTime({ ...tick, ...change })).toBe(0)
  })
})

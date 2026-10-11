import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import manifest from "@/data/product-photos.json"
import { productPhoto } from "@/lib/product-photos"

describe("商品型錄照片", () => {
  it("真實型錄、示範與促銷的每個料號都有本機照片", () => {
    const tsv = readFileSync(
      new URL("../../../data/seed/products.tsv", import.meta.url),
      "utf8"
    )
    const realSkus = tsv
      .trim()
      .split("\n")
      .slice(1)
      .map((row) => row.split("\t")[0])
    const catalog = readFileSync(
      new URL("../../../data/seed/catalog.py", import.meta.url),
      "utf8"
    )
    const seededSkus = [
      ...catalog.matchAll(/^(?:PROMO_)?PRODUCTS = \[([\s\S]*?)^\]/gm),
    ].flatMap((section) =>
      [...section[1].matchAll(/^\s*\("([^"]+)"/gm)].map((row) => row[1])
    )
    const skus = [...realSkus, ...seededSkus]
    expect(skus).toHaveLength(Object.keys(manifest.products).length)
    for (const sku of skus) expect(productPhoto(sku), sku).not.toBeNull()
    for (const source of Object.values(manifest.sources)) {
      const file = new URL(`../../public${source.file}`, import.meta.url)
      expect(existsSync(fileURLToPath(file)), source.file).toBe(true)
      const header = readFileSync(file).subarray(0, 12).toString("ascii")
      expect(header.startsWith("RIFF"), source.file).toBe(true)
      expect(header.endsWith("WEBP"), source.file).toBe(true)
      expect(new URL(source.pageUrl).protocol).toBe("https:")
      expect(source.title.trim().length).toBeGreaterThan(0)
    }
  })

  it("示範商品的照片保留示意標記，來源連到商品頁", () => {
    const photo = productPhoto("HS-FO30")
    expect(photo?.kind).toBe("illustrative")
    expect(photo?.src).toMatch(/^\/product-photos\/[^/]+\.webp$/)
    expect(photo?.sourceUrl).toMatch(/^https:\/\//)
  })

  it("新增但尚未配圖的商品正常使用缺圖狀態", () => {
    expect(productPhoto("UNKNOWN-SKU")).toBeNull()
  })
})

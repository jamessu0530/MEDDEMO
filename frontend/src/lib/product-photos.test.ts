import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import manifest from "@/data/product-photos.json"
import coverage from "../../../data/seed/product-photo-coverage.json"
import {
  availableProductPhoto,
  photoNameMatches,
  productPhoto,
} from "@/lib/product-photos"

describe("商品型錄照片", () => {
  it("只接受同名同規格圖片，拒絕其他藥品或不同劑量的示意照", () => {
    expect(
      photoNameMatches(
        "中化360中化纖黃金奇異果益生菌60包",
        "【中化健康360】中化纖黃金奇異果益生菌(60包/盒)"
      )
    ).toBe(true)
    expect(photoNameMatches("金舒胃得", "莃可喜")).toBe(false)
    expect(photoNameMatches("藥品 5mg 28錠", "藥品 10mg 28錠")).toBe(false)
    expect(photoNameMatches("眼藥水 15ML", "眼藥水 10ML")).toBe(false)
  })
  it("每張已確認照片都有本機檔案，沒有照片的正式商品明列在待補清單", () => {
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
      ...catalog.matchAll(/^PROMO_PRODUCTS = \[([\s\S]*?)^\]/gm),
    ].flatMap((section) =>
      [...section[1].matchAll(/^\s*\("([^"]+)"/gm)].map((row) => row[1])
    )
    const skus = [...realSkus, ...seededSkus]
    const missing = new Set(
      coverage.missing.map((product: { sku: string }) => product.sku)
    )
    expect(skus).toHaveLength(coverage.appliedCount + coverage.missingCount)
    expect(Object.keys(manifest.products)).toHaveLength(coverage.appliedCount)
    for (const sku of skus) {
      const photo = productPhoto(sku)
      expect(!!photo !== missing.has(sku), sku).toBe(true)
      if (photo)
        expect(["exact", "series", "illustrative"]).toContain(photo.kind)
    }
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

  it("共用包裝保留同系列標記，明確指定的Demo參考照記錄規格差異", () => {
    const photo = productPhoto("C130068")
    expect(photo?.kind).toBe("series")
    expect(photo?.title).toContain("金舒胃得")
    expect(photo?.src).toMatch(/^\/product-photos\/[^/]+\.webp$/)
    expect(photo?.sourceUrl).toMatch(/^https:\/\//)
    expect(productPhoto("HS-FO30")).toBeNull()
    const demo = productPhoto("C490191")
    expect(demo?.kind).toBe("illustrative")
    expect(demo?.note).toContain("Demo參考照：")
    expect(demo?.note).toContain("20mg")
    expect(demo?.note).toContain("5mg")
  })

  it("新增但尚未配圖的商品正常使用缺圖狀態", () => {
    expect(productPhoto("UNKNOWN-SKU")).toBeNull()
  })

  it("目前完整型錄沒有缺圖，參考照保留明確差異說明", () => {
    expect(coverage.missingCount).toBe(0)
    expect(coverage.downloadFailures).toEqual([])
    for (const mapping of Object.values(manifest.products)) {
      if (mapping.kind === "illustrative")
        expect(mapping.note).toMatch(/^Demo參考照：/)
    }
  })

  it("API照片失效時改用本機商品照，兩者都失效才顯示缺圖", () => {
    const bundled = productPhoto("C160308")!
    const uploaded = { ...bundled, src: "/api/products/stale-photo.webp" }
    expect(availableProductPhoto("C160308", uploaded)).toEqual(uploaded)
    expect(
      availableProductPhoto("C160308", uploaded, [uploaded.src])
    ).toEqual(bundled)
    expect(
      availableProductPhoto("C160308", uploaded, [uploaded.src, bundled.src])
    ).toBeNull()
    expect(availableProductPhoto("C160308", null)).toEqual(bundled)
    expect(availableProductPhoto("UNKNOWN-SKU", null)).toBeNull()
  })
})

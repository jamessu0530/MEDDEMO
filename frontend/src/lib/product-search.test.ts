import { describe, expect, it } from "vitest"

import type { Product } from "@/api/products"
import { PRODUCT_SEARCH_LIMIT, productOptions } from "@/lib/product-search"

function product(sku: string, name: string, common: boolean, aliases: string[] = []): Product {
  return { sku, name, category: "醫材", unit: "組", aliases, common }
}

const PRODUCTS = [
  product("F762718", "腰部中等仿生骨曲線護具 BP61 L", true, ["護腰", "BP61"]),
  product("F762505", "中化360海藻鈣錠 60錠", false),
  product("HS-FO30", "魚油 30 入", true, ["魚油"]),
  product("M484974", "日本獅王細潔寬薄牙刷炭能抗菌", false),
]

describe("productOptions", () => {
  it("沒打字只列常用品項", () => {
    expect(productOptions(PRODUCTS, "", null).map((p) => p.sku)).toEqual(["F762718", "HS-FO30"])
  })
  it("打字就從整份型錄找品名、料號或口語叫法，英文不分大小寫", () => {
    expect(productOptions(PRODUCTS, "海藻", null).map((p) => p.sku)).toEqual(["F762505"])
    expect(productOptions(PRODUCTS, "m4849", null).map((p) => p.sku)).toEqual(["M484974"])
    expect(productOptions(PRODUCTS, "bp61", null).map((p) => p.sku)).toEqual(["F762718"])
    expect(productOptions(PRODUCTS, " 護腰 ", null).map((p) => p.sku)).toEqual(["F762718"])
  })
  it("已經選的品項一直列著，選單才不會跳掉", () => {
    expect(productOptions(PRODUCTS, "", "F762505").map((p) => p.sku)).toEqual(["F762718", "HS-FO30", "F762505"])
    expect(productOptions(PRODUCTS, "魚油", "F762505").map((p) => p.sku)).toEqual(["HS-FO30", "F762505"])
  })
  it("找到的太多只列前面幾個", () => {
    const many = Array.from({ length: 80 }, (_, i) => product(`M${i}`, `中衛口罩 ${i}`, false))
    expect(productOptions(many, "口罩", null)).toHaveLength(PRODUCT_SEARCH_LIMIT)
  })
})

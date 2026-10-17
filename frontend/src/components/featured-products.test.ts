import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { FeaturedProducts } from "@/api/featured-products"
import { FeaturedProductsBlock } from "@/components/featured-products"

const featured: FeaturedProducts = {
  manager_id: "M01",
  manager_name: "陳建宏",
  festival_id: "autumn",
  items: [
    {
      sku: "FP-B",
      name: "經理第一個指定品項",
      category: "保健品",
      spec: "一盒",
      unit: "盒",
      supply_price: 50,
      unit_cost: 60,
      unit_margin: -10,
      margin_rate: -0.2,
      price_source: "十月促銷",
      deal: "10+10",
    },
    {
      sku: "FP-A",
      name: "沒有成本的指定品項",
      category: "日用品",
      spec: "一瓶",
      unit: "瓶",
      supply_price: 90,
      unit_cost: null,
      unit_margin: null,
      margin_rate: null,
      price_source: "標準供貨價",
      deal: null,
    },
  ],
}

describe("經理指定主推的談判卡", () => {
  it("保留指定順序、標示我方毛利與計算依據，負毛利如實顯示", () => {
    const html = renderToStaticMarkup(
      createElement(FeaturedProductsBlock, { featured })
    )
    expect(html.indexOf("經理第一個指定品項")).toBeLessThan(
      html.indexOf("沒有成本的指定品項")
    )
    expect(html).toContain("陳建宏指定")
    expect(html).toContain("我方毛利 -20.0%")
    expect(html).toContain("text-destructive")
    expect(html).toContain("供貨單價－商品成本")
    expect(html).toContain("供貨單價已計入同品搭贈")
  })

  it("缺少成本時顯示待補資料，不產生虛假的毛利", () => {
    const html = renderToStaticMarkup(
      createElement(FeaturedProductsBlock, {
        featured: { ...featured, items: [featured.items[1]] },
      })
    )
    expect(html).toContain("尚無成本資料")
    expect(html).toContain("毛利待補資料")
    expect(html).not.toContain("100%")
    expect(html).not.toContain("NaN")
  })
})

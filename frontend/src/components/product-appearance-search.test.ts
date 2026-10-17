import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { ProductPhotoMatch } from "@/api/products"
import { ProductPhotoMatches } from "@/components/product-appearance-search"
import { productPhoto } from "@/lib/product-photos"

const photo = productPhoto("C130068")!
const match: ProductPhotoMatch = {
  source_id: "shared-photo",
  photo: { file: photo.src, title: photo.title, pageUrl: photo.sourceUrl },
  products: [
    {
      sku: "C130068",
      name: "型錄品名甲",
      category: "一般用藥",
      spec: "",
      unit: "盒",
      kind: "series",
      note: null,
    },
    {
      sku: "C130068-ALT",
      name: "型錄品名乙",
      category: "一般用藥",
      spec: "",
      unit: "瓶",
      kind: "series",
      note: null,
    },
  ],
}

describe("商品外觀搜尋結果", () => {
  it("共用照片顯示一次，保留每個料號的品名與同系列標記", () => {
    const html = renderToStaticMarkup(
      createElement(ProductPhotoMatches, { matches: [match] })
    )
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain("型錄品名甲")
    expect(html).toContain("型錄品名乙")
    expect(html).toContain("C130068-ALT")
    expect(html).toContain("同系列照片，包裝規格請依品名確認")
    expect(html).toContain("2 個對應料號")
  })

  it("歷史結果與目前的照片對應不符時，不套上另一張圖片", () => {
    const html = renderToStaticMarkup(
      createElement(ProductPhotoMatches, {
        matches: [
          {
            ...match,
            photo: { ...match.photo, file: "/product-photos/previous.webp" },
          },
        ],
      })
    )
    expect(html).not.toContain("<img ")
    expect(html).toContain("型錄品名甲")
  })

  it("空候選正常顯示空清單", () => {
    const html = renderToStaticMarkup(
      createElement(ProductPhotoMatches, { matches: [] })
    )
    expect(html).not.toContain("<li")
  })
})

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { ProductPhoto } from "@/components/product-photo"

it("商品頁優先呈現資料庫照片與來源", () => {
  const markup = renderToStaticMarkup(
    createElement(ProductPhoto, {
      product: {
        sku: "C160308",
        name: "ARIZOLE TAB. 5MG 30T/PTP",
        photo: {
          src: "/api/products/C160308/photo/verified.webp",
          title: "羅亞達錠5毫克",
          sourceUrl: "https://example.com/verified-product",
          kind: "exact",
        },
      },
    })
  )
  expect(markup).toContain('src="/api/products/C160308/photo/verified.webp"')
  expect(markup).toContain('href="https://example.com/verified-product"')
  expect(markup).toContain("商品照片")
})

it("沒有資料庫照片時仍可呈現既有型錄圖片", () => {
  const markup = renderToStaticMarkup(
    createElement(ProductPhoto, {
      product: { sku: "C160308", name: "羅亞達", photo: null },
    })
  )
  expect(markup).toContain('src="/product-photos/')
})

it("示意照片可顯示，且在圖片下方標明Demo參考照", () => {
  const markup = renderToStaticMarkup(
    createElement(ProductPhoto, {
      product: { sku: "C490191", name: "虎讚 Zan tab.5MG 28T/PTP" },
    })
  )
  expect(markup).toContain('src="/product-photos/')
  expect(markup).toContain("Demo 參考照")
  expect(markup).toContain("查看照片差異")
  expect(markup).toContain("20mg")
  expect(markup).toContain("5mg")
})

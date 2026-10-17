import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  CustomerStorefront,
  CustomerStorefrontList,
  CustomerStorefrontThumbnail,
} from "./customer-storefront"

const customer = {
  id: "OUT-test",
  name: "直接使用照片的店家",
  city: "基隆市",
  area: "仁愛區",
  storefront_photo: {
    image_url: "https://photos.example.com/shop.jpg",
    source_url: "https://example.com/shop",
    credit: "店家官網",
  },
}

describe("資料庫店家照片", () => {
  it("首屏照片優先抓取，圖片解碼不阻塞互動，其他縮圖維持延後載入", () => {
    const html = renderToStaticMarkup(
      createElement(CustomerStorefrontThumbnail, { customer, priority: true })
    )
    expect(html).toContain('loading="eager"')
    expect(html).toContain('fetchPriority="high"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('width="96"')
    expect(
      renderToStaticMarkup(
        createElement(CustomerStorefrontThumbnail, { customer })
      )
    ).toContain('loading="lazy"')
  })
  it("清單直接顯示資料庫照片，沒有地圖 SDK 或 Google 設定請求", () => {
    const fetch = vi.spyOn(globalThis, "fetch")
    const html = renderToStaticMarkup(
      createElement(CustomerStorefrontList, {
        children: createElement(CustomerStorefrontThumbnail, { customer }),
      })
    )
    expect(html).toContain('src="https://photos.example.com/shop.jpg"')
    expect(html).toContain("店家官網")
    expect(html).not.toContain("maps.googleapis.com")
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
  it("沒有照片或離線時顯示預設圖，不自動重新搜尋", () => {
    expect(
      renderToStaticMarkup(
        createElement(CustomerStorefrontThumbnail, {
          customer: { ...customer, storefront_photo: null },
        })
      )
    ).toContain("暫無照片")
    const html = renderToStaticMarkup(
      createElement(CustomerStorefrontList, {
        offline: true,
        children: createElement(CustomerStorefrontThumbnail, { customer }),
      })
    )
    expect(html).toContain("暫無照片")
    expect(html).not.toContain('src="https://photos.example.com/shop.jpg"')
  })
  it("照片來源和署名直接顯示，完整頁只提供手動地圖連結", () => {
    const html = renderToStaticMarkup(
      createElement(CustomerStorefront, { customer })
    )
    expect(html).toContain('href="https://example.com/shop"')
    expect(html).toContain("Google 地圖")
    expect(html).not.toContain("<script")
  })
})

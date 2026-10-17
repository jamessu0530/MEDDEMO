import { describe, expect, it } from "vitest"

import {
  findStorefront,
  storefrontHeading,
  storefrontQuery,
  storefrontSearchUrl,
} from "./storefront"

const customer = { name: "康泰連鎖藥局 · 忠孝店", city: "台北市", area: "大安" }
const match = {
  displayName: "康泰藥局（忠孝門市）",
  formattedAddress: "106臺灣臺北市大安區忠孝東路四段1號",
}

describe("Google 店家核對", () => {
  it("允許台／臺、標點和連鎖／門市的寫法差異", () => {
    expect(findStorefront(customer, [match])).toBe(match)
  })

  it("不接受其他分店、同名不同區，或只是店名的前綴", () => {
    expect(
      findStorefront(customer, [{ ...match, displayName: "康泰藥局南京店" }])
    ).toBeNull()
    expect(
      findStorefront(customer, [
        { ...match, formattedAddress: "臺北市信義區忠孝東路1號" },
      ])
    ).toBeNull()
    expect(
      findStorefront(customer, [
        { ...match, displayName: "康泰藥局忠孝店二店" },
      ])
    ).toBeNull()
    expect(
      findStorefront({ ...customer, name: "康泰藥局" }, [match])
    ).toBeNull()
  })

  it("清單有完整地址時，也核對道路與門牌，避免同區同名店套錯照片", () => {
    const full = { ...customer, address: "台北市大安區忠孝東路四段1號" }
    expect(findStorefront(full, [match])).toBe(match)
    expect(
      findStorefront(full, [
        { ...match, formattedAddress: "台北市大安區忠孝東路四段11號" },
      ])
    ).toBeNull()
    expect(
      findStorefront(full, [
        { ...match, formattedAddress: "台北市大安區復興南路四段1號" },
      ])
    ).toBeNull()
    expect(storefrontQuery(full)).toBe(
      "台北市大安區忠孝東路四段1號 康泰連鎖藥局 忠孝店"
    )
  })

  it("不把街道名稱当作行政區", () => {
    expect(
      findStorefront(customer, [
        { ...match, formattedAddress: "臺北市信義區大安路1號" },
      ])
    ).toBeNull()
  })

  it("沒有結果、缺少地區，或同時有兩家符合，都不自動選照片", () => {
    expect(findStorefront(customer, [])).toBeNull()
    expect(findStorefront({ ...customer, area: "" }, [match])).toBeNull()
    expect(findStorefront(customer, [match, { ...match }])).toBeNull()
    expect(
      findStorefront(customer, [{ displayName: match.displayName }])
    ).toBeNull()
  })

  it("支援縣內的鄉鎮與已包含區字的行政區", () => {
    const store = {
      displayName: "仁愛藥局",
      formattedAddress: "南投縣埔里鎮中正路1號",
    }
    expect(
      findStorefront({ name: "仁愛藥局", city: "南投縣", area: "埔里" }, [
        store,
      ])
    ).toBe(store)
    expect(findStorefront({ ...customer, area: "大安區" }, [match])).toBe(match)
  })

  it("CRM 附在店名後的行政區可省略，分店名稱仍必須核對", () => {
    const store = {
      displayName: "仁愛藥局",
      formattedAddress: "臺北市北投區中央北路1號",
    }
    expect(
      findStorefront(
        { name: "仁愛藥局 · 北投", city: "台北市", area: "北投" },
        [store]
      )
    ).toBe(store)
    expect(
      findStorefront(
        { name: "仁愛藥局 · 北投店", city: "台北市", area: "北投" },
        [store]
      )
    ).toBeNull()
  })

  it("以店名和縣市行政區組成可安全編碼的 Google 地圖搜尋", () => {
    expect(storefrontQuery(customer)).toBe("台北市 大安 康泰連鎖藥局 忠孝店")
    const url = new URL(
      storefrontSearchUrl({ ...customer, name: "藥局 & 門市 #1" })
    )
    expect(url.hostname).toBe("www.google.com")
    expect(url.searchParams.get("query")).toBe("台北市 大安 藥局 & 門市 #1")
    expect(url.hash).toBe("")
  })
})

it("街景鏡頭朝向店家位置，方向限制在 0–360 度", () => {
  expect(storefrontHeading({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
    0
  )
  expect(storefrontHeading({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(
    90
  )
  expect(
    storefrontHeading({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })
  ).toBeCloseTo(180)
  expect(
    storefrontHeading({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })
  ).toBeCloseTo(270)
})

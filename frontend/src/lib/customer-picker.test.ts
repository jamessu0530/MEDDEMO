import { describe, expect, it } from "vitest"
import type { Customer } from "@/api/customers"
import { CUSTOMER_PAGE_SIZE, orderPickerCustomers } from "./customer-picker"

function customer(id: string, withPhoto = false): Customer {
  return {
    id,
    name: id,
    type: "outlet",
    region: "北區",
    grade: null,
    owner_id: null,
    owner_name: null,
    last_visit_date: null,
    storefront_photo: withPhoto
      ? {
          image_url: "https://photos.example.com/shop.jpg",
          source_url: "https://example.com/shop",
        }
      : null,
  }
}

describe("拜訪客戶清單", () => {
  it("預設首批不再全被沒有照片的示範客戶占滿，且保留全部客戶", () => {
    const demo = Array.from({ length: 253 }, (_, i) => customer(`C${i}`))
    const outlets = Array.from({ length: 150 }, (_, i) =>
      customer(`OUT-${i}`, true)
    )
    const input = [...demo, ...outlets]
    const ordered = orderPickerCustomers(input, "")
    expect(
      ordered.slice(0, CUSTOMER_PAGE_SIZE).every((c) => c.storefront_photo)
    ).toBe(true)
    expect(ordered).toEqual([...outlets, ...demo])
    expect(input).toEqual([...demo, ...outlets])
    expect(ordered.slice(0, 2 * CUSTOMER_PAGE_SIZE)).toHaveLength(200)
  })

  it("搜尋保留相關度，沒有照片的精確結果仍排在照片結果之前", () => {
    const input = [customer("exact-match"), customer("photo-match", true)]
    expect(orderPickerCustomers(input, " 藥局 ")).toEqual(input)
  })

  it("空清單與全無照片的資料仍能瀏覽", () => {
    expect(orderPickerCustomers([], "")).toEqual([])
    const input = [customer("C1"), customer("C2")]
    expect(orderPickerCustomers(input, "  ")).toEqual(input)
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Customer } from "./customers"

const mocks = vi.hoisted(() => ({ request: vi.fn(), user: { id: "U01" } }))
vi.mock("@/api/client", () => ({ request: mocks.request, jsonBody: vi.fn() }))
vi.mock("@/lib/auth", () => ({ readUser: () => mocks.user }))

function customer(id: string, photo = false): Customer {
  return {
    id,
    name: id,
    type: "outlet",
    region: "北區",
    grade: null,
    owner_id: null,
    owner_name: null,
    last_visit_date: null,
    address: "臺北市中正區測試路1號",
    phone: "0223456789",
    storefront_photo: photo
      ? {
          image_url: "https://photos.example.com/shop.jpg",
          source_url: "https://example.com/shop",
        }
      : null,
  }
}

beforeEach(() => {
  vi.resetModules()
  mocks.request.mockReset()
  mocks.user.id = "U01"
  const storage = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})

describe("分頁客戶載入", () => {
  it("只抓一批；預載完成後顯示更多會直接重用資料", async () => {
    const { listPickerCustomers } = await import("./customers")
    mocks.request.mockResolvedValue({
      customers: [customer("first", true)],
      next_offset: 100,
    })
    await listPickerCustomers()
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/customers/picker?limit=100&offset=0",
      { signal: undefined }
    )
    mocks.request.mockResolvedValue({
      customers: [customer("next", true)],
      next_offset: null,
    })
    await listPickerCustomers(undefined, "", 100)
    const result = await listPickerCustomers(undefined, "", 100)
    expect(result.customers[0].id).toBe("next")
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it("搜尋、頁數與登入帳號都有各自的快取", async () => {
    const { listPickerCustomers } = await import("./customers")
    mocks.request.mockResolvedValue({ customers: [], next_offset: null })
    await listPickerCustomers()
    await listPickerCustomers(undefined, "藥局")
    await listPickerCustomers(undefined, "", 100)
    mocks.user.id = "U02"
    await listPickerCustomers()
    expect(mocks.request).toHaveBeenCalledTimes(4)
  })

  it("離線仍可用已儲存的客戶名稱、地址與電話搜尋", async () => {
    const { listPickerCustomers, cachedCustomer } = await import("./customers")
    mocks.request.mockResolvedValueOnce({
      customers: [customer("店家", true)],
      next_offset: null,
    })
    await listPickerCustomers()
    expect(cachedCustomer("店家")?.name).toBe("店家")
    mocks.request.mockRejectedValue(new Error("offline"))
    const result = await listPickerCustomers(undefined, "022345")
    expect(result.cached).toBe(true)
    expect(result.customers.map((c) => c.name)).toEqual(["店家"])
  })

  it("取消的請求不會用舊資料取代新的搜尋結果", async () => {
    const { listPickerCustomers } = await import("./customers")
    const controller = new AbortController()
    controller.abort()
    await expect(listPickerCustomers(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it("離線也能搜尋已載入商家的叫貨品名、別名與料號", async () => {
    const { listPickerCustomers } = await import("./customers")
    mocks.request.mockResolvedValueOnce({
      customers: [
        {
          ...customer("店家"),
          purchased_products: [
            {
              sku: "FISH01",
              name: "深海魚油",
              category: "保健",
              spec: "60粒",
              unit: "盒",
              aliases: ["Omega 3"],
              order_count: 2,
              total_qty: 12,
              last_order_date: "2031-04-17",
            },
          ],
        },
      ],
      next_offset: null,
    })
    await listPickerCustomers()
    mocks.request.mockRejectedValue(new Error("offline"))
    for (const keyword of ["魚油", "ＯＭＥＧＡ　３", "fish01"]) {
      const result = await listPickerCustomers(undefined, keyword)
      expect(result.cached).toBe(true)
      expect(result.customers.map((c) => c.id)).toEqual(["店家"])
    }
  })

  it("保留行事曆已儲存的完整離線客戶，不因分頁縮減", async () => {
    const existing = Array.from({ length: 700 }, (_, i) => customer(`C${i}`))
    localStorage.setItem("meddemo:customers:U01", JSON.stringify(existing))
    const { listPickerCustomers, cachedCustomer } = await import("./customers")
    mocks.request.mockResolvedValue({
      customers: [customer("first", true)],
      next_offset: 100,
    })
    await listPickerCustomers()
    expect(cachedCustomer("C0")?.id).toBe("C0")
    expect(
      JSON.parse(localStorage.getItem("meddemo:customers:U01")!)
    ).toHaveLength(700)
  })
})

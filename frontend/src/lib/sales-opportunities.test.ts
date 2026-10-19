import { describe, expect, it } from "vitest"
import type { SalesOpportunity } from "@/api/sales-opportunities"
import { filterOpportunities } from "@/lib/sales-opportunities"

const base: SalesOpportunity = {
  customer_id: "C01",
  name: "中山藥局",
  city: "台北市",
  area: "中山",
  type: "independent",
  grade: "A",
  previous_amount: 10000,
  current_amount: 2000,
  gap_amount: 8000,
  previous_qty: 10,
  current_qty: 2,
  previous_orders: 2,
  current_orders: 1,
  previous_average_order: 5000,
  last_order_date: "2026-10-01",
  decline_percent: 80,
  amount_declined: true,
  quantity_declined: true,
  is_declining: true,
  is_key_account: true,
  priority: "high",
}
const items: SalesOpportunity[] = [
  base,
  {
    ...base,
    customer_id: "C02",
    name: "板橋藥局",
    city: "新北市",
    area: "板橋",
    grade: "B",
    is_key_account: false,
    priority: "normal",
    gap_amount: 12000,
  },
  {
    ...base,
    customer_id: "C03",
    name: "信義藥局",
    area: "信義",
    is_declining: false,
    priority: "normal",
    gap_amount: 0,
    previous_amount: 30000,
  },
]

describe("銷售機會清單", () => {
  it("大客戶與訂貨減少可以獨立篩選，兩者同時符合則列為優先", () => {
    expect(
      filterOpportunities(items, "", "key", "priority").map(
        (i) => i.customer_id
      )
    ).toEqual(["C01", "C03"])
    expect(
      filterOpportunities(items, "", "declining", "priority").map(
        (i) => i.customer_id
      )
    ).toEqual(["C01", "C02"])
    expect(
      filterOpportunities(items, "", "high", "priority").map(
        (i) => i.customer_id
      )
    ).toEqual(["C01"])
  })
  it("搜尋客戶、地區與編號時仍套用目前篩選", () => {
    expect(filterOpportunities(items, "  板橋  ", "all", "priority")).toEqual([
      items[1],
    ])
    expect(filterOpportunities(items, "c03", "all", "priority")).toEqual([
      items[2],
    ])
    expect(filterOpportunities(items, "新北市", "key", "priority")).toEqual([])
  })
  it("替代排序不會改掉原本的建議順序", () => {
    expect(filterOpportunities(items, "", "all", "gap")[0].customer_id).toBe(
      "C02"
    )
    expect(
      filterOpportunities(items, "", "all", "previous")[0].customer_id
    ).toBe("C03")
    expect(filterOpportunities(items, "", "all", "priority")).toEqual(items)
    expect(items[0].customer_id).toBe("C01")
  })
})

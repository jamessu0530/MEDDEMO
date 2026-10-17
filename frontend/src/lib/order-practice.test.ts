import { describe, expect, it } from "vitest"
import type { OrderCustomer, OrderProduct } from "@/api/orders"
import { makePracticeOrder, savePracticeOrder } from "@/lib/order-practice"
import { orderInput } from "@/lib/orders"

const customer: OrderCustomer = {
  id: "C001",
  name: "康泰連鎖藥局 · 忠孝店",
  owner_id: "U01",
  owner_name: "林昱辰",
  payment_term: "RM06",
  region: "北區",
  address: "客戶提供的收貨地址",
}
const product: OrderProduct = {
  sku: "C130082",
  name: "金舒胃平",
  category: "一般用藥",
  spec: "20T/BOX",
  unit: "盒",
  unit_price: 80,
}

describe("訂單教學使用既有客戶與型錄", () => {
  it("依選定客戶建立頁面內草稿，不另造客戶或商品", () => {
    const order = makePracticeOrder(customer)
    expect(order.customer_id).toBe(customer.id)
    expect(order.customer_name).toBe(customer.name)
    expect(order.shipping_address).toBe(customer.address)
    expect(order.items).toEqual([])
    expect(order.status).toBe("draft")
  })

  it("保存選品時沿用型錄規格與價格檢查，無來源的品項不能保存", () => {
    const order = makePracticeOrder(customer)
    const input = {
      ...orderInput(order),
      items: [{ sku: product.sku, qty: 3, unit_price: 78 }],
    }
    const saved = savePracticeOrder(order, input, { [product.sku]: product })
    expect(saved.items[0]).toMatchObject({
      sku: "C130082",
      name: "金舒胃平",
      spec: "20T/BOX",
      standard_price: 80,
      price_status: "yellow",
    })
    expect(saved.amount).toBe(234)
    expect(() => savePracticeOrder(order, input, {})).toThrow("找不到商品資料")
    expect(order.items).toEqual([])
  })
})

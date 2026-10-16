import { describe, expect, it } from "vitest"
import type { OrderDetail, OrderInput } from "@/api/orders"
import { orderAmount, orderError, orderPrice, repeatOrder } from "@/lib/orders"

const body: OrderInput = {
  customer_id: "C1",
  ship_to_id: "C1",
  shipping_address: "測試地址",
  shipping_date: "2031-04-17",
  recipient: "",
  purchase_no: "",
  payment_term: "RM06",
  note: "",
  items: [],
}
describe("訂單金額與送出前驗證", () => {
  it("單價先到分再乘數量，合計不累積浮點誤差", () => {
    expect(
      orderAmount([
        { sku: "P1", qty: 3, unit_price: 0.1 },
        { sku: "P2", qty: 2, unit_price: 99.95 },
      ])
    ).toBe(200.2)
  })
  it("空白草稿可儲存，非法數量、小數位與重複品項會阻擋", () => {
    expect(orderError(body)).toBeNull()
    for (const item of [
      { sku: "P1", qty: 0, unit_price: 100 },
      { sku: "P1", qty: 1.2, unit_price: 100 },
      { sku: "P1", qty: 1, unit_price: 99.999 },
      { sku: "P1", qty: 1, unit_price: NaN },
    ])
      expect(orderError({ ...body, items: [item] })).not.toBeNull()
    expect(
      orderError({
        ...body,
        items: [
          { sku: "P1", qty: 1, unit_price: 100 },
          { sku: "P1", qty: 2, unit_price: 100 },
        ],
      })
    ).toContain("重複")
  })
  it("價格燈號以既有 3% 優惠權限判斷，邊界到分", () => {
    expect(orderPrice(100, 100).kind).toBe("green")
    expect(orderPrice(97, 100).kind).toBe("yellow")
    expect(orderPrice(96.99, 100).kind).toBe("red")
    expect(orderPrice(0, 0).kind).toBe("gray")
  })
  it("照舊帶出合併重複產品，以目前供貨價取代歷史成交價", () => {
    const history = {
      ...body,
      as_of: "2031-05-01",
      items: [
        { sku: "P1", qty: 3, unit_price: 33.33, standard_price: 100 },
        { sku: "P1", qty: 2, unit_price: 80, standard_price: 100 },
      ],
    } as OrderDetail
    const copied = repeatOrder(history)
    expect(copied.shipping_date).toBe("2031-05-01")
    expect(copied.items).toEqual([{ sku: "P1", qty: 5, unit_price: 100 }])
    expect(history.items[0].unit_price).toBe(33.33)
  })
})

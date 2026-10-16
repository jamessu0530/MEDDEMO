import type { OrderDetail, OrderInput, OrderItemInput } from "@/api/orders"

export const ORDER_STATUS = { draft: "草稿", effective: "生效" }
export const PAYMENT_TERMS = {
  RM06: "RM06 六個月內收款",
  RCD1: "RCD1 隔月業務收款",
  RCD2: "RCD2 隔月匯款",
  RZ04: "RZ04 隔月貨運收款",
}
export const orderMoney = (value: number) =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value)
export const orderAmount = (items: OrderItemInput[]) =>
  Math.round(
    items.reduce(
      (total, item) => total + Math.round(item.unit_price * 100) * item.qty,
      0
    )
  ) / 100

export function orderInput(order: OrderDetail): OrderInput {
  return {
    customer_id: order.customer_id,
    ship_to_id: order.ship_to_id,
    shipping_date: order.shipping_date,
    shipping_address: order.shipping_address,
    recipient: order.recipient,
    payment_term: order.payment_term,
    purchase_no: order.purchase_no,
    note: order.note,
    items: order.items.map(({ sku, qty, unit_price }) => ({
      sku,
      qty,
      unit_price,
    })),
  }
}
export function repeatOrder(order: OrderDetail): OrderInput {
  const products = new Map<string, OrderItemInput>()
  for (const item of order.items) {
    const prior = products.get(item.sku)
    products.set(item.sku, {
      sku: item.sku,
      qty: (prior?.qty ?? 0) + item.qty,
      unit_price: item.standard_price,
    })
  }
  return {
    ...orderInput(order),
    shipping_date: order.as_of,
    items: [...products.values()],
  }
}
export function orderError(input: OrderInput) {
  if (!input.customer_id || !input.ship_to_id) return "請選擇客戶與收貨點。"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.shipping_date))
    return "請填寫指定出貨日期。"
  if (input.items.length > 100) return "每張訂單最多 100 項產品。"
  if (new Set(input.items.map((item) => item.sku)).size !== input.items.length)
    return "產品不能重複，請調整原產品的數量。"
  if (
    input.items.some(
      (item) => !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100000
    )
  )
    return "產品數量需為 1～100,000 的整數。"
  if (
    input.items.some(
      (item) =>
        !Number.isFinite(item.unit_price) ||
        item.unit_price < 0 ||
        item.unit_price > 10000000 ||
        Math.abs(item.unit_price * 100 - Math.round(item.unit_price * 100)) >
          0.000001
    )
  )
    return "單價需為非負數，最多兩位小數。"
  if (orderAmount(input.items) > 9999999999.99) return "訂單總額超過上限。"
  return null
}
export function orderPrice(price: number, standard: number) {
  if (standard <= 0) return { kind: "gray", label: "價格待確認" } as const
  if (price >= standard) return { kind: "green", label: "標準供貨價" } as const
  if (Math.round(price * 100) >= Math.round(standard * 97))
    return { kind: "yellow", label: "優惠在 3% 權限內" } as const
  return { kind: "red", label: "需申請優惠" } as const
}

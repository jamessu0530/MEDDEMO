import type {
  OrderCustomer,
  OrderDetail,
  OrderInput,
  OrderProduct,
} from "@/api/orders"

export const PRACTICE_CUSTOMER: OrderCustomer = {
  id: "DEMO-CUSTOMER",
  name: "教學藥局（練習用）",
  owner_id: "DEMO",
  owner_name: "熊熊滾",
  payment_term: "RCD1",
  region: "教學區",
}
export const PRACTICE_PRODUCTS: OrderProduct[] = [
  {
    sku: "DEMO-P001",
    name: "教學商品（練習用）",
    category: "教學用品",
    spec: "示範規格",
    unit: "盒",
    unit_price: 120,
  },
]

/** 練習單只存在頁面記憶體，所有寫入都走這裡，不送訂單 API。 */
export function makePracticeOrder(): OrderDetail {
  const now = new Date().toISOString()
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(new Date())
  return {
    id: "demo",
    order_no: "練習訂單",
    source: "workspace",
    status: "draft",
    customer_id: PRACTICE_CUSTOMER.id,
    customer_name: PRACTICE_CUSTOMER.name,
    ship_to_id: PRACTICE_CUSTOMER.id,
    ship_to_name: PRACTICE_CUSTOMER.name,
    owner_id: "DEMO",
    owner_name: "熊熊滾",
    shipping_date: date,
    as_of: date,
    payment_term: PRACTICE_CUSTOMER.payment_term || "RCD1",
    shipping_address: "",
    recipient: "",
    purchase_no: "",
    note: "",
    items: [],
    amount: 0,
    revision: 1,
    readonly: false,
    created_at: now,
    updated_at: now,
    sap_order_no: null,
    order_type: "一般訂單",
    currency: "TWD",
  }
}

export function savePracticeOrder(
  order: OrderDetail,
  input: OrderInput
): OrderDetail {
  const items = input.items.map((item, index) => {
    const product = PRACTICE_PRODUCTS.find(
      (product) => product.sku === item.sku
    )!
    return {
      ...product,
      ...item,
      line_no: index + 1,
      amount: item.qty * item.unit_price,
      standard_price: product.unit_price,
      minimum_price: product.unit_price * 0.97,
      price_status: "green" as const,
      price_message: "教學價格",
    }
  })
  return {
    ...order,
    ...input,
    items,
    amount: items.reduce((sum, item) => sum + item.amount, 0),
    revision: order.revision + 1,
  }
}

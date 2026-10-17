import type {
  OrderCustomer,
  OrderDetail,
  OrderInput,
  OrderProduct,
} from "@/api/orders"
import { orderPrice } from "@/lib/orders"

/** 練習單只存在頁面記憶體，所有寫入都走這裡，不送訂單 API。 */
export function makePracticeOrder(customer: OrderCustomer): OrderDetail {
  const now = new Date().toISOString()
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(new Date())
  return {
    id: "demo",
    order_no: "練習訂單",
    source: "workspace",
    status: "draft",
    customer_id: customer.id,
    customer_name: customer.name,
    ship_to_id: customer.id,
    ship_to_name: customer.name,
    owner_id: customer.owner_id,
    owner_name: customer.owner_name,
    shipping_date: date,
    as_of: date,
    payment_term: customer.payment_term || "",
    shipping_address: customer.address || "",
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
  input: OrderInput,
  products: Record<string, OrderProduct | OrderDetail["items"][number]>
): OrderDetail {
  const items = input.items.map((item, index) => {
    const product = products[item.sku]
    if (!product) throw new Error("找不到商品資料，請重新選擇產品。")
    const standard =
      "standard_price" in product ? product.standard_price : product.unit_price
    const price = orderPrice(item.unit_price, standard)
    return {
      ...product,
      ...item,
      line_no: index + 1,
      amount: item.qty * item.unit_price,
      standard_price: standard,
      minimum_price: standard * 0.97,
      price_status: price.kind,
      price_message: price.label,
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

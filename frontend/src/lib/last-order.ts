import type { LastOrder, LastOrderLine, QuoteItem } from "@/api/customers"
import { formatDate } from "@/lib/format"

// 客戶檔案「上次訂的」：沒變的列先列幾項，其他收在「再看 N 項」
export const LAST_ORDER_SHOWN = 5

/** 有用到的那張：「10/5 進貨 · 9/30 報價」 */
export function lastOrderSources(last: LastOrder, separator = " · ") {
  return [last.order && `${formatDate(last.order.date)} 進貨`, last.quote && `${formatDate(last.quote.date)} 報價`]
    .filter(Boolean)
    .join(separator)
}

/** 一列：走口的「40EXa眼藥水(中口) × 1 口」，沒走口的「魚油 30 入 × 32 盒」 */
export function lastOrderLine(line: LastOrderLine) {
  return line.pack ? `${line.pack.name} × ${line.qty} 口` : `${line.name} × ${line.qty} ${line.unit}`
}

/** 變了的全部列出（後端已經排在前面），沒變的先列 shown 項，其他收起來 */
export function splitLastOrder(lines: LastOrderLine[], shown = LAST_ORDER_SHOWN) {
  const same = lines.filter((line) => !line.change)
  return { visible: [...lines.filter((line) => line.change), ...same.slice(0, shown)], hidden: same.slice(shown) }
}

export type RepeatFill = {
  quantities: Record<string, string>
  packCounts: Record<string, string>
  // 頁面上沒有那一列的品項（例如這期沒促銷的威鎮凝膠），加在常進品項最後面
  extra: QuoteItem[]
  // 變了的列下面那句話：不走促銷的列用料號，口用促銷品項編號
  notes: Record<string, string>
}

/**
 * 報價頁「照上次填」：數量與口數先全部清成 0，再照上次每一列抄成的寫法填；同一個品項不走促銷的數量相加。
 * skus 是頁面上已經有數量欄的料號（常進品項與「不走促銷」），codes 是這一期的每一口
 */
export function repeatFill(last: LastOrder, skus: string[], codes: string[]): RepeatFill {
  const quantities: Record<string, string> = Object.fromEntries(skus.map((sku) => [sku, "0"]))
  const packCounts: Record<string, string> = Object.fromEntries(codes.map((code) => [code, "0"]))
  const extra: QuoteItem[] = []
  const notes: Record<string, string> = {}
  for (const line of last.lines) {
    const repeat = line.repeat
    if ("promo_code" in repeat) {
      packCounts[repeat.promo_code] = String(Number(packCounts[repeat.promo_code] ?? 0) + repeat.packs)
      if (line.change) notes[repeat.promo_code] = line.change.text
      continue
    }
    if (!(repeat.sku in quantities)) {
      extra.push({ sku: line.sku, name: line.name, spec: line.spec, unit: line.unit, unit_price: line.supply_price, usual_qty: 0 })
      quantities[repeat.sku] = "0"
    }
    quantities[repeat.sku] = String(Number(quantities[repeat.sku]) + repeat.qty)
    if (line.change) notes[repeat.sku] = line.change.text
  }
  return { quantities, packCounts, extra, notes }
}

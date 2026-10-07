import type { IntentItem, RepeatSnapshot } from "@/api/visits"
import { formatDate } from "@/lib/format"

/** 確認頁意向最上面：「照上次的單抄了 21 項（10/5 進貨、9/30 報價），2 項促銷變了」。沒講跟上次一樣、或沒訂過是 null */
export function repeatHeader(snapshot: RepeatSnapshot): string | null {
  if (!snapshot.all || snapshot.empty) return null
  const sources = [snapshot.order && `${formatDate(snapshot.order.date)} 進貨`, snapshot.quote && `${formatDate(snapshot.quote.date)} 報價`]
    .filter(Boolean)
    .join("、")
  const changed = snapshot.changes.length ? `，${snapshot.changes.length} 項促銷變了` : ""
  return `照上次的單抄了 ${snapshot.copied} 項（${sources}）${changed}`
}

/** 意向一項下面的話：warnings 是促銷變了什麼，notes 是跟上次比加減多少。照品項與口對，口不同就不是同一列 */
export function repeatNotes(item: IntentItem, snapshot: RepeatSnapshot) {
  const same = (entry: { sku: string; promo_code: string | null }) => entry.sku === item.sku && entry.promo_code === item.promo_code
  const unit = item.promo_code ? "口" : (item.unit ?? "")
  const notes = snapshot.relative.filter(same).map(({ last_qty, delta }) => {
    if (delta === 0) return `照上次 ${last_qty} ${unit}`
    if (last_qty === 0) return `上次沒有，這次加 ${delta} ${unit}`
    return `上次 ${last_qty} ${unit}，這次${delta > 0 ? "多" : "少"} ${Math.abs(delta)} ${unit}`
  })
  return { warnings: snapshot.changes.filter(same).map((change) => change.text), notes }
}

import type { DiscountSteps } from "@/lib/approval"

/**
 * 整張報價的金額，算法跟後端一樣（api/customers.py）：折扣只套在沒促銷的列，單價到分；
 * 促銷的口照每口售價、不打折；整張到元
 */
export function quoteTotal(
  plain: { qty: number; unitPrice: number }[],
  packs: { packs: number; dealPrice: number }[],
  pct: number
) {
  const keep = 200 - Math.round(pct * 2)
  const discounted = plain.reduce((sum, line) => sum + (Math.round((line.unitPrice * keep) / 2) / 100) * line.qty, 0)
  return Math.round(discounted + packs.reduce((sum, line) => sum + line.dealPrice * line.packs, 0))
}

/** 送不出去的原因，寫在按鈕上；送得出去是 null */
export function quoteBlocked(input: {
  plainCount: number
  packCount: number
  discount: number
  route: DiscountSteps
  reason: string
}) {
  if (input.plainCount + input.packCount === 0) return "至少要有一項數量大於 0"
  if (!input.route.valid) return input.route.text
  if (input.discount > 0 && input.plainCount === 0) return "折扣只套在沒促銷的品項上"
  if (input.route.steps.length > 0 && !input.reason.trim()) return "要送簽核，請寫申請理由"
  return null
}

/** 一口的搭贈寫成一句：買 22 送 1；直走價不送同品，寫「直走 7」 */
export function packDeal(pack: { buy_qty: number; free_qty: number }) {
  return pack.free_qty > 0 ? `買 ${pack.buy_qty} 送 ${pack.free_qty}` : `直走 ${pack.buy_qty}`
}

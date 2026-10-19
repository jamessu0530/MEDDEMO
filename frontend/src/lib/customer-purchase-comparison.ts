import type { MonthlyPurchases } from "@/api/customers"

/** 依每月幾號對齊累計金額；尚未到的日期與該月不存在的日期保留 null。 */
export function buildPurchaseComparison(
  months: MonthlyPurchases[],
  today: string
) {
  const [year, month, through] = today.split("-").map(Number)
  const currentMonth = today.slice(0, 7)
  const previousDate = new Date(Date.UTC(year, month - 1, 0))
  const previousMonth = previousDate.toISOString().slice(0, 7)
  const currentDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const previousDays = previousDate.getUTCDate()
  const dailyAmounts = (key: string) =>
    new Map(
      months
        .find((item) => item.month === key)
        ?.daily.map((item) => [Number(item.date.slice(8)), item.amount])
    )
  const currentDaily = dailyAmounts(currentMonth)
  const previousDaily = dailyAmounts(previousMonth)
  let currentAmount = 0
  let previousAmount = 0
  let previousComparableAmount = 0
  const points = Array.from(
    { length: Math.max(currentDays, previousDays) },
    (_, index) => {
      const day = index + 1
      if (day <= through) currentAmount += currentDaily.get(day) ?? 0
      if (day <= previousDays) previousAmount += previousDaily.get(day) ?? 0
      if (day <= Math.min(through, previousDays))
        previousComparableAmount = previousAmount
      return {
        day,
        current: day <= through ? currentAmount : null,
        previous: day <= previousDays ? previousAmount : null,
      }
    }
  )
  return {
    currentMonth,
    previousMonth,
    through,
    points,
    currentAmount,
    previousAmount,
    previousComparableAmount,
  }
}

export type PurchaseComparison = ReturnType<typeof buildPurchaseComparison>

export function purchaseChangeNote(comparison: PurchaseComparison) {
  const { currentAmount, previousComparableAmount } = comparison
  if (!previousComparableAmount)
    return currentAmount ? "上月同期無進貨" : "與上月同期持平"
  const change = Math.round(
    (currentAmount / previousComparableAmount - 1) * 100
  )
  return change === 0
    ? "與上月同期持平"
    : `比上月同期 ${change > 0 ? "+" : ""}${change}%`
}

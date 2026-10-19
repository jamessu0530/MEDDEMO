import type { SalesOpportunity } from "@/api/sales-opportunities"

export type OpportunityFilter = "all" | "high" | "declining" | "key"
export type OpportunitySort = "priority" | "gap" | "previous"

export function filterOpportunities(
  items: SalesOpportunity[],
  query: string,
  filter: OpportunityFilter,
  sort: OpportunitySort
) {
  const search = query.trim().toLocaleLowerCase("zh-TW")
  const found = items.filter((item) => {
    if (filter === "high" && item.priority !== "high") return false
    if (filter === "declining" && !item.is_declining) return false
    if (filter === "key" && !item.is_key_account) return false
    return `${item.name} ${item.customer_id} ${item.city} ${item.area}`
      .toLocaleLowerCase("zh-TW")
      .includes(search)
  })
  // 預設順序由後端統一決定，篩選時保持穩定；其他排序只改副本。
  if (sort === "gap") found.sort((a, b) => b.gap_amount - a.gap_amount)
  if (sort === "previous")
    found.sort((a, b) => b.previous_amount - a.previous_amount)
  return found
}

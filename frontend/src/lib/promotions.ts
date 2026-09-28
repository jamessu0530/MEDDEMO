import type { Promotion, PromotionItem } from "@/api/promotions"

export type NoteSection = { title: string; body: string }

/** PM 提醒原文是一段段「* 標題」開頭的活動，拆開來各自收合。第一個「* 」之前如果有字，當成沒有標題的一段 */
export function splitNote(note: string): NoteSection[] {
  const sections: NoteSection[] = []
  for (const line of note.split("\n")) {
    if (line.startsWith("* ")) {
      sections.push({ title: line.slice(2).trim(), body: "" })
    } else if (sections.length === 0) {
      sections.push({ title: "", body: line })
    } else {
      const last = sections[sections.length - 1]
      last.body = last.body ? `${last.body}\n${line}` : line
    }
  }
  return sections.map((s) => ({ ...s, body: s.body.trim() })).filter((s) => s.title || s.body)
}

/** 同一個品牌的品項放在一起，品牌照第一次出現的順序（後端照促銷品項編號排，同品牌的編號本來就連在一起） */
export function groupItems(items: PromotionItem[]) {
  const groups = new Map<string, PromotionItem[]>()
  for (const item of items) groups.set(item.group_name, [...(groups.get(item.group_name) ?? []), item])
  return [...groups].map(([name, groupItems]) => ({ name, items: groupItems }))
}

/** 搜尋不分大小寫：品名有 LISIM、Pure 這類英文 */
export function matches(keyword: string, ...fields: string[]) {
  const k = keyword.trim().toLowerCase()
  return !k || fields.some((field) => field.toLowerCase().includes(k))
}

/** 沒有選過就看進行中的那一期；沒有進行中的，看最新的一期（清單新的在前） */
export function pickPromotion(promotions: Promotion[], selected: string | null) {
  return (
    promotions.find((p) => p.name === selected) ?? promotions.find((p) => p.status === "進行中") ?? promotions[0]
  )
}

/** <11+1> → 買 11 送 1；直走價不送同品 → 直走 7 盒 */
export function dealLabel(item: Pick<PromotionItem, "buy_qty" | "free_qty" | "unit">) {
  return item.free_qty > 0 ? `買 ${item.buy_qty} 送 ${item.free_qty}` : `直走 ${item.buy_qty} ${item.unit}`
}

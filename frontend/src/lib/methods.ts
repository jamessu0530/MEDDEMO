import type { MethodCard } from "@/api/methods"
import { matches } from "@/lib/promotions"

/** 方法卡的「情況」標籤在畫面上的名稱。值跟後端 models.METHOD_TAGS 同一組，順序就是篩選列的順序 */
export const TAG_LABELS: Record<string, string> = {
  competitor: "客戶提到競品",
  interval_up: "進貨間隔拉長",
  contract_ending: "合約快到期",
  ar_overdue: "帳款拖太久",
  festival: "節慶檔期",
  cost: "談進價與成本",
  newcomer: "新人必看",
}

export const TAGS = Object.keys(TAG_LABELS)

/** 後端多了這裡還不認得的標籤時照原樣顯示 */
export function tagLabel(tag: string) {
  return TAG_LABELS[tag] ?? tag
}

export type CardFilter = {
  tag: string | null
  customerType: MethodCard["customer_type"]
  keyword: string
}

/**
 * 方法卡只有幾十張，整份在手機上篩，打字時不必等網路。規則跟後端 GET /api/methods 的三個參數一樣：
 * 標籤是卡片掛的標籤裡有這一個；適用類型是指定那一種的，加上每種客戶都適用的；關鍵字在標題、情況、做法裡找。
 */
export function filterCards(cards: MethodCard[], { tag, customerType, keyword }: CardFilter) {
  return cards.filter(
    (card) =>
      (!tag || card.tags.includes(tag)) &&
      (!customerType || card.customer_type === null || card.customer_type === customerType) &&
      matches(keyword, card.title, card.situation, card.approach)
  )
}

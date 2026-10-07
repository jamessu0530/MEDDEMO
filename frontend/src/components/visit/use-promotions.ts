import { useEffect, useState } from "react"

import { listPromotions, type Promotion } from "@/api/promotions"

let promotionsPromise: Promise<Promotion[]> | null = null

/**
 * 每一期的促銷，同一頁只抓一次。確認頁的摘要照編號查一口（不管哪一期），編輯意向時只列進行中那一期的口。
 * 抓不到就是空的：摘要照口述講法、選單不出現，不擋業務確認
 */
export function usePromotions() {
  const [promotions, setPromotions] = useState<Promotion[]>([])
  useEffect(() => {
    promotionsPromise ??= listPromotions()
    promotionsPromise.then(setPromotions).catch(() => {
      promotionsPromise = null
    })
  }, [])
  return promotions
}

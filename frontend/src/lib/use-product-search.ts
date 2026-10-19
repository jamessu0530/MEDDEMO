import { useEffect, useState } from "react"
import { searchProducts } from "@/api/products"

/** 只接收目前查詢的結果；離線或 API 失敗時交回已載入的型錄搜尋。 */
export function useProductSearch(query: string, enabled = true) {
  const keyword = query.trim()
  const [snapshot, setSnapshot] = useState<{
    query: string
    skus: string[] | null
  } | null>(null)
  useEffect(() => {
    if (!enabled || !keyword) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      searchProducts(keyword, controller.signal)
        .then(({ skus }) => {
          if (!controller.signal.aborted) setSnapshot({ query: keyword, skus })
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setSnapshot({ query: keyword, skus: null })
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [keyword, enabled])
  const current = enabled && keyword && snapshot?.query === keyword
  return {
    skus: current ? snapshot.skus : null,
    pending: Boolean(enabled && keyword && !current),
  }
}

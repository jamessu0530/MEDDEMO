import { useEffect, useSyncExternalStore } from "react"
import { useLocation } from "react-router"

import {
  createPageContexts,
  mergePageContext,
  pageContextFor,
  type PageDetails,
} from "@/ask/page-context"
import { onAuthChange, readUser } from "@/lib/auth"

const contexts = createPageContexts()
let owner = readUser()?.id
onAuthChange(() => {
  const next = readUser()?.id
  if (next !== owner) contexts.clear()
  owner = next
})

/** 由已載入資料的頁面登錄選取對象與篩選，隱藏的分頁不得覆蓋目前情境。 */
export function useAskPageContext(details: PageDetails, active = true) {
  const { pathname, search } = useLocation()
  const key = pathname + search
  const serialized = JSON.stringify(details)
  useEffect(() => {
    if (active)
      return contexts.register(key, JSON.parse(serialized) as PageDetails)
  }, [key, serialized, active])
}

export function useCurrentPageContext() {
  const { pathname, search } = useLocation()
  const entries = useSyncExternalStore(contexts.subscribe, contexts.getSnapshot)
  return mergePageContext(
    pageContextFor(pathname, search),
    entries
      .filter((entry) => entry.key === pathname + search)
      .map((entry) => entry.details)
  )
}

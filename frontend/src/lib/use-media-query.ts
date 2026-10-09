import { useCallback, useSyncExternalStore } from "react"

import { DESKTOP_QUERY, WIDE_QUERY } from "@/lib/desktop-layout"

/** 視窗符不符合某個 media query，跟著視窗大小變。第一次畫就是當下的值，不會先畫手機版再跳 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query]
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

/** 電腦版（≥1024px）：側邊欄、寬版版面 */
export function useIsDesktop() {
  return useMediaQuery(DESKTOP_QUERY)
}

/** ≥1280px：頻道的記憶看板另外一欄 */
export function useIsWide() {
  return useMediaQuery(WIDE_QUERY)
}

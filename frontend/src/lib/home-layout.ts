import { useLayoutEffect, useState } from "react"

// 路線 27.5rem、欄距 1.5rem、地圖至少 22rem；量的是扣掉側邊欄與 main padding 後的空間。
export function hasHomeMapRoom(contentWidth: number, rootFontSize: number) {
  return contentWidth >= 51 * rootFontSize
}

/** 跟著內容寬度與根字級變化，避免大字、瀏覽器放大或窄桌機把地圖擠成細條。 */
export function useHomeSplitLayout() {
  const [container, ref] = useState<HTMLElement | null>(null)
  const [fitsSplit, setFitsSplit] = useState(false)

  useLayoutEffect(() => {
    if (!container) return
    const measure = (width: number) => {
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
      setFitsSplit(hasHomeMapRoom(width, rootFontSize))
    }
    const style = getComputedStyle(container)
    measure(container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width))
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

  return { ref, fitsSplit }
}

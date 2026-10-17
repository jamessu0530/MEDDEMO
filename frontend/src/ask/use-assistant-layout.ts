import { useEffect, useState } from "react"
import { useLocation } from "react-router"
import { assistantLayout } from "@/ask/assistant-layout"

/** 底部助理避開固定操作列，並將回覆與輸入欄一起限制在鍵盤上方。 */
export function useAssistantLayout(active = true) {
  const { pathname, search } = useLocation()
  const [layout, setLayout] = useState<{
    inset: number
    availableHeight?: number
  }>({ inset: 0 })
  useEffect(() => {
    if (!active) return
    let frame = 0
    const resize = new ResizeObserver(() => schedule())
    const update = () => {
      const footers: DOMRect[] = []
      document
        .querySelectorAll<HTMLElement>("[data-page-footer]")
        .forEach((element) => {
          if (element.closest('[role="dialog"]')) return
          resize.observe(element)
          const bounds = element.getBoundingClientRect()
          if (
            bounds.width &&
            bounds.height &&
            getComputedStyle(element).position === "fixed"
          )
            footers.push(bounds)
        })
      const next = assistantLayout({
        layoutHeight: window.innerHeight,
        viewport: window.visualViewport,
        footers,
      })
      setLayout((current) =>
        current.inset === next.inset &&
        current.availableHeight === next.availableHeight
          ? current
          : next
      )
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    window.visualViewport?.addEventListener("resize", schedule)
    window.visualViewport?.addEventListener("scroll", schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      resize.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      window.visualViewport?.removeEventListener("resize", schedule)
      window.visualViewport?.removeEventListener("scroll", schedule)
    }
  }, [pathname, search, active])
  return layout
}

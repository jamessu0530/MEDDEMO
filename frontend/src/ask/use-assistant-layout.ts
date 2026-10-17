import { useEffect, useState } from "react"
import { useLocation } from "react-router"
import { assistantLayout } from "@/ask/assistant-layout"

/** 面板與輸入列一起放在可見範圍內；只讓收合入口避讓頁面上的輸入列。 */
export function useAssistantLayout(active = true, avoidObstacles = false) {
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
      const obstacles: DOMRect[] = []
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
      if (avoidObstacles) {
        document
          .querySelectorAll<HTMLElement>("[data-assistant-obstacle]")
          .forEach((element) => {
            if (element.closest('[role="dialog"]')) return
            resize.observe(element)
            const bounds = element.getBoundingClientRect()
            if (bounds.width && bounds.height) obstacles.push(bounds)
          })
      }
      const next = assistantLayout({
        layoutHeight: window.innerHeight,
        viewport: window.visualViewport,
        footers,
        obstacles,
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
  }, [pathname, search, active, avoidObstacles])
  return layout
}

import { useEffect, useState } from "react"
import { useLocation } from "react-router"

/** 輸入列放在目前頁面的底部操作列／手機鍵盤上方。 */
export function useAssistantInset(active = true) {
  const { pathname, search } = useLocation()
  const [inset, setInset] = useState(0)
  useEffect(() => {
    if (!active) return
    let frame = 0
    const resize = new ResizeObserver(() => schedule())
    const update = () => {
      const viewport = window.visualViewport
      let bottom = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0
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
            bottom = Math.max(bottom, window.innerHeight - bounds.top)
        })
      setInset(Math.max(0, bottom))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener("resize", schedule)
    window.visualViewport?.addEventListener("resize", schedule)
    window.visualViewport?.addEventListener("scroll", schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      resize.disconnect()
      window.removeEventListener("resize", schedule)
      window.visualViewport?.removeEventListener("resize", schedule)
      window.visualViewport?.removeEventListener("scroll", schedule)
    }
  }, [pathname, search, active])
  return inset
}

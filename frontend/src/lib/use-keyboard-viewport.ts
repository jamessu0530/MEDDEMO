import { useEffect } from "react"
import { isKeyboardInput, keyboardViewport } from "@/lib/keyboard-viewport"

/** 讓全站欄位、對話框與底部工具列共用手機鍵盤的可見範圍。 */
export function useKeyboardViewport() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    let fullHeight = window.innerHeight
    let fullWidth = window.innerWidth
    let frame = 0
    let revealFrame = 0
    const update = () => {
      const focused = document.activeElement
      const editing = isKeyboardInput(focused)
      if (fullWidth !== window.innerWidth) {
        fullWidth = window.innerWidth
        fullHeight = window.innerHeight
      }
      if (!editing) fullHeight = Math.max(fullHeight, window.innerHeight)
      const layout = keyboardViewport({
        layoutHeight: window.innerHeight,
        fullHeight,
        height: viewport?.height,
        top: viewport?.offsetTop,
        scale: viewport?.scale,
        width: window.innerWidth,
        editing,
      })
      root.style.setProperty("--app-visual-height", `${layout.height}px`)
      root.style.setProperty("--app-visual-top", `${layout.top}px`)
      root.style.setProperty("--app-keyboard-inset", `${layout.inset}px`)
      root.dataset.keyboardOpen = String(layout.open)
      root.dataset.keyboardOwner = focused?.closest("[data-page-assistant]")
        ? "assistant"
        : "page"
      cancelAnimationFrame(revealFrame)
      if (layout.open && focused instanceof HTMLElement)
        revealFrame = requestAnimationFrame(() => {
          if (document.activeElement !== focused) return
          const bounds = focused.getBoundingClientRect()
          if (
            bounds.bottom > layout.top + layout.height - 12 ||
            bounds.top < layout.top + 12
          )
            focused.scrollIntoView({ block: "nearest", inline: "nearest" })
        })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    document.addEventListener("focusin", schedule)
    document.addEventListener("focusout", schedule)
    window.addEventListener("resize", schedule)
    viewport?.addEventListener("resize", schedule)
    viewport?.addEventListener("scroll", schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(revealFrame)
      document.removeEventListener("focusin", schedule)
      document.removeEventListener("focusout", schedule)
      window.removeEventListener("resize", schedule)
      viewport?.removeEventListener("resize", schedule)
      viewport?.removeEventListener("scroll", schedule)
      delete root.dataset.keyboardOpen
      delete root.dataset.keyboardOwner
      for (const name of [
        "--app-visual-height",
        "--app-visual-top",
        "--app-keyboard-inset",
      ])
        root.style.removeProperty(name)
    }
  }, [])
}

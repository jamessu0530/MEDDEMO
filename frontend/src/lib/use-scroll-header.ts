import { useCallback, useEffect, useRef, useState } from "react"
import { scrollHeader, type ScrollHeaderState } from "@/lib/scroll-header"
import { isKeyboardInput } from "@/lib/keyboard-viewport"

export function useScrollHeader(active: boolean) {
  const ref = useRef<HTMLElement>(null)
  const state = useRef<ScrollHeaderState>({
    position: 0,
    travel: 0,
    hidden: false,
  })
  const [hidden, setHidden] = useState(false)
  const reveal = useCallback(() => {
    state.current = {
      position: Math.max(0, window.scrollY),
      travel: 0,
      hidden: false,
    }
    setHidden(false)
  }, [])

  useEffect(() => {
    if (!active) return
    let frame = window.requestAnimationFrame(reveal)
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const focused = document.activeElement
        const header = ref.current
        const start = header?.parentElement?.getBoundingClientRect().top ?? 0
        state.current = scrollHeader(
          state.current,
          window.scrollY,
          document.documentElement.scrollHeight - window.innerHeight,
          Boolean(
            ref.current?.contains(focused) &&
            (isKeyboardInput(focused) || focused?.matches(":focus-visible"))
          ),
          start + window.scrollY + (header?.offsetHeight ?? 0)
        )
        setHidden(state.current.hidden)
      })
    }
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    }
  }, [active, reveal])

  return { ref, hidden: active && hidden, reveal }
}

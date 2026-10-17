import { useEffect, useRef } from "react"
import { flushSync } from "react-dom"
import type { CalendarView } from "@/lib/planner"

/** 只替換日曆內容的快照；連點時略過前一段動畫，保留最後一次選擇。 */
export function useCalendarViewTransition(
  view: CalendarView,
  onChange: (view: CalendarView) => void
) {
  const target = useRef(view)
  const request = useRef(0)
  const active = useRef<ViewTransition | null>(null)

  useEffect(
    () => () => {
      request.current += 1
      active.current?.skipTransition()
      active.current = null
      document.documentElement.classList.remove("planner-view-changing")
    },
    []
  )

  return (next: CalendarView) => {
    if (next === target.current) return
    target.current = next
    const id = ++request.current
    active.current?.skipTransition()

    const update = () => {
      if (request.current === id) flushSync(() => onChange(next))
    }
    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      active.current = null
      document.documentElement.classList.remove("planner-view-changing")
      update()
      return
    }

    document.documentElement.classList.add("planner-view-changing")
    const transition = document.startViewTransition(update)
    active.current = transition
    // 連點、背景分頁等情況可略過快照動畫，檢視更新仍正常完成。
    void transition.ready.catch(() => {})
    const finish = () => {
      if (active.current !== transition) return
      active.current = null
      document.documentElement.classList.remove("planner-view-changing")
    }
    void transition.finished.then(finish, finish)
  }
}

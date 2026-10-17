import { useRef, useState, type PointerEvent } from "react"

export function assistantSwipe(dx: number, dy: number, elapsed: number) {
  if (elapsed > 1200 || Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.8)
    return null
  return dx > 0 ? "ghost" : "new"
}

/** A gesture on the panel itself; inputs, links and the height control keep their own gestures. */
export function useAssistantSwipe(
  onSwipe: (action: "ghost" | "new") => void,
  enabled = true
) {
  const start = useRef<{ id: number; x: number; y: number; at: number } | null>(
    null
  )
  const consumed = useRef(false)
  const [dragging, setDragging] = useState<"ghost" | "new" | null>(null)
  return {
    dragging: enabled ? dragging : null,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      consumed.current = false
      start.current = null
      setDragging(null)
      if (!enabled || !event.isPrimary || event.button !== 0) return
      if (event.target instanceof Element) {
        if (event.target.closest("[role=separator],[data-no-assistant-swipe]"))
          return
        // 觸控可直接滑過收合時的輸入框；滑完吃掉 click，不會誤按送出。
        if (
          event.pointerType !== "touch" &&
          event.target.closest(
            "button,a,input,textarea,select,[contenteditable=true]"
          )
        )
          return
      }
      start.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        at: event.timeStamp,
      }
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const from = start.current
      if (!from || from.id !== event.pointerId) return
      if (!enabled) {
        start.current = null
        setDragging(null)
        return
      }
      const dx = event.clientX - from.x,
        dy = event.clientY - from.y
      if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {
        start.current = null
        setDragging(null)
      } else if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        setDragging(event.timeStamp - from.at <= 1200 ? (dx < 0 ? "new" : "ghost") : null)
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      } else setDragging(null)
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const from = start.current
      start.current = null
      setDragging(null)
      if (!enabled || !from || from.id !== event.pointerId) return
      const action = assistantSwipe(
        event.clientX - from.x,
        event.clientY - from.y,
        event.timeStamp - from.at
      )
      if (action) {
        consumed.current = true
        onSwipe(action)
      }
    },
    onPointerCancel() {
      start.current = null
      setDragging(null)
    },
    onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
      if (event.target !== event.currentTarget) return
      start.current = null
      setDragging(null)
    },
    onClickCapture(event: {
      preventDefault: () => void
      stopPropagation: () => void
    }) {
      if (consumed.current) {
        event.preventDefault()
        event.stopPropagation()
        consumed.current = false
      }
    },
  }
}

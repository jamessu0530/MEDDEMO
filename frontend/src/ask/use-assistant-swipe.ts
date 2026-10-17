import { useEffect, useRef, useState, type PointerEvent } from "react"

export type AssistantSwipeAction = "ghost" | "new"
export type AssistantSwipePreview = {
  action: AssistantSwipeAction
  progress: number
  phase: "dragging" | "returning"
  retreating: boolean
}

export const ASSISTANT_SWIPE_RETURN_MS = 460
export const assistantSwipeDistance = (width: number) =>
  Math.max(96, Math.min(240, width * 0.55))

export function assistantSwipeProgress(action: AssistantSwipeAction, dx: number, distance: number) {
  return Math.max(0, Math.min(1, (action === "ghost" ? dx : -dx) / distance))
}

export function assistantSwipe(dx: number, dy: number, _elapsed = 0, distance = 80): AssistantSwipeAction | null {
  if (!Number.isFinite(_elapsed) || Math.abs(dx) < distance || Math.abs(dx) < Math.abs(dy) * 1.8) return null
  return dx > 0 ? "ghost" : "new"
}

/** Follow the finger, and commit only when released past the unlock distance. */
export function useAssistantSwipe(
  onSwipe: (action: AssistantSwipeAction) => void,
  enabled = true
) {
  const start = useRef<{
    id: number; x: number; y: number; distance: number
    action: AssistantSwipeAction | null; progress: number
  } | null>(null)
  const consumed = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [preview, setPreview] = useState<AssistantSwipePreview | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  function clearReturn() {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  function goBack(action: AssistantSwipeAction) {
    clearReturn()
    setPreview({ action, progress: 0, phase: "returning", retreating: true })
    timer.current = setTimeout(() => {
      timer.current = null
      setPreview(null)
    }, ASSISTANT_SWIPE_RETURN_MS)
  }
  function cancel() {
    const from = start.current
    start.current = null
    if (from?.action) {
      consumed.current = true
      goBack(from.action)
    }
  }

  return {
    dragging: enabled && preview?.phase === "dragging" ? preview.action : null,
    preview: enabled ? preview : null,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      consumed.current = false
      start.current = null
      if (!enabled || !event.isPrimary || event.button !== 0) return
      if (event.target instanceof Element) {
        if (event.target.closest("[role=separator],[data-no-assistant-swipe]")) return
        // Touch can swipe over the input; a mouse can still select its text.
        if (event.pointerType !== "touch" && event.target.closest("button,a,input,textarea,select,[contenteditable=true]")) return
      }
      clearReturn()
      setPreview(null)
      start.current = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        distance: assistantSwipeDistance(event.currentTarget.clientWidth),
        action: null, progress: 0,
      }
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const from = start.current
      if (!from || from.id !== event.pointerId) return
      if (!enabled) { cancel(); return }
      const dx = event.clientX - from.x, dy = event.clientY - from.y
      if (!from.action) {
        if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) {
          start.current = null
          return
        }
        if (Math.abs(dx) <= 12 || Math.abs(dx) <= Math.abs(dy) * 1.8) return
        from.action = dx > 0 ? "ghost" : "new"
        consumed.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      const progress = assistantSwipeProgress(from.action, dx, from.distance)
      setPreview({ action: from.action, progress, phase: "dragging", retreating: progress < from.progress })
      from.progress = progress
      event.preventDefault()
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const from = start.current
      if (!from || from.id !== event.pointerId) return
      start.current = null
      if (!from.action) return
      const progress = assistantSwipeProgress(from.action, event.clientX - from.x, from.distance)
      if (enabled && progress >= 1) {
        clearReturn()
        setPreview(null)
        onSwipe(from.action)
      } else goBack(from.action)
    },
    onPointerCancel: cancel,
    onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
      if (event.target === event.currentTarget) cancel()
    },
    onClickCapture(event: { preventDefault: () => void; stopPropagation: () => void }) {
      if (consumed.current) {
        event.preventDefault()
        event.stopPropagation()
        consumed.current = false
      }
    },
  }
}

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"

import {
  assistantPanelSize,
  resizeAssistantPanel,
} from "@/ask/assistant-layout"
import { closeAssistant, openAssistant } from "@/ask/assistant-window"

type Drag = {
  pointerId: number
  y: number
  height: number
  open: boolean
  preferredHeight: number | undefined
  moved: boolean
}

export function useAssistantResize(open: boolean, availableHeight = 720) {
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [collapsedHeight, setCollapsedHeight] = useState(80)
  const [preferredHeight, setPreferredHeight] = useState<number>()
  const [resizing, setResizing] = useState(false)
  const size = assistantPanelSize({
    height: preferredHeight,
    availableHeight,
    collapsedHeight,
  })

  function apply(height: number, baseline = collapsedHeight, wasOpen = open) {
    const next = resizeAssistantPanel({
      height,
      availableHeight,
      collapsedHeight: baseline,
      wasOpen,
    })
    if (next.open) setPreferredHeight(next.height)
    if (next.open !== open) (next.open ? openAssistant : closeAssistant)()
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    const height = panelRef.current?.getBoundingClientRect().height
    if (!height) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    if (!open) setCollapsedHeight(height)
    drag.current = {
      pointerId: event.pointerId,
      y: event.clientY,
      height,
      open,
      preferredHeight,
      moved: false,
    }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const delta = current.y - event.clientY
    if (!current.moved && Math.abs(delta) < 6) return
    current.moved = true
    setResizing(true)
    apply(
      current.height + delta,
      current.open ? collapsedHeight : current.height,
      current.open
    )
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    setResizing(false)
    if (cancelled) {
      setPreferredHeight(current.preferredHeight)
      ;(current.open ? openAssistant : closeAssistant)()
    } else if (!current.moved) {
      ;(open ? closeAssistant : openAssistant)()
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault()
      event.stopPropagation()
      const current = drag.current
      drag.current = null
      setResizing(false)
      setPreferredHeight(current.preferredHeight)
      ;(current.open ? openAssistant : closeAssistant)()
      if (event.currentTarget.hasPointerCapture(current.pointerId))
        event.currentTarget.releasePointerCapture(current.pointerId)
      return
    }
    if (
      !["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(event.key)
    )
      return
    event.preventDefault()
    const height =
      panelRef.current?.getBoundingClientRect().height ?? size.height
    const baseline = open ? collapsedHeight : height
    if (!open) setCollapsedHeight(height)
    const step = event.shiftKey ? 96 : 48
    if (
      event.key === "Home" ||
      (event.key === "ArrowDown" && height - step < size.min)
    )
      closeAssistant()
    else if (event.key === "End") apply(size.max, baseline)
    else if (event.key === "Enter" || event.key === " ")
      (open ? closeAssistant : openAssistant)()
    else apply(height + (event.key === "ArrowUp" ? step : -step), baseline)
  }

  return {
    panelRef,
    height: size.height,
    resizing,
    handleProps: {
      onPointerDown: start,
      onPointerMove: move,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) =>
        finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) =>
        finish(event, true),
      onKeyDown: keyDown,
      "aria-valuenow": open
        ? Math.round((size.height / Math.max(1, size.max)) * 100)
        : 0,
    },
  }
}

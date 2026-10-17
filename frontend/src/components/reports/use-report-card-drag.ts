import type { SyntheticEvent } from "react"
import { useSortable } from "@dnd-kit/sortable"

/** A press anywhere on a card can lift it; chart controls retain their actions. */
export function useReportCardDrag(id: string, disabled: boolean) {
  const sortable = useSortable({ id, disabled })
  const listeners = sortable.listeners as
    Record<string, (event: SyntheticEvent) => void> | undefined
  function start(
    event: SyntheticEvent,
    listener?: (event: SyntheticEvent) => void
  ) {
    if (
      event.target instanceof Element &&
      event.target.closest(
        "button, a, input, select, textarea, [contenteditable='true'], [data-report-no-drag]"
      )
    )
      return
    listener?.(event)
  }
  return {
    ...sortable,
    listeners,
    surfaceListeners: {
      onMouseDown: (event: SyntheticEvent) =>
        start(event, listeners?.onMouseDown),
      onTouchStart: (event: SyntheticEvent) =>
        start(event, listeners?.onTouchStart),
      onContextMenu: (event: SyntheticEvent) => {
        if (!disabled) event.preventDefault()
      },
    },
  }
}

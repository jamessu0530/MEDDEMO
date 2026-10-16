import { useLayoutEffect, useState } from "react"

// Reserve 38rem for the canvas, plus panels, gaps and outer padding.
export function hasReportPanelRoom(
  width: number,
  rootFontSize: number,
  showData: boolean
) {
  return width >= (showData ? 76 : 60) * rootFontSize
}

/** Measure the workspace after the app navigation and text sizing take space. */
export function useReportWorkspaceLayout(showData: boolean) {
  const [container, ref] = useState<HTMLDivElement | null>(null)
  const [canvas, canvasRef] = useState<HTMLDivElement | null>(null)
  const [fitsPanels, setFitsPanels] = useState(false)
  const [dockBounds, setDockBounds] = useState<{
    left: number
    width: number
  }>()

  useLayoutEffect(() => {
    if (!container) return
    const measure = () => {
      const rootFontSize = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      setFitsPanels(
        hasReportPanelRoom(container.clientWidth, rootFontSize, showData)
      )
      if (canvas) {
        const { left, width } = canvas.getBoundingClientRect()
        setDockBounds((current) =>
          current?.left === left && current.width === width
            ? current
            : { left, width }
        )
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    if (canvas) observer.observe(canvas)
    const textSize = new MutationObserver(measure)
    textSize.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-text-size", "style", "class"],
    })
    return () => {
      observer.disconnect()
      textSize.disconnect()
    }
  }, [container, canvas, showData, fitsPanels])

  return { ref, canvasRef, fitsPanels, dockBounds }
}

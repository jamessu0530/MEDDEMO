import { useLayoutEffect, useState } from "react"
import { reportWidgetSize, type ReportWidgetSize } from "@/lib/report-widget"

/** Natural-height cards retain their original layout until explicitly resized. */
export function useReportWidgetSize(height?: number) {
  const [element, ref] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState<ReportWidgetSize>("small")
  useLayoutEffect(() => {
    if (!element || !height) return
    const measure = () => setSize(reportWidgetSize(element.clientWidth, height))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, height])
  return { widgetRef: ref, widgetSize: height ? size : undefined }
}

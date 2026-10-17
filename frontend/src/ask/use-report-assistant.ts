import { useLayoutEffect, useRef } from "react"
import { reportAssistant } from "@/ask/report-assistant"
import type { ReportConfig } from "@/lib/reports"

export function useReportAssistant(
  enabled: boolean,
  config: ReportConfig,
  available: boolean,
  onApply: (config: ReportConfig) => void
) {
  const connection = useRef<ReturnType<typeof reportAssistant.connect> | null>(
    null
  )
  useLayoutEffect(() => {
    const editor = { config, available, onApply }
    if (enabled) {
      if (!connection.current?.update(editor))
        connection.current = reportAssistant.connect(editor)
    } else {
      connection.current?.disconnect()
      connection.current = null
    }
  }, [enabled, config, available, onApply])
  useLayoutEffect(
    () => () => {
      connection.current?.disconnect()
      connection.current = null
    },
    []
  )
}

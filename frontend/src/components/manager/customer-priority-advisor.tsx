import { useLayoutEffect, useRef } from "react"
import type { PriorityStrategy } from "@/api/customer-priority"
import { customerPriorityAssistant } from "@/ask/customer-priority-assistant"

/** Register the current draft with the shared assistant; no separate chat UI. */
export function CustomerPriorityAdvisor({
  managerId,
  strategy,
  disabled,
  onUse,
}: {
  managerId: string
  strategy: PriorityStrategy
  disabled: boolean
  onUse: (strategy: PriorityStrategy, baseFingerprint: string) => void
}) {
  const connection = useRef<ReturnType<
    typeof customerPriorityAssistant.connect
  > | null>(null)
  useLayoutEffect(() => {
    const editor = { managerId, strategy, disabled, onUse }
    if (!connection.current?.update(editor))
      connection.current = customerPriorityAssistant.connect(editor)
  }, [managerId, strategy, disabled, onUse])
  useLayoutEffect(
    () => () => {
      connection.current?.disconnect()
      connection.current = null
    },
    []
  )
  return null
}

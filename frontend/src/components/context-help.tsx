import type { ReactNode } from "react"
import { Popover } from "radix-ui"
import { Info } from "@/components/icons"
import "./context-help.css"

/** 補充解釋按需查看；必填規則、錯誤與操作後果仍放在原本的操作旁。 */
export function ContextHelp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label={label} title={label} className="context-help-trigger">
          <Info size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label={label} side="bottom" align="end" sideOffset={6} collisionPadding={16} className="context-help-content">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

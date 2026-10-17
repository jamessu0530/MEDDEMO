import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Keep report controls in a bottom sheet on phones and a dialog on desktop. */
export function ReportSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="report-sheet">
        <div className="report-sheet-handle" aria-hidden="true" />
        <DialogHeader className="report-sheet-header">
          <div className="min-w-0">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">
              {description}
            </DialogDescription>
          </div>
          <button
            type="button"
            className="report-sheet-done"
            data-ui-demo="report-sheet-done"
            onClick={() => onOpenChange(false)}
          >
            完成
          </button>
        </DialogHeader>
        <div className="report-sheet-body">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

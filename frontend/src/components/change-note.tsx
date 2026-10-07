import { TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

/** 促銷變了的那一句：客戶檔案「上次訂的」、報價頁照上次填、確認頁共用 */
export function ChangeNote({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("flex items-start gap-1.5 text-xs leading-snug text-warning", className)}>
      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">{text}</span>
    </span>
  )
}

import { MessageSquareQuote, Package, Swords } from "@/components/icons"

import type { Note } from "@/api/notes"
import { NOTE_KIND_LABEL, noteDate } from "@/lib/calendar"
import { cn } from "@/lib/utils"

type NoteRowProps = {
  note: Pick<Note, "kind" | "text" | "on_date" | "customer_name">
  // 日曆上同一天有好幾家，要寫是哪一家；客戶檔案與路線小卡已經知道是哪家
  showCustomer?: boolean
  // 講過的放拜訪日，在客戶檔案寫日期有用；日曆上已經在那一天底下，不必再寫
  showDate?: boolean
}

// 要帶的是箱子、講過的是引號、競品是交叉的劍
const ICON = { bring: Package, told: MessageSquareQuote, competitor: Swords } as const
const TONE = { bring: "text-primary", told: "text-amber-600 dark:text-amber-400", competitor: "text-destructive" } as const

/** 一則備忘：要帶的是箱子、講過的是引號、競品是劍，後面是內容與日期 */
export function NoteRow({ note, showCustomer = false, showDate = true }: NoteRowProps) {
  const Icon = ICON[note.kind]
  const meta = [showCustomer ? note.customer_name : null, showDate && note.on_date ? noteDate(note.on_date) : null]
    .filter(Boolean)
    .join(" · ")
  return (
    <span className="flex min-w-0 items-start gap-2 text-left">
      <Icon
        aria-label={NOTE_KIND_LABEL[note.kind]}
        className={cn("mt-0.5 size-4 shrink-0", TONE[note.kind])}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug break-words">{note.text}</span>
        {meta && <span className="block text-xs text-muted-foreground">{meta}</span>}
      </span>
    </span>
  )
}

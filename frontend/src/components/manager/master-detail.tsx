import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** 電腦版主管端的左清單、右內容：清單 22rem；右邊固定在頁首下面，太長自己捲 */
export function MasterDetail({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid grid-cols-[22rem_minmax(0,1fr)] items-start gap-6">
      <div className="flex min-w-0 flex-col gap-2">{list}</div>
      <div className="sticky top-[4.5rem] flex max-h-[calc(100svh-5.5rem)] min-w-0 flex-col gap-3 overflow-y-auto px-1 pb-2">
        {detail}
      </div>
    </div>
  )
}

/** 清單的一列：點了在右邊打開，選中的那列用主色框 */
export function ListRow({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-2xl border-2 bg-card px-4 py-3 text-left shadow-lip press",
        selected && "border-primary shadow-lip-primary"
      )}
    >
      {children}
    </button>
  )
}

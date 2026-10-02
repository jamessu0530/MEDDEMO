import { useState } from "react"

import { Button } from "@/components/ui/button"
import { WEEKDAY_LABEL } from "@/lib/itinerary"
import { cn } from "@/lib/utils"

export type HabitChoice = "today" | "weekday" | "always"

/**
 * 拖完、改完從下面滑出來問「以後也這樣排嗎？」，預設「只有今天」。
 * 星期幾是今天（系統日期）是星期幾。答應的習慣先放在草稿裡，按「完成」才跟行程一起存。
 */
export function HabitPrompt({ text, weekday, onDone }: { text: string; weekday: number; onDone: (choice: HabitChoice) => void }) {
  const [choice, setChoice] = useState<HabitChoice>("today")
  const options: [HabitChoice, string][] = [
    ["today", "只有今天"],
    ["weekday", `每個星期${WEEKDAY_LABEL[weekday]}都這樣`],
    ["always", "每次都這樣"],
  ]
  return (
    <div
      role="dialog"
      aria-label="以後也這樣排嗎？"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md animate-in px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] duration-200 slide-in-from-bottom-4 motion-reduce:animate-none"
    >
      <div className="rounded-2xl border-2 bg-card p-4 shadow-lip">
        <p className="text-xs font-semibold text-muted-foreground">以後也這樣排嗎？</p>
        <p className="mt-1 text-base leading-snug font-semibold">{text}</p>
        <div role="radiogroup" aria-label="要不要記成習慣" className="mt-3 flex flex-col gap-1.5">
          {options.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={choice === value}
              onClick={() => setChoice(value)}
              className={cn(
                "flex h-11 items-center gap-2.5 rounded-xl border-2 px-3 text-left text-sm",
                choice === value ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card"
              )}
            >
              <span className={cn("size-4 shrink-0 rounded-full border-2", choice === value ? "border-[5px] border-primary" : "border-input")} />
              {label}
            </button>
          ))}
        </div>
        <Button className="mt-3 h-11 w-full" onClick={() => onDone(choice)}>
          好
        </Button>
      </div>
    </div>
  )
}

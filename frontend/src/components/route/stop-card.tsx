import type { ReactNode } from "react"
import type { DraggableAttributes } from "@dnd-kit/core"
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities"
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  GripVertical,
  Lock,
  Repeat,
  StickyNote,
  Undo2,
  type LucideIcon,
} from "lucide-react"

import { SIGNAL_LABEL, type Precedence, type RouteStop } from "@/api/route"
import { Button } from "@/components/ui/button"
import { windowLabel, type RuleNote } from "@/lib/itinerary"
import { signalTone, TONE_CLASS } from "@/lib/route-path"
import { cn } from "@/lib/utils"

// 拖移把手：dnd-kit 的 useSortable 給的，只有把手按著才拖得動，其他地方照樣可以捲動
export type StopHandle = {
  ref: (element: HTMLElement | null) => void
  attributes: DraggableAttributes
  listeners: SyntheticListenerMap | undefined
}

export type StopCardProps = {
  // 可以改的欄位已經是草稿上的，時間、車程、理由是最近一次 preview 回來的
  stop: RouteStop
  // 站號，含跑完的站
  number: number
  names: Record<string, string>
  // 跟這一站有關的今天的先後
  precedences: Precedence[]
  // 違反的規則
  notes?: RuleNote[]
  // 「復原」回得去（有一份不違反這幾條的草稿）
  undoable?: boolean
  expanded?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  dragging?: boolean
  handle?: StopHandle
  onToggle?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  // 今天的先後：「拿掉這條限制」
  onDropRule?: (note: RuleNote) => void
  // 習慣：「今天不套用這條」
  onSkipHabit?: (note: RuleNote) => void
  onUndo?: (note: RuleNote) => void
  // 展開時的編輯區（StopEditor）
  children?: ReactNode
}

/**
 * 調整清單上的一站：拖移把手、站號、客戶名、「HH:MM 到 · 停 N 分」，下面一排小標籤，右邊上移下移給不方便拖的人。
 * 點卡片就地展開編輯；違反規則時整張卡變紅框，寫是哪一條、怎麼處理。已完成的站淡色、沒有把手，不能動。
 */
export function StopCard({
  stop,
  number,
  names,
  precedences,
  notes = [],
  undoable,
  expanded,
  canMoveUp,
  canMoveDown,
  dragging,
  handle,
  onToggle,
  onMoveUp,
  onMoveDown,
  onDropRule,
  onSkipHabit,
  onUndo,
  children,
}: StopCardProps) {
  const done = stop.status === "done"
  const broken = notes.length > 0
  return (
    <article
      data-broken={broken || undefined}
      className={cn(
        "rounded-2xl border-2 bg-card shadow-lip",
        broken && "border-destructive",
        done && "opacity-60",
        dragging && "shadow-lg ring-3 ring-ring/30"
      )}
    >
      <div className="flex items-stretch gap-0.5 p-1.5">
        {done ? (
          <span className="w-9 shrink-0" />
        ) : (
          <button
            type="button"
            ref={handle?.ref}
            {...handle?.attributes}
            {...handle?.listeners}
            aria-label={`拖移 ${stop.customer_name}`}
            className="flex w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <GripVertical className="size-5" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={done ? undefined : Boolean(expanded)}
          disabled={done}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg py-1.5 pr-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              done ? "bg-primary text-primary-foreground" : "bg-input"
            )}
          >
            {done ? <Check className="size-4" strokeWidth={3} /> : number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{stop.customer_name}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {done ? `${stop.planned_time} 完成` : `${stop.planned_time} 到 · 停 ${stop.duration_minutes} 分`}
            </span>
            {!done && stop.late_minutes > 0 && (
              <span className="block text-xs font-semibold text-destructive">會晚到 {stop.late_minutes} 分</span>
            )}
            {!done && <Tags stop={stop} names={names} precedences={precedences} />}
          </span>
        </button>
        {!done && (
          <div className="flex shrink-0 flex-col justify-center">
            <button
              type="button"
              aria-label={`上移 ${stop.customer_name}`}
              disabled={!canMoveUp}
              onClick={onMoveUp}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronUp className="size-5" />
            </button>
            <button
              type="button"
              aria-label={`下移 ${stop.customer_name}`}
              disabled={!canMoveDown}
              onClick={onMoveDown}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronDown className="size-5" />
            </button>
          </div>
        )}
      </div>
      {broken && (
        <div className="flex flex-col gap-2.5 border-t-2 border-destructive/30 px-3 py-2.5">
          {notes.map((note) => (
            <div key={note.rule.id} className="flex flex-col gap-1.5">
              <p className="text-xs leading-snug font-semibold text-destructive">違反：{note.text}</p>
              <div className="flex gap-2">
                {note.rule.source === "today" ? (
                  <Button variant="outline" className="h-10 flex-1 text-xs" onClick={() => onDropRule?.(note)}>
                    拿掉這條限制
                  </Button>
                ) : (
                  <Button variant="outline" className="h-10 flex-1 text-xs" onClick={() => onSkipHabit?.(note)}>
                    今天不套用這條
                  </Button>
                )}
                {undoable && (
                  <Button variant="outline" className="h-10 w-20 shrink-0 text-xs" onClick={() => onUndo?.(note)}>
                    <Undo2 />
                    復原
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {expanded && !done && children && <div className="border-t-2 px-3 py-3">{children}</div>}
    </article>
  )
}

type Tag = { key: string; text: string; icon?: LucideIcon; className?: string }

function Tags({ stop, names, precedences }: { stop: RouteStop; names: Record<string, string>; precedences: Precedence[] }) {
  const tags: Tag[] = []
  if (stop.window_kind && stop.window_time) {
    tags.push({ key: "window", icon: Clock, text: windowLabel(stop.window_kind, stop.window_time) })
  }
  if (stop.locked) tags.push({ key: "lock", icon: Lock, text: "鎖住" })
  for (const p of precedences) {
    if (p.after === stop.customer_id) {
      tags.push({ key: `after:${p.before}`, icon: ArrowDownUp, text: `在 ${names[p.before] ?? p.before} 之後` })
    } else if (p.before === stop.customer_id) {
      tags.push({ key: `before:${p.after}`, icon: ArrowDownUp, text: `在 ${names[p.after] ?? p.after} 之前` })
    }
  }
  if (stop.note) tags.push({ key: "note", icon: StickyNote, text: stop.note })
  if (stop.habit_ids.length > 0) tags.push({ key: "habit", icon: Repeat, text: "習慣", className: "bg-success/15 text-success" })
  tags.push({
    key: "signal",
    text: SIGNAL_LABEL[stop.signal],
    className: cn("font-semibold", TONE_CLASS[signalTone(stop.signal)]),
  })
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {tags.map(({ key, text, icon: Icon, className }) => (
        <span
          key={key}
          className={cn(
            "flex max-w-full items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground",
            className
          )}
        >
          {Icon && <Icon className="size-3 shrink-0" />}
          <span className="truncate">{text}</span>
        </span>
      ))}
    </span>
  )
}

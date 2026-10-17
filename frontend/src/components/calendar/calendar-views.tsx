import { useEffect, useId, useRef } from "react"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import type { CSSProperties } from "react"
import { GripVertical, MapPin, Repeat2 } from "@/components/icons"
import type { CalendarEvent } from "@/api/planner"
import type { CalendarDay } from "@/api/notes"
import { Button } from "@/components/ui/button"
import {
  dateKey,
  eventKey,
  layoutTimedEvents,
  minutesOfDay,
  onDay,
  timeLabel,
  type EventPlacement,
} from "@/lib/planner"
import { dayTitle } from "@/lib/calendar"
import { cn } from "@/lib/utils"

type ViewProps = {
  days: string[]
  events: CalendarEvent[]
  today: string
  selected: string
  onSelect: (date: string) => void
  onOpen: (event: CalendarEvent) => void
  onCreate: (date: string, minutes?: number) => void
}
const DAYS = ["一", "二", "三", "四", "五", "六", "日"]

export function CalendarMonthView({
  days,
  events,
  today,
  selected,
  onSelect,
  onOpen,
  onCreate,
  legacy,
}: ViewProps & { legacy: Map<string, CalendarDay> }) {
  return (
    <div className="planner-month rounded-2xl border bg-card">
      <div className="grid grid-cols-7 border-b">
        {DAYS.map((d, index) => (
          <div
            key={d}
            className={cn(
              "py-2 text-center text-xs",
              index >= 5 ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => (
          <MonthCell
            key={date}
            date={date}
            events={events.filter((event) => onDay(event, date))}
            today={today}
            selected={selected}
            legacy={legacy.get(date)}
            onSelect={onSelect}
            onOpen={onOpen}
            onCreate={onCreate}
          />
        ))}
      </div>
    </div>
  )
}
function MonthCell({
  date,
  events,
  today,
  selected,
  legacy,
  onSelect,
  onOpen,
  onCreate,
}: Omit<ViewProps, "days" | "events"> & {
  date: string
  events: CalendarEvent[]
  legacy?: CalendarDay
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `month:${date}`,
    data: { date },
  })
  const selectedMonth = selected.slice(0, 7)
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "planner-month-cell min-w-0 border-r border-b p-1 sm:p-2",
        date.slice(0, 7) !== selectedMonth &&
          "bg-muted/30 text-muted-foreground",
        selected === date && "bg-primary/5",
        isOver && "ring-2 ring-primary ring-inset"
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-label={dayTitle(date)}
          aria-pressed={date === selected}
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-sm tabular-nums",
            date === today &&
              "bg-primary font-semibold text-primary-foreground",
            selected === date && date !== today && "ring-2 ring-primary/50"
          )}
          onClick={() => onSelect(date)}
          onDoubleClick={() => onCreate(date)}
        >
          {Number(date.slice(-2))}
        </button>
        {legacy && (legacy.notes.length > 0 || legacy.visits.length > 0) && (
          <span
            className="size-1.5 rounded-full bg-muted-foreground"
            title="有拜訪或客戶備忘"
          />
        )}
      </div>
      <div className="space-y-0.5">
        {events.slice(0, 3).map((event) => (
          <EventChip
            key={eventKey(event)}
            event={event}
            onOpen={onOpen}
            compact
          />
        ))}
        {events.length > 3 && (
          <button
            type="button"
            className="w-full rounded px-1 text-left text-[11px] text-muted-foreground hover:bg-muted sm:text-xs"
            onClick={() => onSelect(date)}
          >
            +{events.length - 3} 項
          </button>
        )}
      </div>
    </div>
  )
}

export function EventChip({
  event,
  onOpen,
  compact = false,
  placement,
}: {
  event: CalendarEvent
  onOpen: (event: CalendarEvent) => void
  compact?: boolean
  placement?: EventPlacement
}) {
  const instance = useId()
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } =
    useDraggable({
      id: `event:${instance}`,
      data: { event },
      disabled: !event.can_edit,
    })
  const {
    setNodeRef: setResizeRef,
    listeners: resizeListeners,
    attributes: resizeAttributes,
    isDragging: resizing,
  } = useDraggable({
    id: `resize:${instance}`,
    data: { event, resize: true },
    disabled: !event.can_edit || !placement,
  })
  const style: CSSProperties = {
    borderLeftColor: event.color,
    background: `color-mix(in srgb, ${event.color} 14%, var(--card))`,
    opacity: isDragging || resizing ? 0.45 : 1,
    ...(placement
      ? {
          top: placement.top * 0.8,
          height: placement.height * 0.8,
          left: `calc(${(placement.column / placement.columns) * 100}% + 2px)`,
          width: `calc(${100 / placement.columns}% - 5px)`,
        }
      : {}),
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/event relative min-w-0 overflow-hidden rounded-md border-l-[3px] text-foreground",
        placement ? "absolute z-10" : "flex",
        compact ? "text-[10px] leading-4 sm:text-xs" : "text-sm",
        !compact && !placement && "min-h-11"
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(event)}
        className={cn(
          "min-w-0 flex-1 text-left",
          placement
            ? "h-full w-full overflow-hidden px-1.5 py-0.5 align-top"
            : "px-1 py-0.5",
          !compact && !placement && "px-3 py-2"
        )}
        title={`${event.title} · ${event.all_day ? "全天" : `${timeLabel(event.starts_at)}–${timeLabel(event.ends_at)}`}`}
      >
        <span
          className={cn(
            "block font-medium",
            placement
              ? placement.height >= 90
                ? "line-clamp-2 leading-tight"
                : "line-clamp-1 leading-tight"
              : "truncate"
          )}
        >
          {!placement && !event.all_day && (
            <span className="mr-1 font-normal tabular-nums">
              {timeLabel(event.starts_at)}
            </span>
          )}
          {event.title}
        </span>
        {placement && placement.height >= 45 && (
          <span className="block truncate text-[10px]">
            {timeLabel(event.starts_at)}–{timeLabel(event.ends_at)}
          </span>
        )}
        {!compact && !placement && (
          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {event.all_day
                ? "全天"
                : `${timeLabel(event.starts_at)}–${timeLabel(event.ends_at)}`}
            </span>
            <span>{event.calendar_name}</span>
            {event.recurrence && <Repeat2 className="size-3" />}
            {event.location && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
          </span>
        )}
      </button>
      {event.can_edit && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`拖曳${event.title}改期`}
          {...listeners}
          {...attributes}
          style={{ touchAction: "none" }}
          className={cn(
            "shrink-0 cursor-grab rounded p-0.5 text-muted-foreground opacity-60 hover:bg-black/5 focus:opacity-100 active:cursor-grabbing sm:opacity-0 sm:group-hover/event:opacity-100",
            placement && "absolute top-0 right-0"
          )}
        >
          <GripVertical className={compact ? "size-3" : "size-3.5"} />
        </button>
      )}
      {placement && event.can_edit && (
        <button
          ref={setResizeRef}
          type="button"
          aria-label={`調整${event.title}結束時間`}
          {...resizeListeners}
          {...resizeAttributes}
          style={{ touchAction: "none" }}
          className="absolute right-0 bottom-0 left-0 h-2 cursor-ns-resize opacity-60 hover:bg-black/10"
        >
          <span className="mx-auto block h-0.5 w-5 rounded bg-current" />
        </button>
      )}
    </div>
  )
}

export function CalendarTimeView({
  days,
  events,
  today,
  selected,
  onSelect,
  onOpen,
  onCreate,
}: ViewProps) {
  const scroll = useRef<HTMLDivElement>(null)
  const key = days.join(",")
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * 48
  }, [key])
  const now = new Date().toISOString()
  return (
    <div
      ref={scroll}
      className="planner-time-scroll max-h-[70svh] overflow-auto rounded-2xl border bg-card"
    >
      <div className={days.length > 1 ? "min-w-[700px]" : "min-w-[280px]"}>
        <div
          className="sticky top-0 z-20 grid border-b bg-card"
          style={{
            gridTemplateColumns: `44px repeat(${days.length}, minmax(0,1fr))`,
          }}
        >
          <span className="self-center px-1 text-[10px] text-muted-foreground">
            台北
          </span>
          {days.map((date) => (
            <button
              type="button"
              key={date}
              className={cn(
                "border-l p-2 text-center text-sm",
                date === selected && "bg-muted"
              )}
              onClick={() => onSelect(date)}
            >
              <span className="block text-xs text-muted-foreground">
                週{DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]}
              </span>
              <span
                className={cn(
                  "mx-auto mt-1 flex size-7 items-center justify-center rounded-full",
                  date === today && "bg-primary text-primary-foreground"
                )}
              >
                {Number(date.slice(-2))}
              </span>
            </button>
          ))}
          <span className="border-t px-1 py-2 text-[10px] text-muted-foreground">
            全天
          </span>
          {days.map((date) => (
            <div
              key={date}
              className="min-h-9 min-w-0 space-y-1 border-t border-l p-1"
            >
              {events
                .filter((event) => event.all_day && onDay(event, date))
                .map((event) => (
                  <EventChip
                    key={eventKey(event)}
                    compact
                    event={event}
                    onOpen={onOpen}
                  />
                ))}
            </div>
          ))}
        </div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `44px repeat(${days.length}, minmax(0,1fr))`,
          }}
        >
          <div className="relative h-[1152px]">
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className="absolute right-1 text-[10px] text-muted-foreground tabular-nums"
                style={{ top: hour * 48 + 2 }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((date) => (
            <div key={date} className="relative h-[1152px] min-w-0 border-l">
              {Array.from({ length: 48 }, (_, slot) => (
                <TimeSlot
                  key={slot}
                  date={date}
                  minutes={slot * 30}
                  onCreate={onCreate}
                />
              ))}
              {layoutTimedEvents(events, date).map((placement) => (
                <EventChip
                  key={eventKey(placement.event)}
                  event={placement.event}
                  placement={placement}
                  onOpen={onOpen}
                />
              ))}
              {dateKey(now) === date && (
                <div
                  aria-label="目前時間"
                  className="pointer-events-none absolute right-0 left-0 z-10 border-t-2 border-destructive"
                  style={{ top: minutesOfDay(now) * 0.8 }}
                >
                  <span className="absolute -top-1 -left-1 size-2 rounded-full bg-destructive" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
function TimeSlot({
  date,
  minutes,
  onCreate,
}: {
  date: string
  minutes: number
  onCreate: ViewProps["onCreate"]
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `time:${date}:${minutes}`,
    data: { date, minutes },
  })
  return (
    <button
      type="button"
      ref={setNodeRef}
      aria-label={`${dayTitle(date)} ${Math.floor(minutes / 60)}:${minutes % 60 ? "30" : "00"} 新增行程`}
      className={cn(
        "absolute right-0 left-0 h-6 border-t text-left hover:bg-muted/50 focus-visible:z-20 focus-visible:bg-muted",
        minutes % 60 === 0 ? "border-border" : "border-dashed border-border/50",
        isOver && "bg-primary/20 ring-1 ring-primary"
      )}
      style={{ top: minutes * 0.8 }}
      onClick={() => onCreate(date, minutes)}
    />
  )
}

export function CalendarListView({
  days,
  events,
  selected,
  onOpen,
  onCreate,
  search = false,
}: Pick<ViewProps, "days" | "events" | "selected" | "onOpen" | "onCreate"> & {
  search?: boolean
}) {
  const groups = search
    ? Array.from(new Set(events.map((e) => dateKey(e.starts_at)))).sort()
    : days.filter((date) => events.some((event) => onDay(event, date)))
  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-4 py-12 text-center">
          <p className="mb-3 text-sm text-muted-foreground">
            {search
              ? "找不到符合的行程，試試其他標題、地點或附註。"
              : "這段日期還沒有行程。"}
          </p>
          {!search && (
            <Button variant="outline" onClick={() => onCreate(selected)}>
              新增行程
            </Button>
          )}
        </div>
      ) : (
        groups.map((date) => (
          <section key={date}>
            <h3 className="mb-2 text-sm font-semibold">{dayTitle(date)}</h3>
            <div className="space-y-2">
              {events
                .filter((event) =>
                  search
                    ? dateKey(event.starts_at) === date
                    : onDay(event, date)
                )
                .map((event) => (
                  <EventChip
                    key={eventKey(event)}
                    event={event}
                    onOpen={onOpen}
                  />
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

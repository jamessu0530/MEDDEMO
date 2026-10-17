import { useEffect, useState } from "react"
import {
  DndContext,
  closestCenter,
  pointerWithin,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { Link, useSearchParams } from "react-router"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Settings,
  X,
} from "@/components/icons"
import { listCustomers, type Customer } from "@/api/customers"
import { getCalendar, type CalendarDay, type Note } from "@/api/notes"
import * as api from "@/api/planner"
import { CalendarManager } from "@/components/calendar/calendar-manager"
import {
  CalendarListView,
  CalendarMonthView,
  CalendarTimeView,
  EventChip,
} from "@/components/calendar/calendar-views"
import { EventDialog } from "@/components/calendar/event-dialog"
import { NoteDialog } from "@/components/note-dialog"
import { NoteRow } from "@/components/note-row"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/lib/auth"
import { dayTitle, monthTitle, shiftMonth } from "@/lib/calendar"
import {
  dateKey,
  eventBody,
  eventKey,
  message,
  moveEvent,
  onDay,
  shiftDay,
  viewDays,
  zonedIso,
  type CalendarView,
} from "@/lib/planner"
import { cn } from "@/lib/utils"
import "@/components/calendar/planner.css"

type Editor = {
  date: string
  event?: api.CalendarEvent
  seed?: Partial<api.EventBody>
}
type Move = { event: api.CalendarEvent; body: api.EventBody; resize: boolean }
const VIEWS: [CalendarView, string][] = [
  ["month", "月"],
  ["week", "週"],
  ["day", "日"],
  ["list", "清單"],
]

export function CalendarPage() {
  const [params] = useSearchParams()
  return (
    <CalendarWorkspacePage
      key={params.toString()}
      requestedDate={params.get("date")}
      requestedEvent={params.get("event")}
    />
  )
}

function CalendarWorkspacePage({
  requestedDate,
  requestedEvent,
}: {
  requestedDate: string | null
  requestedEvent: string | null
}) {
  const user = useAuth()?.user
  const [anchor, setAnchor] = useState(() =>
    requestedDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) &&
    Number.isFinite(Date.parse(requestedDate))
      ? requestedDate
      : dateKey(new Date())
  )
  const [view, setView] = useState<CalendarView>(() => {
    try {
      const saved = localStorage.getItem("meddemo:calendar-view")
      return VIEWS.some(([v]) => v === saved)
        ? (saved as CalendarView)
        : "month"
    } catch {
      return "month"
    }
  })
  const [workspace, setWorkspace] = useState<api.CalendarWorkspace | null>(null)
  const [events, setEvents] = useState<api.CalendarEvent[]>([])
  const [legacy, setLegacy] = useState(new Map<string, CalendarDay>())
  const [customers, setCustomers] = useState<Customer[]>([])
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState<{
    query: string
    events: api.CalendarEvent[]
    truncated: boolean
  } | null>(null)
  const [searchError, setSearchError] = useState("")
  const [showLegacy, setShowLegacy] = useState(false)
  const [showInvitations, setShowInvitations] = useState(true)
  const [manager, setManager] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [writing, setWriting] = useState<{
    customer: Customer
    note?: Note
  } | null>(null)
  const [customerId, setCustomerId] = useState("")
  const [move, setMove] = useState<Move | null>(null)
  const [moving, setMoving] = useState(false)
  const [dragTitle, setDragTitle] = useState("")
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor)
  )
  const days = viewDays(anchor, view)
  const start = zonedIso(days[0]),
    end = zonedIso(shiftDay(days.at(-1)!, 1))
  const refresh = () => setRevision((value) => value + 1)

  useEffect(() => {
    const controller = new AbortController()
    api
      .getWorkspace(controller.signal)
      .then(setWorkspace)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e))
      })
    return () => controller.abort()
  }, [revision])
  useEffect(() => {
    const controller = new AbortController()
    api
      .getEvents(start, end, controller.signal)
      .then((data) => {
        setEvents(data.events)
        setLoading(false)
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(message(e))
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [start, end, revision])
  const firstMonth = days[0].slice(0, 7),
    lastMonth = days.at(-1)!.slice(0, 7)
  useEffect(() => {
    if (!showLegacy) return
    const controller = new AbortController()
    const months = []
    for (
      let month = firstMonth;
      month <= lastMonth;
      month = shiftMonth(month, 1)
    )
      months.push(month)
    Promise.all(months.map((month) => getCalendar(month, controller.signal)))
      .then((data) =>
        setLegacy(
          new Map(
            data.flatMap((month) =>
              month.days.map((day) => [day.date, day] as const)
            )
          )
        )
      )
      .catch(() => {
        if (!controller.signal.aborted)
          setNotice("客戶紀錄暫時無法載入，一般行程仍可使用。")
      })
    return () => controller.abort()
  }, [firstMonth, lastMonth, revision, showLegacy])
  useEffect(() => {
    if (!showLegacy) return
    const controller = new AbortController()
    listCustomers(controller.signal)
      .then(({ customers }) =>
        setCustomers(
          customers
            .filter((c) => c.owner_id === (user?.acting_as?.id ?? user?.id))
            .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
        )
      )
      .catch(() => {})
    return () => controller.abort()
  }, [user?.id, user?.acting_as?.id, showLegacy])
  useEffect(() => {
    if (!requestedEvent) return
    let active = true
    api
      .getEvent(requestedEvent, requestedDate ?? undefined)
      .then((event) => {
        if (active)
          setEditor({ date: requestedDate ?? dateKey(event.starts_at), event })
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [requestedEvent, requestedDate])
  useEffect(() => {
    if (!query.trim()) return
    const controller = new AbortController()
    const timeout = setTimeout(
      () =>
        api
          .searchEvents(query.trim(), controller.signal)
          .then((data) => {
            setSearch({ query: query.trim(), ...data })
            setSearchError("")
          })
          .catch((e) => {
            if (!controller.signal.aborted) setSearchError(message(e))
          }),
      250
    )
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [query, revision])
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") setRevision((v) => v + 1)
    }, 60_000)
    const focus = () => setRevision((v) => v + 1)
    window.addEventListener("focus", focus)
    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", focus)
    }
  }, [])

  const calendars =
    workspace?.calendars.filter((c) => c.status === "accepted") ?? []
  const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id))
  const visibleEvents = (items: api.CalendarEvent[]) =>
    items.filter(
      (e) =>
        (e.calendar_id === "invitations"
          ? showInvitations
          : visible.has(e.calendar_id)) &&
        !e.attendees.some((a) => a.is_me && a.status === "declined")
    )
  const shownEvents = visibleEvents(events)
  const dayEvents = shownEvents.filter((e) => onDay(e, anchor))
  const canCreate = calendars.some((c) => c.can_edit)
  function create(date: string, minutes = 9 * 60) {
    setAnchor(date)
    const begins = new Date(zonedIso(date)).getTime() + minutes * 60000
    setEditor({
      date,
      seed: {
        starts_at: new Date(begins).toISOString(),
        ends_at: new Date(begins + 3600000).toISOString(),
      },
    })
  }
  const open = (event: api.CalendarEvent) => setEditor({ date: anchor, event })
  function navigate(delta: number) {
    setQuery("")
    setAnchor(
      view === "month" || view === "list"
        ? `${shiftMonth(anchor.slice(0, 7), delta)}-01`
        : shiftDay(anchor, delta * (view === "week" ? 7 : 1))
    )
  }
  function changeView(next: CalendarView) {
    setView(next)
    try {
      localStorage.setItem("meddemo:calendar-view", next)
    } catch {
      /* 使用本次選擇。 */
    }
  }
  async function toggleCalendar(calendar: api.CalendarCollection) {
    setWorkspace(
      (data) =>
        data && {
          ...data,
          calendars: data.calendars.map((c) =>
            c.id === calendar.id ? { ...c, visible: !c.visible } : c
          ),
        }
    )
    try {
      await api.setCalendarVisibility(calendar.id, !calendar.visible)
    } catch (e) {
      setError(message(e))
      refresh()
    }
  }
  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      refresh()
    } catch (e) {
      setError(message(e))
    }
  }
  async function applyMove(pending: Move, scope: api.EditScope) {
    setMoving(true)
    setError("")
    let body = pending.body
    if (scope === "all" && pending.event.recurrence) {
      const delta =
        new Date(body.starts_at).getTime() -
        new Date(pending.event.starts_at).getTime()
      const endDelta =
        new Date(body.ends_at).getTime() -
        new Date(pending.event.ends_at).getTime()
      body = {
        ...eventBody(pending.event, pending.event.series),
        starts_at: new Date(
          new Date(pending.event.series.starts_at).getTime() + delta
        ).toISOString(),
        ends_at: new Date(
          new Date(pending.event.series.ends_at).getTime() + endDelta
        ).toISOString(),
      }
    }
    try {
      await api.saveEvent(body, pending.event, scope)
      setMove(null)
      setNotice(pending.resize ? "已更新結束時間" : "行程已改期")
      refresh()
    } catch (e) {
      setError(message(e))
    } finally {
      setMoving(false)
    }
  }
  function drop({ active, over }: DragEndEvent) {
    setDragTitle("")
    const event = active.data.current?.event as api.CalendarEvent | undefined
    const target = over?.data.current as
      { date?: string; minutes?: number } | undefined
    if (!event || !target?.date) return
    const resize = Boolean(active.data.current?.resize)
    let body: api.EventBody
    if (resize) {
      if (target.minutes === undefined) return
      const finish = new Date(
        new Date(zonedIso(target.date)).getTime() +
          (target.minutes + 30) * 60000
      ).toISOString()
      if (new Date(finish) <= new Date(event.starts_at)) {
        setNotice("結束時間須晚於開始時間")
        return
      }
      body = { ...eventBody(event), ends_at: finish }
    } else body = moveEvent(event, target.date, target.minutes)
    if (
      new Date(body.starts_at).getTime() ===
        new Date(event.starts_at).getTime() &&
      new Date(body.ends_at).getTime() === new Date(event.ends_at).getTime()
    )
      return
    const pending = { event, body, resize }
    if (event.recurrence) setMove(pending)
    else void applyMove(pending, "all")
  }
  const legacyDay = showLegacy ? legacy.get(anchor) : undefined
  const invitations = workspace?.invitations ?? []
  const pendingCalendars =
    workspace?.calendars.filter((c) => c.status === "pending") ?? []
  const filters = (
    <CalendarFilters
      calendars={calendars}
      showLegacy={showLegacy}
      showInvitations={showInvitations}
      onToggle={(c) => void toggleCalendar(c)}
      onLegacy={setShowLegacy}
      onInvitations={setShowInvitations}
    />
  )

  return (
    <div className="planner-page flex min-h-svh flex-col">
      <PageHeader
        title="日曆"
        subtitle="安排每一天"
        backTo="/"
        trailing={
          <div className="flex gap-1 pr-2">
            <Button
              variant="ghost"
              aria-label="日曆與設定"
              disabled={!workspace}
              onClick={() => setManager(true)}
            >
              <Settings />
            </Button>
            <Button
              size="sm"
              disabled={!canCreate}
              onClick={() => create(anchor)}
            >
              <Plus />
              新增
            </Button>
          </div>
        }
      />
      <main className="flex min-w-0 flex-1 flex-col gap-4 px-3 py-4 lg:px-6">
        {error && (
          <Notice
            text={error}
            action={{
              label: "重新載入",
              onClick: () => {
                setError("")
                refresh()
              },
            }}
          />
        )}
        {notice && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm"
          >
            <span className="flex-1">{notice}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="關閉提示"
              onClick={() => setNotice("")}
            >
              <X />
            </Button>
          </div>
        )}
        <div className="flex min-w-0 gap-5">
          <aside className="hidden w-48 shrink-0 space-y-5 xl:block">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="size-4" />
              我的日曆
            </div>
            {filters}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!workspace}
              onClick={() => setManager(true)}
            >
              管理與共享
            </Button>
            <p className="text-xs text-muted-foreground">
              拖曳行程旁的把手可改期。日／週檢視可拖曳底部調整結束時間。
            </p>
          </aside>
          <div className="min-w-0 flex-1 space-y-4">
            <div className="planner-toolbar flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="上一段日期"
                  onClick={() => navigate(-1)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="下一段日期"
                  onClick={() => navigate(1)}
                >
                  <ChevronRight />
                </Button>
              </div>
              <h2 className="min-w-0 flex-1 text-lg font-semibold sm:flex-none">
                {view === "day"
                  ? dayTitle(anchor)
                  : monthTitle(anchor.slice(0, 7))}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAnchor(workspace?.today ?? dateKey(new Date()))
                  setQuery("")
                }}
              >
                今天
              </Button>
              <input
                type="date"
                aria-label="跳到日期"
                className="!w-36 text-sm"
                value={anchor}
                onChange={(e) => {
                  if (e.target.value) {
                    setAnchor(e.target.value)
                    setQuery("")
                  }
                }}
              />
              <div
                className="flex rounded-xl bg-muted p-1 sm:ml-auto"
                role="group"
                aria-label="日曆檢視"
              >
                {VIEWS.map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={value === view}
                    className={cn(
                      "min-h-8 rounded-lg px-3 text-sm",
                      view === value && "bg-card font-semibold shadow-sm"
                    )}
                    onClick={() => changeView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="planner-toolbar flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
                <input
                  type="search"
                  aria-label="搜尋行程"
                  placeholder="搜尋標題、地點、附註"
                  className="!pl-9"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setSearchError("")
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="xl:hidden"
                disabled={!workspace}
                onClick={() => setManager(true)}
              >
                日曆設定
              </Button>
            </div>
            <details className="rounded-xl border bg-card p-3 xl:hidden">
              <summary className="cursor-pointer text-sm">
                顯示的日曆（{calendars.filter((c) => c.visible).length}）
              </summary>
              <div className="pt-3">{filters}</div>
            </details>
            {(pendingCalendars.length > 0 || invitations.length > 0) && (
              <section className="space-y-2 rounded-2xl border bg-card p-4">
                <h3 className="text-sm font-semibold">待回覆的邀請</h3>
                {pendingCalendars.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 break-words">
                      共享日曆：{c.name}（
                      {c.role === "editor" ? "可編輯" : "可檢視"}）
                    </span>
                    <Button
                      size="sm"
                      onClick={() =>
                        void run(() => api.respondCalendar(c.id, "accepted"))
                      }
                    >
                      接受
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run(() => api.respondCalendar(c.id, "declined"))
                      }
                    >
                      拒絕
                    </Button>
                  </div>
                ))}
                {invitations.map((event) => (
                  <div
                    key={event.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left text-primary"
                      onClick={() => open(event)}
                    >
                      {event.title}
                    </button>
                    {(["accepted", "tentative", "declined"] as const).map(
                      (status, index) => (
                        <Button
                          key={status}
                          size="sm"
                          variant={index === 0 ? "default" : "ghost"}
                          onClick={() =>
                            void run(() => api.respondEvent(event.id, status))
                          }
                        >
                          {["接受", "暫定", "拒絕"][index]}
                        </Button>
                      )
                    )}
                  </div>
                ))}
              </section>
            )}
            {loading && (
              <p
                role="status"
                className="py-10 text-center text-sm text-muted-foreground"
              >
                正在載入日曆…
              </p>
            )}
            {!loading && (
              <DndContext
                collisionDetection={(args) =>
                  args.pointerCoordinates
                    ? pointerWithin(args)
                    : closestCenter(args)
                }
                sensors={sensors}
                onDragStart={({ active }) =>
                  setDragTitle(
                    (
                      active.data.current?.event as
                        api.CalendarEvent | undefined
                    )?.title ?? ""
                  )
                }
                onDragEnd={drop}
                onDragCancel={() => setDragTitle("")}
              >
                {query.trim() ? (
                  searchError ? (
                    <Notice text={searchError} />
                  ) : search?.query === query.trim() ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {search.truncated
                          ? "顯示前 100 個行程系列"
                          : `${visibleEvents(search.events).length} 個符合的行程`}
                      </p>
                      <CalendarListView
                        days={[]}
                        events={visibleEvents(search.events)}
                        selected={anchor}
                        onOpen={open}
                        onCreate={create}
                        search
                      />
                    </>
                  ) : (
                    <p
                      role="status"
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      搜尋中…
                    </p>
                  )
                ) : view === "month" ? (
                  <CalendarMonthView
                    days={days}
                    events={shownEvents}
                    today={workspace?.today ?? ""}
                    selected={anchor}
                    onSelect={setAnchor}
                    onOpen={open}
                    onCreate={create}
                    legacy={showLegacy ? legacy : new Map()}
                  />
                ) : view === "week" || view === "day" ? (
                  <CalendarTimeView
                    days={days}
                    events={shownEvents}
                    today={workspace?.today ?? ""}
                    selected={anchor}
                    onSelect={setAnchor}
                    onOpen={open}
                    onCreate={create}
                  />
                ) : (
                  <CalendarListView
                    days={days.filter((d) => d.startsWith(anchor.slice(0, 7)))}
                    events={shownEvents}
                    selected={anchor}
                    onOpen={open}
                    onCreate={create}
                  />
                )}
                {!query.trim() && view === "month" && (
                  <section className="mt-4 space-y-3 rounded-2xl border bg-card p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {dayTitle(anchor)}
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canCreate}
                        onClick={() => create(anchor)}
                      >
                        <Plus />
                        新增
                      </Button>
                    </div>
                    {dayEvents.length ? (
                      dayEvents.map((event) => (
                        <EventChip
                          key={eventKey(event)}
                          event={event}
                          onOpen={open}
                        />
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        這天沒有行程，按「新增」安排活動。
                      </p>
                    )}
                  </section>
                )}
                <DragOverlay>
                  {dragTitle && (
                    <div className="max-w-60 rounded-xl border bg-card px-3 py-2 text-sm shadow-lg">
                      {dragTitle}
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
            {showLegacy && !query.trim() && (
              <details className="rounded-2xl border bg-card p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  {dayTitle(anchor)} · 客戶紀錄與備忘（
                  {(legacyDay?.visits.length ?? 0) +
                    (legacyDay?.notes.length ?? 0)}
                  ）
                </summary>
                <div className="mt-3 space-y-3">
                  {legacyDay?.visits.map((v) => (
                    <Link
                      key={v.visit_id}
                      to={`/visits/${v.visit_id}`}
                      className="block text-sm text-primary"
                    >
                      拜訪 · {v.customer_name}
                    </Link>
                  ))}
                  {legacyDay?.notes.map((note) => (
                    <button
                      type="button"
                      key={note.id}
                      className="block w-full border-t py-2 text-left"
                      onClick={() => {
                        const customer = customers.find(
                          (c) => c.id === note.customer_id
                        )
                        if (customer) setWriting({ customer, note })
                      }}
                    >
                      <NoteRow note={note} showCustomer showDate={false} />
                    </button>
                  ))}
                  {!legacyDay && (
                    <p className="text-sm text-muted-foreground">
                      這天沒有客戶紀錄。
                    </p>
                  )}
                  <div className="planner-form flex gap-2 border-t pt-3">
                    <select
                      aria-label="備忘所屬客戶"
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                      className="min-w-0 flex-1"
                    >
                      <option value="">選一家客戶</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!customerId}
                      onClick={() => {
                        const customer = customers.find(
                          (c) => c.id === customerId
                        )
                        if (customer) setWriting({ customer })
                      }}
                    >
                      記備忘
                    </Button>
                  </div>
                </div>
              </details>
            )}
          </div>
        </div>
      </main>
      {editor && (
        <EventDialog
          key={`${editor.event?.id ?? "new"}-${editor.event?.occurrence ?? editor.date}`}
          {...editor}
          emailEnabled={workspace?.email_invites_enabled}
          calendars={calendars}
          onClose={() => setEditor(null)}
          onSaved={refresh}
          onCopy={(event) =>
            setEditor({
              date: dateKey(event.starts_at),
              seed: {
                ...eventBody(event),
                calendar_id: calendars.find(
                  (c) => c.can_edit && c.source === "local"
                )?.id,
                title: `${event.title}（副本）`,
                attendees: [],
              },
            })
          }
        />
      )}
      {manager && workspace && (
        <CalendarManager
          workspace={workspace}
          onClose={() => setManager(false)}
          onChanged={refresh}
        />
      )}
      {writing && (
        <NoteDialog
          open
          customerId={writing.customer.id}
          customerName={writing.customer.name}
          note={writing.note}
          today={workspace?.today ?? dateKey(new Date())}
          defaultDate={anchor}
          onClose={() => setWriting(null)}
          onSaved={refresh}
        />
      )}
      {move && (
        <Dialog open onOpenChange={(open) => !open && !moving && setMove(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {move.resize ? "調整重複行程時間" : "移動重複行程"}
              </DialogTitle>
              <DialogDescription>
                {move.event.title}：要套用到哪些行程？
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              {(["one", "future", "all"] as const).map((scope, index) => (
                <Button
                  key={scope}
                  variant={index === 0 ? "default" : "outline"}
                  disabled={moving}
                  onClick={() => void applyMove(move, scope)}
                >
                  {["只改這一次", "這次及之後", "整個系列"][index]}
                </Button>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function CalendarFilters({
  calendars,
  showLegacy,
  showInvitations,
  onToggle,
  onLegacy,
  onInvitations,
}: {
  calendars: api.CalendarCollection[]
  showLegacy: boolean
  showInvitations: boolean
  onToggle: (c: api.CalendarCollection) => void
  onLegacy: (value: boolean) => void
  onInvitations: (value: boolean) => void
}) {
  return (
    <div className="space-y-3">
      {calendars.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={c.visible}
            onChange={() => onToggle(c)}
          />
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: c.color }}
          />
          <span className="min-w-0 truncate">{c.name}</span>
          {c.role !== "owner" && (
            <span className="text-[10px] text-muted-foreground">共享</span>
          )}
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showInvitations}
          onChange={(e) => onInvitations(e.target.checked)}
        />
        受邀行程
      </label>
      <label className="flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showLegacy}
          onChange={(e) => onLegacy(e.target.checked)}
        />
        拜訪與客戶備忘
      </label>
    </div>
  )
}

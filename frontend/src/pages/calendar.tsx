import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { Link } from "react-router"

import { listCustomers, type Customer } from "@/api/customers"
import { getCalendar, type CalendarDay, type CalendarMonth } from "@/api/notes"
import { NoteDialog } from "@/components/note-dialog"
import { NoteRow } from "@/components/note-row"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { dayTitle, monthGrid, monthTitle, shiftMonth } from "@/lib/calendar"
import { cn } from "@/lib/utils"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; data: CalendarMonth }

const WEEK = ["一", "二", "三", "四", "五", "六", "日"]

/**
 * 日曆（docs/superpowers/specs/2026-10-07-calendar-notes-design.md）：每一天去了哪幾家、要帶什麼、講過什麼。
 * 打開在系統日那個月（展示時固定在決賽日），「今天」也是系統日，跟首頁同一天
 */
export function CalendarPage() {
  const user = useAuth()?.user
  // null：還沒載入過，讓後端用系統日那個月
  const [month, setMonth] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerId, setCustomerId] = useState("")
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getCalendar(month, controller.signal)
      .then((data) => {
        setState({ status: "ready", data })
        // 第一次打開選今天；換月時選那個月的第一天，除非今天就在那個月
        setSelected((current) =>
          current?.startsWith(data.month) ? current : data.today.startsWith(data.month) ? data.today : `${data.month}-01`
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [month, attempt])

  // 「在這天記一筆」選客戶用：只列行程主人自己負責的（代理示範業務的帳號列示範業務的）
  useEffect(() => {
    const controller = new AbortController()
    const owner = user?.acting_as?.id ?? user?.id
    listCustomers(controller.signal)
      .then(({ customers }) =>
        setCustomers(customers.filter((c) => c.owner_id === owner).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")))
      )
      .catch(() => setCustomers([]))
    return () => controller.abort()
  }, [user?.id, user?.acting_as?.id])

  const data = state.status === "ready" ? state.data : null
  const shown = data?.month ?? month
  const byDate = new Map((data?.days ?? []).map((day) => [day.date, day]))
  const day = selected ? byDate.get(selected) : undefined
  const customer = customers.find((c) => c.id === customerId)

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="日曆" backTo="/" />
      <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-10">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="size-11 p-0"
            aria-label="上一個月"
            disabled={!shown}
            onClick={() => shown && setMonth(shiftMonth(shown, -1))}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <p className="text-base font-semibold">{shown ? monthTitle(shown) : "載入中…"}</p>
          <Button
            type="button"
            variant="ghost"
            className="size-11 p-0"
            aria-label="下一個月"
            disabled={!shown}
            onClick={() => shown && setMonth(shiftMonth(shown, 1))}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>

        {state.status === "error" && (
          <Notice
            text="連不上伺服器，日曆沒有載入。"
            action={{ label: "重新載入", onClick: () => setAttempt((n) => n + 1) }}
          />
        )}

        {data && (
          <>
            <MonthGrid data={data} selected={selected} onSelect={setSelected} />
            <Legend />
            {selected && (
              <DayDetail
                date={selected}
                day={day}
                customers={customers}
                customerId={customerId}
                onCustomer={setCustomerId}
                onWrite={() => setWriting(true)}
              />
            )}
          </>
        )}
      </main>
      {data && selected && customer && (
        <NoteDialog
          open={writing}
          onClose={() => setWriting(false)}
          customerId={customer.id}
          customerName={customer.name}
          today={data.today}
          defaultDate={selected}
          onSaved={() => setAttempt((n) => n + 1)}
        />
      )}
    </div>
  )
}

/** 七欄的月曆：每一格日期，下面的小點是那天有拜訪、要帶的、講過的 */
function MonthGrid({
  data,
  selected,
  onSelect,
}: {
  data: CalendarMonth
  selected: string | null
  onSelect: (date: string) => void
}) {
  const byDate = new Map(data.days.map((day) => [day.date, day]))
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
        {WEEK.map((name) => (
          <span key={name} className="py-1">
            {name}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthGrid(data.month).map((date, index) => {
          if (!date) return <span key={`blank-${index}`} />
          const day = byDate.get(date)
          const isToday = date === data.today
          const isSelected = date === selected
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              aria-label={`${dayTitle(date)}${day ? `，${dayCount(day)}` : ""}`}
              className={cn(
                "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-transparent text-sm tabular-nums",
                isSelected ? "bg-primary text-primary-foreground" : "active:bg-muted",
                isToday && !isSelected && "border-primary text-primary"
              )}
            >
              {Number(date.slice(-2))}
              <Dots day={day} inverted={isSelected} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function dayCount(day: CalendarDay) {
  const bring = day.notes.filter((n) => n.kind === "bring").length
  const told = day.notes.length - bring
  return [
    day.visits.length ? `拜訪 ${day.visits.length} 家` : null,
    bring ? `要帶 ${bring} 則` : null,
    told ? `講過 ${told} 則` : null,
  ]
    .filter(Boolean)
    .join("、")
}

function Dots({ day, inverted }: { day?: CalendarDay; inverted: boolean }) {
  const kinds = [
    day?.visits.length ? "visit" : null,
    day?.notes.some((n) => n.kind === "bring") ? "bring" : null,
    day?.notes.some((n) => n.kind === "told") ? "told" : null,
  ].filter(Boolean)
  return (
    <span className="flex h-1.5 gap-0.5" aria-hidden>
      {kinds.map((kind) => (
        <span key={kind} className={cn("size-1.5 rounded-full", DOT_CLASS[kind as DotKind], inverted && "ring-1 ring-primary-foreground")} />
      ))}
    </span>
  )
}

type DotKind = "visit" | "bring" | "told"
const DOT_CLASS: Record<DotKind, string> = {
  visit: "bg-muted-foreground",
  bring: "bg-primary",
  told: "bg-amber-500",
}

function Legend() {
  const items: [DotKind, string][] = [
    ["visit", "拜訪"],
    ["bring", "要帶的"],
    ["told", "講過的"],
  ]
  return (
    <p className="flex justify-center gap-4 text-xs text-muted-foreground">
      {items.map(([kind, label]) => (
        <span key={kind} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-full", DOT_CLASS[kind])} />
          {label}
        </span>
      ))}
    </p>
  )
}

/** 點一天：那天拜訪了哪幾家、放在那天的要帶的與講過的，以及在這天記一筆 */
function DayDetail({
  date,
  day,
  customers,
  customerId,
  onCustomer,
  onWrite,
}: {
  date: string
  day?: CalendarDay
  customers: Customer[]
  customerId: string
  onCustomer: (id: string) => void
  onWrite: () => void
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 bg-card p-4 shadow-lip">
      <p className="text-sm font-semibold">{dayTitle(date)}</p>
      {!day && <p className="text-sm text-muted-foreground">這天沒有拜訪也沒有備忘。</p>}
      {day && day.visits.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">拜訪</p>
          <ul className="flex flex-col">
            {day.visits.map((visit) => (
              <li key={visit.visit_id}>
                <Link to={`/visits/${visit.visit_id}`} className="flex min-h-11 items-center text-sm text-primary">
                  {visit.customer_name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {day && day.notes.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">備忘</p>
          <ul className="flex flex-col">
            {day.notes.map((note) => (
              <li key={note.id} className="border-t first:border-t-0">
                <Link to={`/customers/${note.customer_id}`} className="flex min-h-11 items-center py-2 active:bg-muted">
                  <NoteRow note={note} showCustomer showDate={false} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2 border-t pt-3">
        <select
          value={customerId}
          onChange={(e) => onCustomer(e.target.value)}
          aria-label="記在哪一家"
          className="h-11 min-w-0 flex-1 rounded-xl border-2 border-input bg-card px-3 text-sm shadow-lip"
        >
          <option value="">選一家客戶</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="button" className="h-11 shrink-0 gap-1" disabled={!customerId} onClick={onWrite}>
          <Plus className="size-4" />
          在這天記一筆
        </Button>
      </div>
    </section>
  )
}

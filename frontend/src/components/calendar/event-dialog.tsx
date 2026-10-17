import { useState } from "react"
import { Copy, Download, MapPin, Repeat2, Trash2 } from "@/components/icons"
import {
  deleteEvent,
  downloadCalendarFile,
  exportInvitation,
  respondEvent,
  saveEvent,
  sendEventInvitations,
  type CalendarCollection,
  type CalendarEvent,
  type EditScope,
  type EventBody,
} from "@/api/planner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DISPLAY_ZONE,
  RSVP_LABEL,
  dateKey,
  eventBody,
  localInput,
  message,
  shiftDay,
  timeLabel,
  zonedIso,
} from "@/lib/planner"

type Props = {
  event?: CalendarEvent
  seed?: Partial<EventBody>
  date: string
  calendars: CalendarCollection[]
  emailEnabled?: boolean
  onClose: () => void
  onSaved: () => void
  onCopy: (event: CalendarEvent) => void
}

export function EventDialog(props: Props) {
  const readOnly = props.event && !props.event.can_edit
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="planner-dialog max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? "行程詳情" : props.event ? "編輯行程" : "新增行程"}
          </DialogTitle>
          <DialogDescription>
            {props.event?.calendar_name ??
              "安排時間、設定重複與提醒，也能邀請其他人。"}
          </DialogDescription>
        </DialogHeader>
        {readOnly ? (
          <EventDetails {...props} event={props.event!} />
        ) : (
          <EventForm {...props} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EventDetails({
  event,
  onSaved,
  onCopy,
}: Props & { event: CalendarEvent }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const me = event.attendees.find((a) => a.is_me)
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError("")
    try {
      await action()
      onSaved()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="planner-form space-y-4">
      <h2 className="text-xl font-semibold break-words">{event.title}</h2>
      <p>
        {dateKey(event.starts_at, event.timezone)}{" "}
        {event.all_day ? "全天" : timeLabel(event.starts_at, event.timezone)} ～{" "}
        {event.all_day
          ? shiftDay(dateKey(event.ends_at, event.timezone), -1)
          : dateKey(event.ends_at, event.timezone)}{" "}
        {!event.all_day && timeLabel(event.ends_at, event.timezone)}
      </p>
      <p className="text-xs text-muted-foreground">
        {event.timezone}
        {event.recurrence && " · 重複行程"}
      </p>
      {event.location && (
        <p className="flex gap-2">
          <MapPin className="mt-1 size-4 shrink-0" />
          {event.location}
        </p>
      )}
      {event.description && (
        <p className="break-words whitespace-pre-wrap">{event.description}</p>
      )}
      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer"
          className="break-all text-primary underline"
        >
          開啟行程連結
        </a>
      )}
      {me && event.source !== "ics" && (
        <div className="rounded-xl bg-muted p-3">
          <p className="mb-2 text-sm">你的回覆：{RSVP_LABEL[me.status]}</p>
          <div className="flex flex-wrap gap-2">
            {(["accepted", "tentative", "declined"] as const).map((status) => (
              <Button
                key={status}
                size="sm"
                variant={me.status === status ? "default" : "outline"}
                disabled={busy}
                onClick={() => void run(() => respondEvent(event.id, status))}
              >
                {RSVP_LABEL[status]}
              </Button>
            ))}
          </div>
        </div>
      )}
      <AttendeeList event={event} />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onCopy(event)}>
          <Copy />
          複製行程
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () =>
              downloadCalendarFile(
                await exportInvitation(event.id),
                "invitation.ics"
              )
            )
          }
        >
          <Download />
          下載邀請
        </Button>
      </div>
    </div>
  )
}

function EventForm({
  event,
  seed,
  date,
  calendars,
  emailEnabled,
  onClose,
  onSaved,
  onCopy,
}: Props) {
  const initial = { ...(event ? eventBody(event) : {}), ...seed }
  const [scope, setScope] = useState<EditScope>(
    event?.recurrence ? "one" : "all"
  )
  const [title, setTitle] = useState(initial.title ?? "")
  const [calendarId, setCalendarId] = useState(
    initial.calendar_id ?? calendars.find((c) => c.can_edit)?.id ?? ""
  )
  const [zone, setZone] = useState(initial.timezone ?? DISPLAY_ZONE)
  const [allDay, setAllDay] = useState(initial.all_day ?? false)
  const [start, setStart] = useState(
    initial.starts_at
      ? localInput(initial.starts_at, initial.timezone)
      : `${date}T09:00`
  )
  const [end, setEnd] = useState(
    initial.ends_at
      ? localInput(initial.ends_at, initial.timezone)
      : `${date}T10:00`
  )
  const [location, setLocation] = useState(initial.location ?? "")
  const [description, setDescription] = useState(initial.description ?? "")
  const [url, setUrl] = useState(initial.url ?? "")
  const [recurrence, setRecurrence] = useState(initial.recurrence ?? null)
  const [reminders, setReminders] = useState(initial.reminders ?? [15])
  const [attendees, setAttendees] = useState(
    initial.attendees?.join(", ") ?? ""
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [delivery, setDelivery] = useState("")
  const dirty =
    event &&
    (title !== event.title ||
      calendarId !== event.calendar_id ||
      zone !== event.timezone ||
      allDay !== event.all_day ||
      start !== localInput(event.starts_at, event.timezone) ||
      end !== localInput(event.ends_at, event.timezone) ||
      location !== event.location ||
      description !== event.description ||
      url !== event.url ||
      recurrence !== event.recurrence ||
      JSON.stringify(reminders) !== JSON.stringify(event.reminders) ||
      attendees !== event.attendees.map((a) => a.email).join(", "))
  const editSeries = scope !== "one" || !event?.recurrence
  const timezones = Array.from(
    new Set([
      zone,
      DISPLAY_ZONE,
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Asia/Hong_Kong",
      "Asia/Singapore",
      "Europe/London",
      "Europe/Paris",
      "America/New_York",
      "America/Los_Angeles",
      "UTC",
    ])
  )

  function changeScope(value: EditScope) {
    setScope(value)
    setConfirmDelete(false)
    if (!event) return
    const data = value === "all" ? event.series : event
    setTitle(data.title)
    setStart(localInput(data.starts_at, data.timezone))
    setEnd(localInput(data.ends_at, data.timezone))
    setZone(data.timezone)
    setAllDay(data.all_day)
    setLocation(data.location)
    setDescription(data.description)
    setUrl(data.url)
    setRecurrence(data.recurrence)
    setReminders(data.reminders)
  }
  async function run(action: () => Promise<unknown>, close = true) {
    setBusy(true)
    setError("")
    try {
      await action()
      if (close) {
        onSaved()
        onClose()
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  function submit(e: React.FormEvent) {
    e.preventDefault()
    void run(async () => {
      await saveEvent(
        {
          calendar_id: calendarId,
          title,
          starts_at: zonedIso(allDay ? start.slice(0, 10) : start, zone),
          ends_at: zonedIso(allDay ? end.slice(0, 10) : end, zone),
          timezone: zone,
          all_day: allDay,
          location,
          description,
          url,
          recurrence,
          reminders,
          attendees: attendees
            .split(/[,;\n，；]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
        event,
        scope
      )
    })
  }
  function toggleAllDay(checked: boolean) {
    setAllDay(checked)
    if (checked) {
      setStart(`${start.slice(0, 10)}T00:00`)
      setEnd(
        `${shiftDay(end.slice(0, 10) >= start.slice(0, 10) ? end.slice(0, 10) : start.slice(0, 10), 1)}T00:00`
      )
    } else {
      setStart(`${start.slice(0, 10)}T09:00`)
      setEnd(`${start.slice(0, 10)}T10:00`)
    }
  }
  return (
    <form onSubmit={submit} className="planner-form space-y-4">
      {event?.series.recurrence && (
        <label className="planner-field">
          套用範圍
          <select
            value={scope}
            onChange={(e) => changeScope(e.target.value as EditScope)}
          >
            <option value="one">只改這一次</option>
            <option value="future">這次及之後</option>
            <option value="all">整個系列</option>
          </select>
        </label>
      )}
      <label className="planner-field">
        標題
        <input
          autoFocus
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="新增活動、會議或約會"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="planner-field">
          日曆
          <select
            value={calendarId}
            disabled={Boolean(event?.recurrence && scope !== "all")}
            onChange={(e) => setCalendarId(e.target.value)}
            required
          >
            {calendars
              .filter((c) => c.can_edit)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="planner-field">
          時區
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            {timezones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => toggleAllDay(e.target.checked)}
        />
        全天活動
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="planner-field">
          開始{allDay ? "日期" : "時間"}
          <input
            required
            type={allDay ? "date" : "datetime-local"}
            value={allDay ? start.slice(0, 10) : start}
            onChange={(e) => {
              if (!e.target.value) {
                setStart("")
                return
              }
              const next = allDay ? `${e.target.value}T00:00` : e.target.value
              setStart(next)
              if (next >= end)
                setEnd(
                  allDay
                    ? `${shiftDay(e.target.value, 1)}T00:00`
                    : new Date(Date.parse(`${next}:00Z`) + 3600000)
                        .toISOString()
                        .slice(0, 16)
                )
            }}
          />
        </label>
        <label className="planner-field">
          {allDay ? "最後一天（含當天）" : "結束時間"}
          <input
            required
            type={allDay ? "date" : "datetime-local"}
            value={allDay ? (end ? shiftDay(end.slice(0, 10), -1) : "") : end}
            onChange={(e) =>
              setEnd(
                allDay && e.target.value
                  ? `${shiftDay(e.target.value, 1)}T00:00`
                  : e.target.value
              )
            }
          />
        </label>
      </div>
      <label className="planner-field">
        地點
        <input
          value={location}
          maxLength={1000}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="加入地點或地址"
        />
      </label>
      {editSeries && (
        <RecurrenceEditor
          key={`${scope}-${event?.id ?? "new"}`}
          value={recurrence}
          zone={zone}
          onChange={setRecurrence}
        />
      )}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">提醒</legend>
        {reminders.map((minutes, index) => (
          <div key={index} className="flex gap-2">
            <select
              aria-label={`第 ${index + 1} 次提醒`}
              value={minutes}
              onChange={(e) =>
                setReminders(
                  reminders.map((v, i) =>
                    i === index ? Number(e.target.value) : v
                  )
                )
              }
              className="min-w-0 flex-1"
            >
              {Array.from(
                new Set([
                  0,
                  5,
                  10,
                  15,
                  30,
                  60,
                  120,
                  1440,
                  2880,
                  10080,
                  20160,
                  minutes,
                ])
              )
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {reminderLabel(m)}
                  </option>
                ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              aria-label={`移除第 ${index + 1} 次提醒`}
              onClick={() =>
                setReminders(reminders.filter((_, i) => i !== index))
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {reminders.length < 5 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setReminders([...reminders, 30])}
          >
            新增提醒
          </Button>
        )}
      </fieldset>
      <label className="planner-field">
        邀請對象
        <textarea
          rows={2}
          value={attendees}
          disabled={!editSeries}
          onChange={(e) => setAttendees(e.target.value)}
          placeholder="輸入 Email，多位以逗號分隔"
        />
        <span className="text-xs font-normal text-muted-foreground">
          站內帳號會收到邀請；外部對象可用「下載邀請」取得邀請檔後傳送。
        </span>
      </label>
      {event && <AttendeeList event={event} />}
      {event && emailEnabled && event.attendees.length > 0 && (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || Boolean(dirty)}
            onClick={() =>
              void run(async () => {
                const result = await sendEventInvitations(
                  event.id,
                  event.sequence
                )
                setDelivery(
                  `已寄出 ${result.sent.length} 封邀請${result.failed.length ? `；${result.failed.join("、")} 傳送失敗` : ""}`
                )
              }, false)
            }
          >
            {event.recurrence ? "傳送整個系列的 Email 邀請" : "傳送 Email 邀請"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {dirty
              ? "先儲存變更，再開啟行程傳送邀請。"
              : "將寄送目前已儲存的行程，受邀者可直接透過郵件回覆。"}
          </p>
          {delivery && (
            <p role="status" className="text-sm">
              {delivery}
            </p>
          )}
        </div>
      )}
      <label className="planner-field">
        連結
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="視訊會議或其他網址"
          maxLength={2000}
        />
      </label>
      <label className="planner-field">
        附註
        <textarea
          rows={3}
          value={description}
          maxLength={10000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="補充行程內容"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {confirmDelete && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
          <p className="mb-2 text-sm">
            確定刪除
            {scope === "one"
              ? "這一次行程"
              : scope === "future"
                ? "這次及之後的行程"
                : "整個行程系列"}
            ？
          </p>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => event && void run(() => deleteEvent(event, scope))}
          >
            確認刪除
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <div className="flex gap-1">
          {event && (
            <>
              <Button
                type="button"
                variant="ghost"
                aria-label="刪除行程"
                disabled={busy}
                onClick={() => setConfirmDelete(!confirmDelete)}
              >
                <Trash2 />
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-label="複製行程"
                disabled={busy}
                onClick={() => onCopy(event)}
              >
                <Copy />
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-label="下載邀請"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () =>
                      downloadCalendarFile(
                        await exportInvitation(event.id),
                        "invitation.ics"
                      ),
                    false
                  )
                }
              >
                <Download />
              </Button>
            </>
          )}
        </div>
        <Button type="submit" disabled={busy || !calendarId || !title.trim()}>
          {busy ? "處理中…" : "儲存行程"}
        </Button>
      </div>
    </form>
  )
}

function RecurrenceEditor({
  value,
  zone,
  onChange,
}: {
  value: string | null
  zone: string
  onChange: (rule: string | null) => void
}) {
  const parts = Object.fromEntries(
    (value ?? "")
      .split(";")
      .filter(Boolean)
      .map((p) => p.split("="))
  )
  const [frequency, setFrequency] = useState(parts.FREQ ?? "")
  const [interval, setIntervalValue] = useState(Number(parts.INTERVAL ?? 1))
  const [weekdays, setWeekdays] = useState<string[]>(
    (parts.BYDAY ?? "").split(",").filter(Boolean)
  )
  const [ending, setEnding] = useState(
    parts.UNTIL ? "until" : parts.COUNT ? "count" : "never"
  )
  const [until, setUntil] = useState(
    parts.UNTIL
      ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`
      : ""
  )
  const [count, setCount] = useState(Number(parts.COUNT ?? 10))
  const [validation, setValidation] = useState("")
  function update(next: {
    frequency?: string
    interval?: number
    weekdays?: string[]
    ending?: string
    until?: string
    count?: number
  }) {
    const state = {
      frequency,
      interval,
      weekdays,
      ending,
      until,
      count,
      ...next,
    }
    setValidation("")
    if (!state.frequency) {
      onChange(null)
      return
    }
    const rule = [
      `FREQ=${state.frequency}`,
      `INTERVAL=${Math.max(1, state.interval)}`,
    ]
    if (state.frequency === "WEEKLY" && state.weekdays.length)
      rule.push(`BYDAY=${state.weekdays.join(",")}`)
    if (state.ending === "count") rule.push(`COUNT=${Math.max(1, state.count)}`)
    if (state.ending === "until" && state.until) {
      try {
        rule.push(
          `UNTIL=${zonedIso(`${state.until}T23:59`, zone)
            .replace(/[-:]/g, "")
            .replace(/\.\d{3}Z$/, "Z")}`
        )
      } catch (e) {
        setValidation(message(e))
        return
      }
    }
    onChange(rule.join(";"))
  }
  return (
    <fieldset className="space-y-3 rounded-xl border p-3">
      <legend className="flex items-center gap-1 px-1 text-sm font-medium">
        <Repeat2 className="size-4" />
        重複
      </legend>
      <select
        aria-label="重複頻率"
        value={frequency}
        onChange={(e) => {
          setFrequency(e.target.value)
          update({ frequency: e.target.value })
        }}
      >
        <option value="">不重複</option>
        <option value="DAILY">每天</option>
        <option value="WEEKLY">每週</option>
        <option value="MONTHLY">每月同一天</option>
        <option value="YEARLY">每年同一天</option>
      </select>
      {frequency && (
        <>
          <label className="flex items-center gap-2 text-sm">
            每
            <input
              aria-label="重複間隔"
              type="number"
              min={1}
              max={999}
              value={interval}
              onChange={(e) => {
                const v = Number(e.target.value)
                setIntervalValue(v)
                update({ interval: v })
              }}
              className="!w-20"
            />
            {
              (
                {
                  DAILY: "天",
                  WEEKLY: "週",
                  MONTHLY: "個月",
                  YEARLY: "年",
                } as Record<string, string>
              )[frequency]
            }
          </label>
          {frequency === "WEEKLY" && (
            <div className="flex flex-wrap gap-1">
              {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((day, index) => (
                <Button
                  key={day}
                  type="button"
                  size="sm"
                  aria-pressed={weekdays.includes(day)}
                  variant={weekdays.includes(day) ? "default" : "outline"}
                  onClick={() => {
                    const v = weekdays.includes(day)
                      ? weekdays.filter((d) => d !== day)
                      : [...weekdays, day]
                    setWeekdays(v)
                    update({ weekdays: v })
                  }}
                >
                  {"一二三四五六日"[index]}
                </Button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="重複結束方式"
              value={ending}
              onChange={(e) => {
                setEnding(e.target.value)
                update({ ending: e.target.value })
              }}
            >
              <option value="never">永不結束</option>
              <option value="until">於日期結束</option>
              <option value="count">重複指定次數</option>
            </select>
            {ending === "until" && (
              <input
                aria-label="重複結束日期"
                type="date"
                required
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value)
                  update({ until: e.target.value })
                }}
              />
            )}
            {ending === "count" && (
              <input
                aria-label="重複次數"
                type="number"
                min={1}
                max={10000}
                value={count}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setCount(v)
                  update({ count: v })
                }}
              />
            )}
          </div>
        </>
      )}
      {validation && (
        <p role="alert" className="text-destructive">
          {validation}
        </p>
      )}
    </fieldset>
  )
}

function AttendeeList({ event }: { event: CalendarEvent }) {
  return (
    event.attendees.length > 0 && (
      <ul className="space-y-1 text-xs text-muted-foreground">
        {event.attendees.map((a) => (
          <li key={a.email} className="flex flex-wrap justify-between gap-2">
            <span className="break-all">{a.email}</span>
            <span>{RSVP_LABEL[a.status]}</span>
          </li>
        ))}
      </ul>
    )
  )
}
function reminderLabel(minutes: number) {
  return minutes === 0
    ? "行程開始時"
    : minutes < 60
      ? `${minutes} 分鐘前`
      : minutes < 1440
        ? `${minutes / 60} 小時前`
        : `${minutes / 1440} 天前`
}

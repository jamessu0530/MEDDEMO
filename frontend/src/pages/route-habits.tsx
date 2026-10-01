import { useEffect, useState, type ReactNode } from "react"
import { Ellipsis, Plus, Trash2 } from "lucide-react"
import { useLocation } from "react-router"

import { ApiError } from "@/api/client"
import type { HabitDraft, HabitKind, HabitTarget, WindowKind } from "@/api/route"
import { createHabit, deleteHabit, listHabits, setHabitActive, type HabitList, type HabitOption, type RouteHabit } from "@/api/route-habits"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Switch } from "@/components/route/switch"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { WEEKDAY_LABEL } from "@/lib/itinerary"
import { cn } from "@/lib/utils"

const SOURCE_LABEL: Record<RouteHabit["source"], string> = {
  ai: "在首頁跟熊熊滾說的",
  prompt: "拖完答應的",
  manual: "自己新增的",
}
// 新增或改了習慣不回頭改今天已存的行程
const APPLY_HINT = "今天的行程要套用的話，回去按『幫我排順一點』"

/**
 * 我的排序習慣（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈我的排序習慣〉）：
 * 從調整行程的頁首與帳號設定進來。分「今天（星期三）套用中」與「其他日子」兩組，每條可以停用、刪除；
 * 最下面自己新增一條。
 */
export function RouteHabitsPage() {
  const location = useLocation()
  const back = (location.state as { from?: string } | null)?.from ?? "/settings"
  const [data, setData] = useState<HabitList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<RouteHabit | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listHabits(controller.signal)
      .then((found) => {
        setData(found)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof ApiError ? reason.message : "連不上伺服器，排序習慣沒有載入。")
      })
    return () => controller.abort()
  }, [attempt])

  function replace(habit: RouteHabit) {
    setData((found) => found && { ...found, habits: found.habits.map((h) => (h.id === habit.id ? habit : h)) })
  }

  async function toggle(habit: RouteHabit, active: boolean) {
    try {
      replace(await setHabitActive(habit.id, active))
      setHint(APPLY_HINT)
    } catch (reason) {
      setHint(reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有改到。")
    }
  }

  async function remove(habit: RouteHabit) {
    try {
      await deleteHabit(habit.id)
      setData((found) => found && { ...found, habits: found.habits.filter((h) => h.id !== habit.id) })
      setHint(APPLY_HINT)
    } catch (reason) {
      setHint(reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有刪掉。")
    } finally {
      setDeleting(null)
    }
  }

  async function add(habit: HabitDraft) {
    const made = await createHabit(habit)
    setData((found) => found && { ...found, habits: [...found.habits, made] })
    setHint(APPLY_HINT)
  }

  const today = data ? data.habits.filter((h) => h.weekday === null || h.weekday === data.weekday) : []
  const others = data ? data.habits.filter((h) => h.weekday !== null && h.weekday !== data.weekday) : []

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="我的排序習慣" backTo={back} />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-10">
        {error && (
          <Notice text={error} action={{ label: "重新載入", onClick: () => setAttempt((n) => n + 1) }} />
        )}
        {!data && !error && (
          <div className="flex flex-col items-center gap-2 py-10">
            <Mascot state="wait" size={96} />
            <p className="text-sm text-muted-foreground">載入排序習慣…</p>
          </div>
        )}
        {hint && <p className="rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">{hint}</p>}
        {data && (
          <>
            <Group title={`今天（星期${WEEKDAY_LABEL[data.weekday]}）套用中`} empty="今天沒有要套用的習慣。">
              {today.map((habit) => (
                <HabitRow key={habit.id} habit={habit} onToggle={(active) => void toggle(habit, active)} onDelete={() => setDeleting(habit)} />
              ))}
            </Group>
            <Group title="其他日子" empty="沒有只在其他日子套用的習慣。">
              {others.map((habit) => (
                <HabitRow key={habit.id} habit={habit} onToggle={(active) => void toggle(habit, active)} onDelete={() => setDeleting(habit)} />
              ))}
            </Group>
            <HabitForm targets={data.targets} onCreate={add} />
          </>
        )}
      </main>

      {deleting && (
        <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>刪除這條習慣？</DialogTitle>
              <DialogDescription>「{deleting.text}」刪掉之後不能復原；只想暫時不用的話，關掉開關就好。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="h-11" onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button variant="destructive" className="h-11" onClick={() => void remove(deleting)}>
                刪除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function Group({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children.length > 0 ? (
        <ul className="flex flex-col gap-2">{children}</ul>
      ) : (
        <p className="rounded-xl bg-muted px-3 py-3 text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}

function HabitRow({ habit, onToggle, onDelete }: { habit: RouteHabit; onToggle: (active: boolean) => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false)
  const when = habit.weekday === null ? "每天" : `每個星期${WEEKDAY_LABEL[habit.weekday]}`
  return (
    <li className="relative rounded-2xl border-2 bg-card py-3 pr-1.5 pl-4 shadow-lip">
      <div className="flex items-start gap-1">
        <p className={cn("min-w-0 flex-1 pt-2 text-base leading-snug font-semibold", !habit.active && "text-muted-foreground")}>
          {habit.text}
        </p>
        <button
          type="button"
          aria-label="更多"
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <Ellipsis className="size-5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {when} · {SOURCE_LABEL[habit.source]}
          </p>
          {habit.today === "skipped" && habit.skip_reason && (
            <p className="mt-0.5 text-xs text-muted-foreground">今天沒套用：{habit.skip_reason}</p>
          )}
        </div>
        <Switch label={`啟用「${habit.text}」`} checked={habit.active} onChange={onToggle} />
      </div>
      {menu && (
        <div className="absolute top-12 right-2 z-10 rounded-xl border-2 bg-card p-1 shadow-lip">
          <button
            type="button"
            onClick={() => {
              setMenu(false)
              onDelete()
            }}
            className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm text-destructive hover:bg-muted"
          >
            <Trash2 className="size-4" />
            刪除
          </button>
        </div>
      )}
    </li>
  )
}

const KINDS: [HabitKind, string][] = [
  ["precedence", "先後（誰排在誰前面）"],
  ["first", "先跑"],
  ["last", "排最後"],
  ["window", "約的時間"],
  ["duration", "停留多久"],
]
const BYS: [HabitTarget["by"], string][] = [
  ["customer", "客戶"],
  ["chain", "連鎖體系"],
  ["type", "客戶類型"],
  ["area", "地區"],
]
const WINDOW_KINDS: [WindowKind, string][] = [
  ["at", "幾點到"],
  ["before", "以前"],
  ["after", "以後"],
]

const MIN_DURATION = 5
const MAX_DURATION = 480
const DURATION_HINT = `停留要在 ${MIN_DURATION}～${MAX_DURATION} 分`

function sameTarget(a: HabitTarget, b: HabitTarget): boolean {
  return a.by === b.by && a.value === b.value
}

function HabitForm({ targets, onCreate }: { targets: Record<HabitTarget["by"], HabitOption[]>; onCreate: (habit: HabitDraft) => Promise<void> }) {
  const first = (by: HabitTarget["by"]) => targets[by][0]?.value ?? ""
  const defaults = {
    kind: "first" as HabitKind,
    subject: { by: "customer", value: first("customer") } as HabitTarget,
    object: { by: "type", value: first("type") } as HabitTarget,
    weekday: "",
    windowKind: "before" as WindowKind,
    time: "11:00",
    minutes: "60",
  }
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<HabitKind>(defaults.kind)
  const [subject, setSubject] = useState<HabitTarget>(defaults.subject)
  const [object, setObject] = useState<HabitTarget>(defaults.object)
  const [weekday, setWeekday] = useState(defaults.weekday)
  const [windowKind, setWindowKind] = useState<WindowKind>(defaults.windowKind)
  const [time, setTime] = useState(defaults.time)
  const [minutes, setMinutes] = useState(defaults.minutes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button variant="outline" className="h-12 w-full text-sm" onClick={() => setOpen(true)}>
        <Plus />
        新增一條習慣
      </Button>
    )
  }

  const minutesNum = Number(minutes)
  const durationValid = kind !== "duration" || (minutes !== "" && Number.isInteger(minutesNum) && minutesNum >= MIN_DURATION && minutesNum <= MAX_DURATION)
  const windowValid = kind !== "window" || time !== ""
  const samePrecedenceTarget = kind === "precedence" && sameTarget(subject, object)
  const targetsValid = subject.value !== "" && (kind !== "precedence" || object.value !== "")
  const valid = targetsValid && durationValid && windowValid && !samePrecedenceTarget

  function reset() {
    setKind(defaults.kind)
    setSubject(defaults.subject)
    setObject(defaults.object)
    setWeekday(defaults.weekday)
    setWindowKind(defaults.windowKind)
    setTime(defaults.time)
    setMinutes(defaults.minutes)
  }

  async function submit() {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        kind,
        subject,
        object: kind === "precedence" ? object : null,
        window_kind: kind === "window" ? windowKind : null,
        window_time: kind === "window" ? time : null,
        duration_minutes: kind === "duration" ? Number(minutes) : null,
        weekday: weekday === "" ? null : Number(weekday),
      })
      setOpen(false)
      reset()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有新增。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 bg-card p-4 shadow-lip">
      <h2 className="text-sm font-semibold">新增一條習慣</h2>
      <Field label="種類">
        <NativeSelect value={kind} onChange={(event) => setKind(event.target.value as HabitKind)}>
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <TargetPicker label={kind === "precedence" ? "誰排前面" : "對象"} target={subject} targets={targets} onChange={setSubject} />
      {kind === "precedence" && <TargetPicker label="排在誰前面" target={object} targets={targets} onChange={setObject} />}
      {samePrecedenceTarget && <p className="text-xs text-destructive">前後不能是同一個對象</p>}
      {kind === "window" && (
        <Field label="約的時間">
          <div className="flex gap-2">
            <NativeSelect value={windowKind} onChange={(event) => setWindowKind(event.target.value as WindowKind)} className="flex-1">
              {WINDOW_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="h-11 w-32" aria-label="幾點" />
          </div>
        </Field>
      )}
      {kind === "duration" && (
        <Field label="停留幾分鐘">
          <Input inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ""))} className="h-11" />
        </Field>
      )}
      {kind === "duration" && !durationValid && <p className="text-xs text-destructive">{DURATION_HINT}</p>}
      <Field label="星期幾">
        <NativeSelect value={weekday} onChange={(event) => setWeekday(event.target.value)}>
          <option value="">每天</option>
          {[...WEEKDAY_LABEL].map((day, index) => (
            <option key={day} value={index}>
              星期{day}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => setOpen(false)}>
          取消
        </Button>
        <Button className="h-11 flex-1" disabled={busy || !valid} onClick={() => void submit()}>
          新增
        </Button>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

function TargetPicker({
  label,
  target,
  targets,
  onChange,
}: {
  label: string
  target: HabitTarget
  targets: Record<HabitTarget["by"], HabitOption[]>
  onChange: (target: HabitTarget) => void
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <NativeSelect
          aria-label={`${label}：哪一種對象`}
          value={target.by}
          onChange={(event) => {
            const by = event.target.value as HabitTarget["by"]
            onChange({ by, value: targets[by][0]?.value ?? "" })
          }}
          className="w-28 shrink-0"
        >
          {BYS.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={label} value={target.value} onChange={(event) => onChange({ ...target, value: event.target.value })}>
          {targets[target.by].map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </Field>
  )
}

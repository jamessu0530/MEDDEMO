import type {
  DraftStop,
  HabitDraft,
  HabitKind,
  Precedence,
  RouteDraft,
  RouteRule,
  RouteStop,
  TodayRoute,
  WindowKind,
} from "@/api/route"

/**
 * 調整行程的純函式（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈調整行程（清單）〉）：
 * 草稿、換位置、拖完或改完要不要記成習慣的那一句、這個順序違反哪幾條規則、復原回到哪一份。
 */

/** 星期幾的寫法，0 是星期一（跟後端 date.weekday() 一樣） */
export const WEEKDAY_LABEL = "一二三四五六日"

export const WINDOW_WORD: Record<WindowKind, string> = { at: "到", before: "以前", after: "以後" }

/** 2026-10-28 → 2（星期三）。用當地時間的午夜算，免得時區把日期推到前一天 */
export function weekdayOf(iso: string) {
  return (new Date(`${iso}T00:00:00`).getDay() + 6) % 7
}

/** 還沒跑的站 */
export function openStops(route: TodayRoute) {
  return route.stops.filter((stop) => stop.status !== "done")
}

export function toDraftStop(stop: RouteStop): DraftStop {
  return {
    customer_id: stop.customer_id,
    duration_minutes: stop.duration_minutes,
    window_kind: stop.window_kind,
    window_time: stop.window_time,
    note: stop.note,
    locked: stop.locked,
  }
}

/** 存著的行程換成調整清單的草稿：還沒跑的站照目前的順序，先後與今天不套用的習慣照舊 */
export function draftFrom(route: TodayRoute): RouteDraft {
  return {
    stops: openStops(route).map(toDraftStop),
    precedences: route.precedences.map((p) => ({ ...p })),
    skipped_habit_ids: route.skipped_habits.map((habit) => habit.id),
    habits: [],
  }
}

/** 第 from 個移到第 to 個 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** 拿掉一站，跟它有關的先後一起拿掉（後端存檔時也一樣） */
export function withoutStop(draft: RouteDraft, customerId: string): RouteDraft {
  return {
    ...draft,
    stops: draft.stops.filter((stop) => stop.customer_id !== customerId),
    precedences: draft.precedences.filter((p) => p.before !== customerId && p.after !== customerId),
  }
}

export function samePrecedence(a: Precedence, b: Precedence) {
  return a.before === b.before && a.after === b.after
}

/** 要不要記成習慣的那一句，和答應了要記的習慣（星期幾由呼叫端照業務選的填） */
export type HabitSuggestion = { text: string; habit: HabitDraft }

function habitFor(kind: HabitKind, customerId: string, extra: Partial<HabitDraft> = {}): HabitDraft {
  return {
    kind,
    subject: { by: "customer", value: customerId },
    object: null,
    window_kind: null,
    window_time: null,
    duration_minutes: null,
    weekday: null,
    ...extra,
  }
}

/**
 * 拖完（或上移、下移）之後問的那一句。order 是拖之前的順序：
 * 往上拖過 Y（新位置的下一站是 Y）是「X 排在 Y 前面」；往下拖過 Y（新位置的上一站是 Y）是「Y 排在 X 前面」
 */
export function dragHabit(order: string[], from: number, to: number, names: Record<string, string>): HabitSuggestion | null {
  if (from === to) return null
  const moved = order[from]
  const after = moveItem(order, from, to)
  const [first, then] = to < from ? [moved, after[to + 1]] : [after[to - 1], moved]
  if (!first || !then) return null
  return {
    text: `${names[first]} 排在 ${names[then]} 前面`,
    habit: habitFor("precedence", first, { object: { by: "customer", value: then } }),
  }
}

/** 改停留之後問的那一句：「以後去 X 都停 N 分」 */
export function durationHabit(customerId: string, name: string, minutes: number): HabitSuggestion {
  return { text: `以後去 ${name} 都停 ${minutes} 分`, habit: habitFor("duration", customerId, { duration_minutes: minutes }) }
}

/** 改約的時間之後問的那一句：「以後 X 都約 11:00 以前」 */
export function windowHabit(customerId: string, name: string, kind: WindowKind, time: string): HabitSuggestion {
  return {
    text: `以後 ${name} 都約 ${time} ${WINDOW_WORD[kind]}`,
    habit: habitFor("window", customerId, { window_kind: kind, window_time: time }),
  }
}

/** 約的時間的小標籤：「約 10:30 到」「11:00 以前」「14:00 以後」 */
export function windowLabel(kind: WindowKind, time: string) {
  return kind === "at" ? `約 ${time} 到` : `${time} ${WINDOW_WORD[kind]}`
}

/** 75 → 「1 小時 15 分」；120 → 「2 小時」；50 → 「50 分」 */
export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} 分`
  return rest ? `${hours} 小時 ${rest} 分` : `${hours} 小時`
}

/** 草稿要守的規則：今天的先後照草稿現算（剛加、剛拿掉的馬上算數），習慣用最近一次 preview 回來的 */
export function draftRules(draft: RouteDraft, fromServer: RouteRule[], names: Record<string, string>): RouteRule[] {
  const today: RouteRule[] = draft.precedences.map((p) => ({
    id: `today:${p.before}>${p.after}`,
    text: `${names[p.before] ?? p.before} 排在 ${names[p.after] ?? p.after} 前面`,
    kind: "precedence",
    source: "today",
    customer_ids: [p.before, p.after],
  }))
  return [...today, ...fromServer.filter((rule) => rule.source !== "today")]
}

/** 這個順序違反哪幾條規則（同一條習慣拆成好幾組先後時只算一次）。跟後端 route_planner.violations 同一套判斷 */
export function brokenRules(order: string[], rules: RouteRule[]): RouteRule[] {
  const position = new Map(order.map((id, index) => [id, index]))
  const seen = new Set<string>()
  const broken: RouteRule[] = []
  for (const rule of rules) {
    if (seen.has(rule.id)) continue
    let ok = true
    if (rule.kind === "precedence") {
      const [first, then] = rule.customer_ids.map((id) => position.get(id))
      ok = first === undefined || then === undefined || first < then
    } else {
      const chosen = rule.customer_ids.flatMap((id) => position.get(id) ?? [])
      const others = order.filter((id) => !rule.customer_ids.includes(id)).map((id) => position.get(id)!)
      if (chosen.length > 0 && others.length > 0) {
        ok = rule.kind === "first" ? Math.max(...chosen) < Math.min(...others) : Math.min(...chosen) > Math.max(...others)
      }
    }
    if (!ok) {
      broken.push(rule)
      seen.add(rule.id)
    }
  }
  return broken
}

export type RuleNote = { rule: RouteRule; text: string }

/**
 * 違反的規則寫在哪一張卡上、寫什麼。今天的先後寫在剛拖的那一站（它是前面那家就寫「要在 Y 之前」），
 * 不然寫在後面那家（「要在 X 之後」）；習慣寫那一句，放在剛拖的那一站（習慣有提到它的話），不然放在習慣提到的一家。
 */
export function ruleNotes(order: string[], broken: RouteRule[], names: Record<string, string>, moved: string | null) {
  const notes = new Map<string, RuleNote[]>()
  const add = (id: string, note: RuleNote) => notes.set(id, [...(notes.get(id) ?? []), note])
  for (const rule of broken) {
    if (rule.kind === "precedence" && rule.source === "today") {
      const [first, then] = rule.customer_ids
      if (moved === first) add(first, { rule, text: `要在 ${names[then] ?? then} 之前` })
      else add(then, { rule, text: `要在 ${names[first] ?? first} 之後` })
      continue
    }
    const involved = rule.customer_ids.filter((id) => order.includes(id))
    const target = moved && involved.includes(moved) ? moved : rule.kind === "precedence" ? involved[1] : involved[0]
    if (target) add(target, { rule, text: rule.text })
  }
  return notes
}

/** 「復原」回到哪一份草稿：history（由舊到新）裡最近一份不違反這幾條規則的；找不到就是 null */
export function undoTarget(history: RouteDraft[], ruleIds: string[], fromServer: RouteRule[], names: Record<string, string>) {
  for (let index = history.length - 1; index >= 0; index--) {
    const draft = history[index]
    const broken = brokenRules(draft.stops.map((stop) => stop.customer_id), draftRules(draft, fromServer, names))
    if (!broken.some((rule) => ruleIds.includes(rule.id))) return index
  }
  return null
}

/** 「加一站」回來的 preview 換成新的草稿：還沒跑的站照後端排的順序（新的那一家插在順路的位置，
 * 約的時間與停留是習慣給的預設值；剛跑完的站後端已經拿掉），原本的站保留草稿上的欄位 */
export function draftAfterInsert(draft: RouteDraft, view: TodayRoute): RouteDraft {
  const mine = new Map(draft.stops.map((stop) => [stop.customer_id, stop]))
  return { ...draft, stops: openStops(view).map((stop) => mine.get(stop.customer_id) ?? toDraftStop(stop)) }
}

/** 卡片上的一站：時間、車程、理由用最近一次 preview 回來的，可以改的欄位用草稿的（preview 還沒回來也跟得上） */
export function shownStops(draft: RouteDraft, view: TodayRoute, base: TodayRoute): RouteStop[] {
  const known = new Map([...base.stops, ...view.stops].map((stop) => [stop.customer_id, stop]))
  return draft.stops.flatMap((stop) => {
    const shown = known.get(stop.customer_id)
    return shown ? [{ ...shown, ...stop }] : []
  })
}

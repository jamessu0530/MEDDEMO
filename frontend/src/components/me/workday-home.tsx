import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import {
  Building2,
  Check,
  ChevronRight,
  Flag,
  Plus,
  RefreshCw,
  Search,
  Target,
  CalendarDays,
  ChevronDown,
} from "lucide-react"

import {
  deleteWorkGoal,
  getWorkplace,
  recordPunch,
  saveWorkGoal,
  type GoalDraft,
  type WorkGoal,
  type Workplace,
} from "@/api/workplace"
import { Link } from "react-router"
import { WorkdayLandscape } from "@/components/me/workday-landscape"
import { UserAvatar } from "@/components/user-avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import "./workday-home.css"

const STATUS = {
  in_company: { label: "在公司", tone: "present" },
  left_company: { label: "已離開公司", tone: "away" },
  no_record: { label: "尚無打卡紀錄", tone: "unknown" },
} as const
const time = (value: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
const dateText = (value: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(value))
const message = (error: unknown) =>
  error instanceof Error ? error.message : "暫時無法連線，請再試一次"
const emptyGoal = (): GoalDraft => ({
  title: "",
  note: "",
  due_date: null,
  progress: 0,
})

/** 個人主頁的工作概況；只用當日進出打卡呈現是否在公司。 */
export function WorkdayHome({ children }: { children?: ReactNode }) {
  const user = useAuth()?.user
  const [data, setData] = useState<Workplace | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(true)
  const [notice, setNotice] = useState("")
  const [editor, setEditor] = useState<{
    id?: string
    draft: GoalDraft
  } | null>(null)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const controller = useRef<AbortController | null>(null)
  const pendingPunch = useRef<{ direction: "in" | "out"; id: string } | null>(null)

  const load = useCallback(() => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    return getWorkplace(request.signal)
      .then((next) => {
        if (!request.signal.aborted) {
          setData(next)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted) setError(message(failure))
      })
      .finally(() => {
        if (!request.signal.aborted) setRefreshing(false)
      })
  }, [])

  useEffect(() => {
    void load()
    const refresh = () => {
      if (document.visibilityState === "visible") {
        setRefreshing(true)
        void load()
      }
    }
    const interval = window.setInterval(refresh, 30_000)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      controller.current?.abort()
      window.clearInterval(interval)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [load])

  async function punch(direction: "in" | "out") {
    if (busy) return
    setBusy(true)
    setNotice("")
    const pending =
      pendingPunch.current?.direction === direction
        ? pendingPunch.current
        : { direction, id: crypto.randomUUID() }
    pendingPunch.current = pending
    try {
      const event = await recordPunch(direction, pending.id)
      pendingPunch.current = null
      setNotice(`${time(event.occurred_at)} 已記錄${direction === "in" ? "進公司" : "離開公司"}`)
      await load()
    } catch (failure) {
      setNotice(message(failure))
    } finally {
      setBusy(false)
    }
  }

  if (!user) return null
  const me = data?.members.find((person) => person.id === data.user_id)
  const status = STATUS[me?.status ?? "no_record"]
  const completed = data?.goals.filter((goal) => goal.progress === 100).length ?? 0
  const team = data?.members.filter((person) => person.id !== data.user_id) ?? []
  const visibleTeam = team.filter(
    (person) =>
      (filter === "all" || person.status === filter) &&
      `${person.name} ${person.id} ${person.region}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase())
  )
  const inCompany = team.filter((person) => person.status === "in_company").length

  const moment = data?.as_of ?? new Date().toISOString()
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date(moment))
  )
  const greeting = hour < 12 ? "早安" : hour < 18 ? "午安" : "晚安"
  const dueGoals = [...(data?.goals ?? [])]
    .filter((goal) => goal.due_date && goal.progress < 100)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
    .slice(0, 3)
  const punchDisabled = busy || Boolean(error)

  return (
    <section className="workday-home" aria-label="我的工作日">
      <WorkdayLandscape />
      <div className="wd-home-content">
        <div className="wd-greeting">
          <div>
            <h1>
              {greeting}，{user.name}
            </h1>
            <p>以下是你的工作概況。</p>
          </div>
          <time dateTime={moment}>{dateText(moment)}</time>
        </div>
        {error && (
          <div className="wd-error" role="alert">
            {data ? "更新失敗，以下為上次載入的紀錄。" : "工作概況暫時載入不了。"}
            {error}
            <button type="button" onClick={() => { setRefreshing(true); void load() }}>
              再試一次
            </button>
          </div>
        )}
        {!data && !error && (
          <div className="wd-loading" role="status">
            載入今日打卡與目標中…
          </div>
        )}
        {data && (
          <div className="wd-dashboard-grid">
            <div className="wd-primary-column">
              <article className="wd-card wd-attendance" id="workday-attendance">
                <div className="wd-card-heading">
                  <h2>今日打卡</h2>
                  <button
                    className="wd-icon-action"
                    type="button"
                    onClick={() => { setRefreshing(true); void load() }}
                    disabled={refreshing}
                    aria-label="重新整理工作概況"
                  >
                    <RefreshCw className={cn(refreshing && "animate-spin")} />
                  </button>
                </div>
                <div className="wd-attendance-summary">
                  <span className="wd-app-icon">
                    <Building2 aria-hidden />
                  </span>
                  <div>
                    <div className="wd-presence">
                      <span className={`wd-status-dot ${status.tone}`} />
                      <strong>{status.label}</strong>
                    </div>
                    <p className="wd-secondary">
                      {me?.latest_event
                        ? `最近打卡 ${time(me.latest_event.occurred_at)} · ${me.latest_event.direction === "in" ? "進公司" : "離開公司"}`
                        : "今天還沒有打卡紀錄。"}
                    </p>
                  </div>
                </div>
                <div className="wd-punch-actions">
                  <button
                    type="button"
                    className="wd-primary"
                    disabled={punchDisabled || me?.status === "in_company"}
                    onClick={() => void punch("in")}
                  >
                    {busy ? "記錄中…" : "進公司打卡"}
                  </button>
                  <button
                    type="button"
                    className="wd-secondary-button"
                    disabled={punchDisabled || me?.status !== "in_company"}
                    onClick={() => void punch("out")}
                  >
                    離開公司
                  </button>
                  <span className="wd-punch-note">依今日最近一筆打卡顯示狀態</span>
                </div>
                {notice && (
                  <p className="wd-feedback" role="status">
                    {notice}
                  </p>
                )}
                <details className="wd-records">
                  <summary>
                    <span>查看今日打卡紀錄（{data.events.length}）</span>
                    <ChevronDown aria-hidden />
                  </summary>
                  {data.events.length ? (
                    <ol>
                      {data.events.map((event) => (
                        <li key={event.id}>
                          <span
                            className={cn("wd-timeline-dot", event.direction === "in" && "entered")}
                          />
                          <span>{event.direction === "in" ? "進公司" : "離開公司"}</span>
                          <time dateTime={event.occurred_at}>{time(event.occurred_at)}</time>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="wd-empty-line">今天尚無打卡紀錄</p>
                  )}
                </details>
              </article>

              <article className="wd-card wd-goals" id="workday-goals">
                <div className="wd-card-heading">
                  <h2>我的目標</h2>
                  <button
                    type="button"
                    className="wd-add"
                    onClick={() => setEditor({ draft: emptyGoal() })}
                    aria-label="新增目標"
                  >
                    <Plus aria-hidden />
                    新增
                  </button>
                </div>
                {data.goals.length ? (
                  <>
                    <div className="wd-goal-summary">
                      <span>{data.goals.length} 個目標</span>
                      <span>
                        <Check aria-hidden />
                        {completed} 個已完成
                      </span>
                    </div>
                    <div className="wd-goal-list">
                      {data.goals.map((goal) => (
                        <GoalRow
                          key={goal.id}
                          goal={goal}
                          today={data.date}
                          onEdit={() =>
                            setEditor({
                              id: goal.id,
                              draft: {
                                title: goal.title,
                                note: goal.note,
                                due_date: goal.due_date,
                                progress: goal.progress,
                              },
                            })
                          }
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="wd-empty-goals">
                    <span className="wd-empty-target">
                      <Target aria-hidden />
                    </span>
                    <div>
                      <h3>設定你的第一個目標</h3>
                      <p>為工作設定方向，追蹤每一次進度。</p>
                    </div>
                    <button
                      type="button"
                      className="wd-text-link"
                      onClick={() => setEditor({ draft: emptyGoal() })}
                    >
                      建立目標
                      <ChevronRight aria-hidden />
                    </button>
                  </div>
                )}
              </article>

              {user.role !== "sales" && (
                <article className="wd-card wd-team">
                  <div className="wd-card-heading">
                    <h2>{user.role === "it" ? "公司打卡概況" : "我的團隊"}</h2>
                    <span className="wd-team-total">
                      <span className="wd-status-dot present" />
                      {inCompany} 人在公司
                    </span>
                  </div>
                  <div className="wd-team-controls">
                    <label className="wd-search">
                      <Search aria-hidden />
                      <input
                        aria-label="搜尋同事"
                        placeholder="搜尋姓名或工號"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <select
                      aria-label="篩選打卡狀態"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    >
                      <option value="all">所有狀態</option>
                      <option value="in_company">在公司</option>
                      <option value="left_company">已離開公司</option>
                      <option value="no_record">尚無紀錄</option>
                    </select>
                  </div>
                  <div className="wd-team-table-heading" aria-hidden>
                    <span>同事</span>
                    <span>打卡狀態</span>
                  </div>
                  <ul className="wd-team-list">
                    {visibleTeam.map((person) => (
                      <li key={person.id}>
                        <UserAvatar
                          id={person.id}
                          name={person.name}
                          size="default"
                          className="wd-member-avatar"
                        />
                        <div className="wd-person">
                          <strong>{person.name}</strong>
                          <span>
                            {person.id} · {person.region}
                          </span>
                        </div>
                        <div className="wd-person-status">
                          <span className={cn("wd-status-pill", STATUS[person.status].tone)}>
                            {STATUS[person.status].label}
                          </span>
                          <span>
                            {person.latest_event
                              ? `最近打卡 ${time(person.latest_event.occurred_at)}`
                              : "今日尚無紀錄"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!visibleTeam.length && (
                    <p className="wd-empty-line">
                      {team.length ? "沒有符合條件的同事" : "目前沒有團隊成員"}
                    </p>
                  )}
                  <p className="wd-card-footer-note">
                    共 {team.length} 位同事 · 依今日打卡紀錄更新
                  </p>
                </article>
              )}
            </div>

            <aside className="wd-secondary-column" aria-label="個人工作捷徑">
              <section className="wd-card wd-quick-actions">
                <div className="wd-card-heading">
                  <h2>快速操作</h2>
                </div>
                <div className="wd-quick-buttons">
                  <button
                    type="button"
                    disabled={punchDisabled || me?.status === "in_company"}
                    onClick={() => void punch("in")}
                  >
                    進公司打卡
                  </button>
                  <button type="button" onClick={() => setEditor({ draft: emptyGoal() })}>
                    設定新目標
                  </button>
                  <Link to="/calendar">查看日曆</Link>
                </div>
              </section>
              <section className="wd-card wd-important-dates">
                <div className="wd-card-heading">
                  <h2>重要日期</h2>
                  <CalendarDays aria-hidden />
                </div>
                {dueGoals.length ? (
                  <ul>
                    {dueGoals.map((goal) => (
                      <li key={goal.id}>
                        <span className="wd-date-badge">
                          <span>{Number(goal.due_date!.slice(5, 7))}月</span>
                          <strong>{Number(goal.due_date!.slice(8, 10))}</strong>
                        </span>
                        <button
                          type="button"
                          className="wd-date-goal"
                          onClick={() =>
                            setEditor({
                              id: goal.id,
                              draft: {
                                title: goal.title,
                                note: goal.note,
                                due_date: goal.due_date,
                                progress: goal.progress,
                              },
                            })
                          }
                        >
                          <span>目標完成日</span>
                          <strong>{goal.title}</strong>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="wd-empty-line">目前沒有設定目標完成日。</p>
                )}
                <Link to="/calendar" className="wd-text-link">
                  前往我的日曆
                  <ChevronRight aria-hidden />
                </Link>
              </section>
              {children}
            </aside>
          </div>
        )}
        <footer className="wd-home-footer">
          <span>
            CENRA<span className="wd-footer-plus">+</span> Healthcare
          </span>
          <p>個人工作空間{data && ` · 更新於 ${time(data.as_of)}（台灣時間）`}</p>
        </footer>
      </div>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) setEditor(null)
        }}
      >
        {editor && (
          <GoalEditor
            key={editor.id ?? "new"}
            id={editor.id}
            draft={editor.draft}
            onSaved={() => {
              setEditor(null)
              void load()
            }}
          />
        )}
      </Dialog>
    </section>
  )
}

function GoalRow({ goal, today, onEdit }: { goal: WorkGoal; today: string; onEdit: () => void }) {
  const overdue = goal.due_date && goal.due_date < today && goal.progress < 100
  return (
    <button
      type="button"
      className="wd-goal-row"
      onClick={onEdit}
      aria-label={`編輯目標：${goal.title}`}
    >
      <div className="wd-goal-title">
        <span className={cn("wd-goal-marker", goal.progress === 100 && "complete")}>
          {goal.progress === 100 ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Flag aria-hidden className="size-4" />
          )}
        </span>
        <strong>{goal.title}</strong>
        <ChevronRight aria-hidden className="size-4" />
      </div>
      {goal.note && <p className="wd-goal-note">{goal.note}</p>}
      <div className="wd-progress-label">
        <span className={cn(overdue && "wd-overdue")}>
          {goal.progress === 100 ? "已完成" : overdue ? "已過期限" : "進行中"}
          {goal.due_date && ` · ${goal.due_date.replaceAll("-", "/")}`}
        </span>
        <strong>{goal.progress}%</strong>
      </div>
      <div
        className="wd-progress"
        role="progressbar"
        aria-label={goal.title}
        aria-valuenow={goal.progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${goal.progress}%` }} />
      </div>
    </button>
  )
}

function GoalEditor({
  id,
  draft: initial,
  onSaved,
}: {
  id?: string
  draft: GoalDraft
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !draft.title.trim()) return
    setBusy(true)
    setError("")
    try {
      await saveWorkGoal(draft, id)
      onSaved()
    } catch (failure) {
      setError(message(failure))
      setBusy(false)
    }
  }
  async function remove() {
    if (!id || busy) return
    setBusy(true)
    setError("")
    try {
      await deleteWorkGoal(id)
      onSaved()
    } catch (failure) {
      setError(message(failure))
      setBusy(false)
    }
  }
  return (
    <DialogContent
      className="workday-dialog"
      onEscapeKeyDown={(event) => {
        if (busy) event.preventDefault()
      }}
      onInteractOutside={(event) => {
        if (busy) event.preventDefault()
      }}
      showCloseButton={!busy}
    >
      <DialogHeader>
        <DialogTitle>{id ? "編輯目標" : "設定新目標"}</DialogTitle>
        <DialogDescription>設定方向、記錄進度，為自己保留每一次前進。</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void save(event)} className="wd-goal-form">
        <label>
          目標名稱
          <input
            autoFocus
            required
            maxLength={120}
            placeholder="例如：完成本月客戶拜訪計畫"
            value={draft.title}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label>
          補充說明
          <textarea
            rows={3}
            maxLength={1000}
            placeholder="想怎麼完成這個目標？（選填）"
            value={draft.note}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        </label>
        <label>
          預計完成日（選填）
          <input
            type="date"
            value={draft.due_date ?? ""}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, due_date: event.target.value || null })}
          />
        </label>
        <label>
          目前進度 <strong>{draft.progress}%</strong>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.progress}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, progress: Number(event.target.value) })}
          />
        </label>
        {error && (
          <p className="wd-error" role="alert">
            {error}
          </p>
        )}
        <div className="wd-form-actions">
          {id && (
            <button
              type="button"
              className="wd-delete"
              disabled={busy}
              onClick={() => void remove()}
            >
              刪除目標
            </button>
          )}
          <button type="submit" className="wd-primary" disabled={busy || !draft.title.trim()}>
            {busy ? "儲存中…" : "儲存目標"}
          </button>
        </div>
      </form>
    </DialogContent>
  )
}

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Loader2, Plus, Repeat } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { ApiError } from "@/api/client"
import { getTodayRoute, previewToday, saveToday, type DraftStop, type Precedence, type RouteDraft } from "@/api/route"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { DriveSource } from "@/components/route/drive-source"
import { HabitPrompt, type HabitChoice } from "@/components/route/habit-prompt"
import { SkippedHabitsNote } from "@/components/route/home-extras"
import { StopCard, type StopHandle } from "@/components/route/stop-card"
import { StopEditor } from "@/components/route/stop-editor"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/lib/auth"
import {
  brokenRules,
  dragHabit,
  draftRules,
  formatMinutes,
  moveItem,
  ruleNotes,
  samePrecedence,
  shownStops,
  undoTarget,
  weekdayOf,
  withoutStop,
  type HabitSuggestion,
  type RuleNote,
} from "@/lib/itinerary"
import { routeDraft, useRouteDraft } from "@/lib/route-draft"
import { cn } from "@/lib/utils"

type Prompt = HabitSuggestion & { id: number }

// 拖移的讀屏說明：dnd-kit 預設是英文，這裡換成中文（內容不隨畫面變，拉到元件外面，不必每次重畫都建一份）
const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: "按空白鍵拿起這一站，用上下鍵移動，再按空白鍵放下；按 Esc 取消。",
}

/**
 * 調整行程（清單）：首頁橫幅按「調整」進來（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈調整行程（清單）〉）。
 * 每站一張卡，拖移把手或上移下移換順序，點卡片展開編輯約的時間、停留、先後、備註、鎖住、拿掉。
 * 改動先留在畫面上（lib/route-draft.ts），每次改完停 300ms 用 preview 算時間與車程（不存）；違反規則在手機上
 * 即時判斷（lib/itinerary.ts，跟後端同一套）。按「完成」用 PUT 一次存進去，按「取消」全部丟掉。
 */
export function RouteEditPage() {
  const navigate = useNavigate()
  const userId = useAuth()?.user.id ?? null
  const edit = useRouteDraft()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // 存檔失敗、行程剛被別人改過（409）的提示：preview 的錯誤分開放，preview 成功不會把這個沖掉
  const [hint, setHint] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  // 每一張「以後也這樣排嗎？」的編號：換一句就換一張，選項回到「只有今天」
  const promptCount = useRef(0)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // 從首頁進來一律讀最新的行程（EditRouteLink 進來前會先清掉舊草稿）；只有從加一站、習慣頁回來時草稿還在，接著改
  useEffect(() => {
    if (!userId || routeDraft.get()) return
    const controller = new AbortController()
    getTodayRoute(userId, controller.signal)
      .then(({ route, cached }) => {
        if (cached) setLoadError("連不上伺服器，現在不能調整行程。")
        else routeDraft.start(route)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(error instanceof ApiError ? error.message : "連不上伺服器，今天的行程沒有載入。")
      })
    return () => controller.abort()
  }, [userId, attempt])

  // 每次改動停 300ms 再算時間、車程與違反的規則；算好之前畫面先用上一次的時間。
  // 還沒改過就不算：畫面用進來時讀到的那一份（正式的車程），preview 一律是直線估算
  const draft = edit?.draft
  const changed = Boolean(edit && edit.history.length > 0)
  useEffect(() => {
    if (!draft || !changed) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      previewToday(draft, undefined, controller.signal)
        .then((view) => {
          routeDraft.showView(view, draft)
          setPreviewError(null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setPreviewError(error instanceof ApiError ? error.message : "連不上伺服器，時間先不更新。")
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [draft, changed])

  function cancel() {
    routeDraft.clear()
    // 用 replace：不留在瀏覽紀錄裡，不然從首頁按上一頁會回到調整頁
    navigate("/", { replace: true })
  }

  const cancelButton = (
    <button
      type="button"
      onClick={cancel}
      className="flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
    >
      取消
    </button>
  )

  if (!userId) return null

  if (!edit) {
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="調整行程" leading={cancelButton} />
        <main className="px-4 pt-10">
          {loadError ? (
            <Notice
              text={loadError}
              action={{
                label: "重新載入",
                onClick: () => {
                  setLoadError(null)
                  setAttempt((n) => n + 1)
                },
              }}
              secondary={{ label: "回今日路線", onClick: cancel }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Mascot state="wait" size={96} />
              <p className="text-sm text-muted-foreground">載入今天的行程…</p>
            </div>
          )}
        </main>
      </div>
    )
  }

  const { base, view, history, moved } = edit
  const current = edit.draft
  const names: Record<string, string> = Object.fromEntries(
    [...base.stops, ...view.stops].map((stop) => [stop.customer_id, stop.customer_name])
  )
  const finished = view.stops.filter((stop) => stop.status === "done")
  const open = shownStops(current, view, base)
  const order = current.stops.map((stop) => stop.customer_id)
  const broken = brokenRules(order, draftRules(current, view.rules, names))
  const notes = ruleNotes(order, broken, names, moved)
  const weekday = weekdayOf(base.date)
  const undoable = (ids: string[]) => undoTarget(history, ids, view.rules, names) !== null
  const related = (id: string) => current.precedences.filter((p) => p.before === id || p.after === id)
  const stopName = (id: string | number) => names[String(id)] ?? String(id)
  // 拖移時讀屏唸的話：用客戶名字，不是把手/卡片上原本就有的英文代稱
  const announcements: Announcements = {
    onDragStart: ({ active }) => `拿起 ${stopName(active.id)}`,
    onDragOver: ({ active, over }) => (over ? `${stopName(active.id)} 移到 ${stopName(over.id)} 的位置` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `${stopName(active.id)} 放在第 ${order.indexOf(String(over.id)) + 1} 站` : `${stopName(active.id)} 放回原位`,
    onDragCancel: ({ active }) => `取消，${stopName(active.id)} 回到原位`,
  }

  function change(next: RouteDraft, movedId: string | null = null) {
    routeDraft.change(next, movedId)
    // 又改了別的：上一張「以後也這樣排嗎？」當作只有今天
    setPrompt(null)
  }

  function ask(suggestion: HabitSuggestion) {
    promptCount.current += 1
    setPrompt({ ...suggestion, id: promptCount.current })
  }

  function move(from: number, to: number) {
    if (from < 0 || to < 0 || to >= order.length || from === to) return
    const next = { ...current, stops: moveItem(current.stops, from, to) }
    change(next, order[from])
    // 拖完的順序新違反了規則就不問要不要記成習慣，改走紅框
    const before = new Set(broken.map((rule) => rule.id))
    const after = brokenRules(next.stops.map((stop) => stop.customer_id), draftRules(next, view.rules, names))
    if (after.some((rule) => !before.has(rule.id))) return
    const suggestion = dragHabit(order, from, to, names)
    if (suggestion) ask(suggestion)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    move(order.indexOf(String(active.id)), order.indexOf(String(over.id)))
  }

  function patch(customerId: string, values: Partial<DraftStop>, suggestion?: HabitSuggestion) {
    change({ ...current, stops: current.stops.map((stop) => (stop.customer_id === customerId ? { ...stop, ...values } : stop)) })
    if (suggestion) ask(suggestion)
  }

  function addPrecedence(precedence: Precedence) {
    if (precedence.before === precedence.after || current.precedences.some((p) => samePrecedence(p, precedence))) return
    change({ ...current, precedences: [...current.precedences, precedence] })
  }

  function removePrecedence(precedence: Precedence) {
    change({ ...current, precedences: current.precedences.filter((p) => !samePrecedence(p, precedence)) })
  }

  function removeStop(customerId: string) {
    setExpanded(null)
    change(withoutStop(current, customerId))
  }

  // 紅框上的「今天不套用這條」：存著的習慣記進今天不套用；這次才答應的照樣記下來，只是今天不套用
  function skipHabit(note: RuleNote) {
    const [kind, key] = note.rule.id.split(":")
    if (kind === "habit") change({ ...current, skipped_habit_ids: [...current.skipped_habit_ids, Number(key)] })
    if (kind === "new") {
      change({ ...current, habits: current.habits.map((habit, i) => (i === Number(key) ? { ...habit, skip_today: true } : habit)) })
    }
  }

  function undo(ruleIds: string[]) {
    const index = undoTarget(history, ruleIds, view.rules, names)
    if (index === null) return
    routeDraft.revert(index)
    setPrompt(null)
  }

  function answer(choice: HabitChoice) {
    if (prompt && choice !== "today") {
      const habit = { ...prompt.habit, weekday: choice === "weekday" ? weekday : null }
      routeDraft.change({ ...current, habits: [...current.habits, habit] }, moved)
    }
    setPrompt(null)
  }

  async function save() {
    if (!userId || !edit) return
    setConfirming(false)
    setSaving(true)
    try {
      await saveToday(userId, base.version, current)
      routeDraft.clear()
      navigate("/", { replace: true })
    } catch (error) {
      setSaving(false)
      if (error instanceof ApiError && error.status === 409) {
        // 行程剛被改過：剛才的改動不保留，載入最新的
        routeDraft.clear()
        setPrompt(null)
        setExpanded(null)
        setHint(error.message)
        setAttempt((n) => n + 1)
        return
      }
      setHint(error instanceof ApiError ? error.message : "連不上伺服器，這次沒有存到，請再試一次。")
    }
  }

  // 還有規則沒處理：「完成」按得下去，但先問一次要不要復原
  function finish() {
    if (broken.length > 0) setConfirming(true)
    else void save()
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="調整行程"
        leading={cancelButton}
        trailing={
          <div className="flex shrink-0 items-center gap-0.5 pr-2">
            <Link
              to="/route/habits"
              state={{ from: "/route/edit" }}
              className="flex h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted"
            >
              <Repeat className="size-4" />
              習慣
            </Link>
            <Button className="h-10 px-4" disabled={saving} onClick={finish}>
              {saving && <Loader2 className="animate-spin" />}
              完成
            </Button>
          </div>
        }
      />
      <main className="flex flex-1 flex-col px-4 pt-3 pb-10">
        <p className="text-xs text-muted-foreground tabular-nums">
          共 {view.travel_km} 公里 · 車程 {formatMinutes(view.travel_minutes)}
          {view.finish_time && ` · 約 ${view.finish_time} 收工`}
          <DriveSource estimated={view.estimated} />
        </p>
        {hint && <p className="mt-2 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">{hint}</p>}
        {previewError && <p className="mt-2 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">{previewError}</p>}
        <SkippedHabitsNote route={view} className="mt-2" />

        {finished.length > 0 && (
          <ol aria-label="已完成的站" className="mt-3 flex flex-col gap-2">
            {finished.map((stop, index) => (
              <li key={stop.customer_id}>
                <StopCard stop={stop} number={index + 1} names={names} precedences={[]} />
              </li>
            ))}
          </ol>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{ screenReaderInstructions: SCREEN_READER_INSTRUCTIONS, announcements }}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ol aria-label="還沒跑的站" className="flex flex-col">
              {open.map((stop, index) => {
                const draftStop = current.stops.find((s) => s.customer_id === stop.customer_id)!
                const cardNotes = notes.get(stop.customer_id) ?? []
                // move() 要的是這一站在 order（草稿全部還沒跑的站）裡的位置，不是在 open（畫面顯示的）裡的位置：
                // 兩者通常一樣，但 shownStops 濾掉過還不認得的站時會錯開
                const pos = order.indexOf(stop.customer_id)
                return (
                  <Sortable key={stop.customer_id} id={stop.customer_id}>
                    {(handle, dragging) => (
                      <>
                        {stop.travel_minutes !== null && (
                          <p className="py-1.5 pl-11 text-xs text-muted-foreground tabular-nums">
                            車程 {stop.travel_minutes} 分 · {stop.travel_km} 公里
                          </p>
                        )}
                        <StopCard
                          stop={stop}
                          number={finished.length + index + 1}
                          names={names}
                          precedences={related(stop.customer_id)}
                          notes={cardNotes}
                          undoable={cardNotes.length > 0 && undoable(cardNotes.map((note) => note.rule.id))}
                          expanded={expanded === stop.customer_id}
                          canMoveUp={pos > 0}
                          canMoveDown={pos < order.length - 1}
                          dragging={dragging}
                          handle={handle}
                          onToggle={() => setExpanded(expanded === stop.customer_id ? null : stop.customer_id)}
                          onMoveUp={() => move(pos, pos - 1)}
                          onMoveDown={() => move(pos, pos + 1)}
                          onDropRule={(note) => removePrecedence({ before: note.rule.customer_ids[0], after: note.rule.customer_ids[1] })}
                          onSkipHabit={skipHabit}
                          onUndo={(note) => undo([note.rule.id])}
                        >
                          <StopEditor
                            stop={draftStop}
                            name={stop.customer_name}
                            arrive={stop.planned_time}
                            others={open
                              .filter((o) => o.customer_id !== stop.customer_id)
                              .map((o) => ({ id: o.customer_id, name: o.customer_name }))}
                            precedences={related(stop.customer_id)}
                            onChange={(values, suggestion) => patch(stop.customer_id, values, suggestion)}
                            onAddPrecedence={addPrecedence}
                            onRemovePrecedence={removePrecedence}
                            onRemove={() => removeStop(stop.customer_id)}
                          />
                        </StopCard>
                      </>
                    )}
                  </Sortable>
                )
              })}
            </ol>
          </SortableContext>
        </DndContext>
        {open.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">今天還沒有要跑的站。</p>}

        <Link to="/route/edit/add" className={cn(buttonVariants({ variant: "outline" }), "mt-4 h-12 text-sm")}>
          <Plus />
          加一站
        </Link>
      </main>

      {prompt && <HabitPrompt key={prompt.id} text={prompt.text} weekday={weekday} onDone={answer} />}

      {confirming && (
        <Dialog open onOpenChange={(visible) => !visible && setConfirming(false)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>還有 {broken.length} 條規則沒處理，要復原嗎？</DialogTitle>
              <DialogDescription>照這樣存的話，違反的習慣今天不套用，違反的先後會拿掉。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {undoable(broken.map((rule) => rule.id)) && (
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    setConfirming(false)
                    undo(broken.map((rule) => rule.id))
                  }}
                >
                  復原
                </Button>
              )}
              <Button className="h-11" onClick={() => void save()}>
                照這樣存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/** 一張可以拖的卡：dnd-kit 的 useSortable 給位移與把手 */
function Sortable({ id, children }: { id: string; children: (handle: StopHandle, dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10")}
    >
      {children({ ref: setActivatorNodeRef, attributes, listeners }, isDragging)}
    </li>
  )
}

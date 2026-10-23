import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react"
import { ChevronDown, Loader2, Mic, SendHorizontal } from "@/components/icons"
import { useLocation } from "react-router"

import { askSessionFor } from "@/ask/ask-session"
import { assistantVoice, closeAssistantVoice, openAssistantVoice } from "@/ask/assistant-voice"
import {
  assistantWindow,
  closeAssistant,
  openAssistant,
} from "@/ask/assistant-window"
import { useConversation } from "@/ask/use-conversation"
import { useCurrentPageContext } from "@/ask/use-page-context"
import { pageAssistantPlacement } from "@/ask/page-assistant"
import { useAssistantLayout } from "@/ask/use-assistant-layout"
import { useAssistantResize } from "@/ask/use-assistant-resize"
import { AssistantSwipeCard } from "@/components/ask/assistant-swipe-unlock"
import { useAssistantTransition, type AssistantTransitionAction } from "@/ask/use-assistant-transition"
import { AssistantModeTransition } from "@/components/ask/assistant-mode-transition"
import { EntryView } from "@/components/ask/entry-view"
import { AccountMemoryStatus } from "@/components/ask/memory-status"
import { AssistantTasks } from "@/components/ask/assistant-tasks"
import { AttachButton, DraftFiles } from "@/components/attachments/draft-files"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { CardFooter, CardHeader } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { addDraftFiles, shrinkPhoto, type DraftFile } from "@/lib/attachments"
import { useAuth } from "@/lib/auth"
import { FIXED_COLUMN, pageWidth } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"
import { uiDemo } from "@/lib/ui-demo-browser"
import { useStartUiDemo } from "@/lib/use-start-ui-demo"
import { requestedUiDemo } from "@/lib/ui-demo"
import { reportAssistant } from "@/ask/report-assistant"
import { ReportAssistantPreview } from "@/components/reports/report-assistant-preview"
import {
  customerPriorityAssistant,
  isCustomerPriorityPage,
} from "@/ask/customer-priority-assistant"
import { CustomerPriorityAssistantPreview } from "@/components/manager/customer-priority-assistant-preview"

/** 共用對話與草稿；路線頁使用原有的 AI 輸入列，頻道內透過 @熊熊滾 提問。 */
export function Assistant() {
  const user = useAuth()?.user
  const page = useCurrentPageContext()
  const location = useLocation()
  const { pathname } = location
  const asking = askSessionFor(user?.id ?? "")
  const thread = useSyncExternalStore(asking.threads.subscribe, asking.threads.getSnapshot, asking.threads.getSnapshot)
  const sending = useSyncExternalStore(asking.subscribe, asking.isBusy, asking.isBusy)
  const transition = useAssistantTransition(user?.id)
  const restoreInputFocus = useRef(false)
  useLayoutEffect(() => {
    if (!restoreInputFocus.current) return
    restoreInputFocus.current = false
    document.getElementById("page-assistant-input")?.focus({ preventScroll: true })
  }, [thread.id])
  function changeMode(action: AssistantTransitionAction) {
    if (!user || sending) return
    closeAssistantVoice()
    restoreInputFocus.current = document.activeElement?.id === "page-assistant-input"
    if (action === "ghost") asking.threads.enterGhost()
    else asking.threads.startNew()
    transition.play(action)
  }
  const placement = pageAssistantPlacement(pathname)
  const enabled = Boolean(user) && placement !== "none"
  const bare = pageWidth(pathname) === "bare"
  const open = useSyncExternalStore(
    assistantWindow.subscribe,
    assistantWindow.getSnapshot,
    assistantWindow.getSnapshot
  )
  const { inset, availableHeight } = useAssistantLayout(enabled)
  const {
    panelRef,
    height: panelHeight,
    resizing,
    handleProps,
  } = useAssistantResize(open, availableHeight)
  const fullAnimation = availableHeight !== undefined && availableHeight - (open ? panelHeight : 80) >= 248
  const modeAnimation = transition.event && <AssistantModeTransition key={transition.event.id} action={transition.event.action} unlock={transition.reward?.unlock} failed={transition.reward?.failed} compact={!fullAnimation} heading={`熊熊滾 · ${page.title}`} />
  const demo = useSyncExternalStore(
    uiDemo.subscribe,
    uiDemo.getSnapshot,
    uiDemo.getSnapshot
  )
  const active = enabled
  const dockRef = useRef<HTMLDivElement>(null)
  const collapsedHeight = useRef(80)
  useEffect(() => {
    if (!enabled) {
      document.documentElement.style.removeProperty(
        "--page-assistant-dock-space"
      )
      document.documentElement.style.removeProperty(
        "--page-assistant-dock-height"
      )
      return
    }
    if (!dockRef.current) return
    const element = dockRef.current
    const update = () => {
      const height = element.getBoundingClientRect().height
      // 展開回覆不推動整個頁面；鍵盤與底部分頁列的位移仍即時更新。
      if (!open && height) collapsedHeight.current = Math.ceil(height)
      document.documentElement.style.setProperty(
        "--page-assistant-dock-height",
        `${collapsedHeight.current}px`
      )
      document.documentElement.style.setProperty(
        "--page-assistant-dock-space",
        `${collapsedHeight.current + inset}px`
      )
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [enabled, open, inset])
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(
        "--page-assistant-dock-space"
      )
      document.documentElement.style.removeProperty(
        "--page-assistant-dock-height"
      )
    },
    []
  )
  useEffect(() => {
    const requested = (location.state as { assistantThread?: string } | null)?.assistantThread
    if (requested && requested === asking.threads.getSnapshot().id) openAssistant()
    else closeAssistant()
  }, [pathname, location.key, location.state, asking])
  useEffect(() => {
    if (!open || !active) return
    const onKey = (event: KeyboardEvent) => {
      const dialog =
        event.target instanceof Element
          ? event.target.closest('[role="dialog"]')
          : null
      if (event.key === "Escape" && !event.defaultPrevented && !dialog) {
        closeAssistant()
        requestAnimationFrame(() =>
          document
            .getElementById("page-assistant-resize")
            ?.focus({ preventScroll: true })
        )
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, active])
  if (!enabled) return null
  return (
    <div
      ref={dockRef}
      data-page-assistant
      hidden={demo.status === "running"}
      data-placement="dock"
      className={cn(
        "pointer-events-none flex flex-col pt-2 pr-[max(env(safe-area-inset-right),0.625rem)] pb-[max(env(safe-area-inset-bottom),0.5rem)] pl-[max(env(safe-area-inset-left),0.625rem)]",
        demo.status === "running" && "hidden",
        bare
          ? "fixed inset-x-0 z-30 mx-auto max-w-md"
          : cn(FIXED_COLUMN, "z-30 lg:max-w-xl")
      )}
      style={
        {
          bottom: inset,
          maxHeight: `max(0px, calc(${availableHeight === undefined ? "100dvh" : `${availableHeight}px`} - max(env(safe-area-inset-top), 0.5rem)))`,
          "--assistant-height": `${panelHeight}px`,
        } as CSSProperties
      }
    >
      <AssistantSwipeCard
        onSwipe={changeMode}
        swipeEnabled={Boolean(user) && !sending}
        ref={panelRef}
        id="page-assistant-panel"
        data-assistant-mode={thread.ghost ? "ghost" : "saved"}
        aria-keyshortcuts="Alt+Shift+ArrowRight Alt+Shift+ArrowLeft"
        onKeyDown={(event) => {
          if (!user || sending || !event.altKey || !event.shiftKey) return
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          changeMode(event.key === "ArrowRight" ? "ghost" : "new")
        }}
        hidden={!active}
        className={cn(
          "pointer-events-auto min-h-0 touch-pan-y gap-0 overflow-hidden rounded-2xl border-foreground py-0 shadow-lg shadow-foreground/5",
          thread.ghost && "border-dashed border-muted-foreground/60 bg-muted/95",
          open && "h-[var(--assistant-height)]",
          resizing && "select-none",
          !active && "hidden"
        )}
      >
        {open && (
          <CardHeader className="shrink-0 border-b px-3 py-1">
            <div className="flex items-center gap-3">
              {modeAnimation && !fullAnimation ? <div className="min-w-0 flex-1">{modeAnimation}</div> : <p
                className="min-w-0 flex-1 truncate text-sm font-semibold"
                title={`熊熊滾 · ${page.title}`}
              >
                熊熊滾 · {page.title}
              </p>}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-11 shrink-0 rounded-xl text-muted-foreground"
                aria-label="收起 AI 回覆"
                aria-expanded={true}
                aria-controls="page-assistant-panel"
                onClick={() => {
                  closeAssistant()
                  requestAnimationFrame(() =>
                    document
                      .getElementById("page-assistant-resize")
                      ?.focus({ preventScroll: true })
                  )
                }}
              >
                <ChevronDown className="size-5" />
              </Button>
            </div>
          </CardHeader>
        )}
        <AssistantContent key={`${user?.id}:${thread.id}`} open={open && active} />
      </AssistantSwipeCard>
      <div
        id="page-assistant-resize"
        role="separator"
        tabIndex={0}
        aria-label="調整對話框高度"
        aria-orientation="horizontal"
        aria-controls="page-assistant-answers"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={open ? "向上拉高、向下縮小對話框" : "對話已收合，向上拉查看紀錄"}
        {...handleProps}
        className="pointer-events-auto absolute top-0 left-1/2 z-40 flex h-5 w-20 -translate-x-1/2 touch-none cursor-ns-resize select-none items-center justify-center rounded-full hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      ><span className="h-0.5 w-8 rounded-full bg-muted-foreground/35" /></div>
      {!open && !fullAnimation && modeAnimation && <div className="pointer-events-none absolute inset-x-2 bottom-full overflow-hidden rounded-xl border bg-card/95 px-3 shadow-sm">{modeAnimation}</div>}
      {fullAnimation && modeAnimation}
    </div>
  )
}

function AssistantContent({
  open,
}: {
  open: boolean
}) {
  const user = useAuth()?.user
  const page = useCurrentPageContext()
  const startDemo = useStartUiDemo()
  const location = useLocation()
  const jumpEntry = (location.state as { assistantEntry?: number } | null)?.assistantEntry
  const report = useSyncExternalStore(
    reportAssistant.subscribe,
    reportAssistant.getSnapshot,
    reportAssistant.getSnapshot
  )
  const editingReport = report.editing && pathnameIsReport(page.path)
  const priority = useSyncExternalStore(
    customerPriorityAssistant.subscribe,
    customerPriorityAssistant.getSnapshot,
    customerPriorityAssistant.getSnapshot
  )
  const editingPriority = priority.editing && isCustomerPriorityPage(page.path)
  const asking = askSessionFor(user?.id ?? "")
  const conversation = asking.conversation
  const sending = useSyncExternalStore(
    asking.subscribe,
    asking.isBusy,
    asking.isBusy
  )
  const [question, setQuestion] = useState("")
  const [files, setFiles] = useState<DraftFile[]>([])
  const [pickError, setPickError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const preparingRef = useRef(false)
  const { active: voiceOn, session } = useSyncExternalStore(assistantVoice.subscribe, assistantVoice.getSnapshot, assistantVoice.getSnapshot)
  const [notice, setNotice] = useState<{
    text: string
    retryByReload?: boolean
  } | null>(null)
  const answersRef = useRef<HTMLDivElement>(null)
  const followAnswersRef = useRef(true)
  const answerSizeRef = useRef("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const entries = useConversation(conversation).filter(
    (entry) => entry.kind === "tool" || entry.text.trim()
  )
  const busy = sending || preparing

  useEffect(() => {
    if (open) {
      followAnswersRef.current = true
      if (answersRef.current)
        answersRef.current.scrollTop = answersRef.current.scrollHeight
    }
  }, [open])
  useEffect(() => {
    if (open)
      answersRef.current?.scrollTo({
        top: answersRef.current.scrollHeight,
        behavior: "smooth",
      })
  }, [entries.length, open])
  useEffect(() => {
    const answers = answersRef.current
    if (!open || !answers) return
    const observer = new ResizeObserver(() => {
      if (followAnswersRef.current) answers.scrollTop = answers.scrollHeight
      answerSizeRef.current = `${answers.clientWidth}:${answers.clientHeight}:${answers.scrollHeight}`
    })
    observer.observe(answers)
    if (answers.firstElementChild) observer.observe(answers.firstElementChild)
    return () => observer.disconnect()
  }, [open])

  useEffect(() => {
    if (!open || jumpEntry === undefined) return
    const element = document.getElementById(`ask-entry-${jumpEntry}`)
    if (!element) return
    followAnswersRef.current = false
    element.scrollIntoView({ behavior: "smooth", block: "nearest" })
    element.focus({ preventScroll: true })
  }, [open, jumpEntry, entries.length, location.key])

  async function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy || preparingRef.current) return
    inputRef.current?.blur()
    const submittedThread = asking.threads.getSnapshot().id
    openAssistant()
    const snapshot = {
      path: page.path,
      title: page.title,
      facts: [...page.facts],
    }
    setQuestion("")
    if (
      session &&
      !requestedUiDemo(trimmed, snapshot.path) &&
      !reportAssistant.handles(trimmed, snapshot) &&
      !customerPriorityAssistant.handles(trimmed, snapshot)
    ) {
      session.sendText(trimmed)
      return
    }
    if (session) closeAssistantVoice()
    const file = files[0]?.file
    setFiles([])
    setPickError(null)
    preparingRef.current = true
    setPreparing(true)
    try {
      const ready = file ? await shrinkPhoto(file) : undefined
      if (!asking.polls.aborted && asking.threads.getSnapshot().id === submittedThread) {
        await asking.ask(trimmed, ready, snapshot)
        const reply = conversation.getSnapshot().at(-1)
        if (!asking.polls.aborted && reply?.kind === "model" && reply.demo) {
          startDemo(reply.demo, reply.demoPath)
        }
      }
    } catch (error) {
      setNotice({
        text:
          error instanceof Error ? error.message : "檔案處理失敗，請再試一次",
      })
      setQuestion(trimmed)
      if (file) setFiles(addDraftFiles([], [file], 1).files)
    } finally {
      preparingRef.current = false
      setPreparing(false)
    }
  }
  function pick(picked: File[]) {
    const result = addDraftFiles([], picked.slice(0, 1), 1)
    if (result.files.length) setFiles(result.files)
    setPickError(result.error)
  }
  return (
    <>
      <div
        id="page-assistant-answers"
        ref={answersRef}
        hidden={!open}
        role="region"
        aria-label="與熊熊滾的共用對話"
        onScroll={(event) => {
          const answers = event.currentTarget
          // 重新排版也會觸發 scroll；等 ResizeObserver 處理後才判斷是否往上翻閱。
          if (
            answerSizeRef.current !==
            `${answers.clientWidth}:${answers.clientHeight}:${answers.scrollHeight}`
          )
            return
          followAnswersRef.current =
            answers.scrollHeight - answers.scrollTop - answers.clientHeight < 24
        }}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          !open && "hidden"
        )}
      >
        <div className="flex flex-col gap-4 px-3 py-3 [overflow-wrap:anywhere]">
          <AssistantTasks session={asking.tasks} conversation={conversation} />
          {entries.map((entry) => (
            <div
              key={entry.id}
              id={`ask-entry-${entry.id}`}
              tabIndex={-1}
              className="min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <EntryView
                entry={entry}
                onAskAsTyped={(id) => void asking.askAsTyped(id)}
                busy={busy}
              />
            </div>
          ))}
          {editingReport && <ReportAssistantPreview />}
          {editingPriority && <CustomerPriorityAssistantPreview />}
          {!asking.threads.getSnapshot().ghost && <AccountMemoryStatus memory={asking.memory} />}
          {notice && (
            <Notice
              text={notice.text}
              action={
                notice.retryByReload
                  ? {
                      label: "重新整理",
                      onClick: () => window.location.reload(),
                    }
                  : undefined
              }
            />
          )}
        </div>
      </div>
      <CardFooter
        className={cn(
          "shrink-0 flex-col items-stretch gap-1 p-1",
          open && "border-t"
        )}
      >
        {open && user?.role === "sales" && !asking.threads.getSnapshot().ghost && (
          <p className="px-2 pt-1 text-xs leading-relaxed text-muted-foreground">提問時定位一次，供主管查看提問地圖。</p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit(question)
          }}
          className="flex flex-wrap items-end gap-0.5 rounded-xl transition-shadow focus-within:ring-2 focus-within:ring-primary/10"
        >
          {pickError && (
            <p
              role="alert"
              className="w-full px-2 pt-1 text-xs text-destructive"
            >
              {pickError}
            </p>
          )}
          {!session && files.length > 0 && (
            <div className="w-full px-2 pt-2">
              <DraftFiles
                files={files}
                onRemove={() => setFiles([])}
                disabled={busy}
              />
            </div>
          )}
          {!open && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              aria-label="展開共用對話"
              aria-expanded={false}
              aria-controls="page-assistant-answers"
              onClick={openAssistant}
            >
              <Mascot state={busy ? "think" : "hi"} size={28} bust />
            </Button>
          )}
          <Textarea
            id="page-assistant-input"
            ref={inputRef}
            value={question}
            maxLength={files.length ? 500 : 8000}
            onChange={(event) => {
              setQuestion(event.target.value)
              session?.noteActivity()
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                void submit(question)
              }
            }}
            rows={1}
            wrap="off"
            placeholder={
              session
                ? "打字也能問"
                : files.length
                  ? "想問檔案的什麼？"
                  : busy
                    ? "先寫下下一題…"
                    : editingReport
                      ? "輸入問題或報表調整需求…"
                      : editingPriority
                        ? "輸入問題或客戶策略調整需求…"
                        : "輸入問題…"
            }
            aria-label="輸入問題"
            className="h-9 field-sizing-fixed max-h-9 min-h-9 min-w-0 flex-1 resize-none overflow-hidden rounded-lg border-0 bg-transparent px-1 py-1.5 text-base leading-6 shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
          />
          <div className="flex shrink-0 items-center [&>button]:h-9 [&>button]:min-h-0 [&>button]:px-2">
            {!session && (
              <AttachButton onPick={pick} disabled={busy} multiple={false} />
            )}
            {!voiceOn && (
              <Button
                type="button"
                variant="ghost"
                className="h-9 shrink-0 gap-1 px-2 text-xs"
                disabled={busy}
                onClick={() => {
                  setNotice(null)
                  openAssistantVoice()
                }}
                aria-label="啟動語音問答"
              >
                <Mic className="size-4" />
                語音問答
              </Button>
            )}
            <Button
              type="submit"
              size="icon"
              className="ml-auto size-9 min-h-0 shrink-0 rounded-xl p-0 shadow-none active:transform-none"
              disabled={busy || !question.trim()}
              aria-label="送出"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <SendHorizontal className="size-4" />
              )}
            </Button>
          </div>
        </form>
      </CardFooter>
    </>
  )
}

function pathnameIsReport(path: string) {
  return path.split("?")[0].replace(/\/$/, "") === "/reports"
}

import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react"
import { ChevronDown, Loader2, Mic, SendHorizontal } from "@/components/icons"
import { Link, useLocation } from "react-router"

import type { Ask } from "@/api/asks"
import { askSessionFor } from "@/ask/ask-session"
import {
  assistantWindow,
  closeAssistant,
  openAssistant,
} from "@/ask/assistant-window"
import { useConversation } from "@/ask/use-conversation"
import { useCurrentPageContext } from "@/ask/use-page-context"
import { pageAssistantPlacement } from "@/ask/page-assistant"
import { useAssistantLayout } from "@/ask/use-assistant-layout"
import { EntryView } from "@/components/ask/entry-view"
import type { VoiceSession } from "@/components/ask/voice-dock"
import { AttachButton, DraftFiles } from "@/components/attachments/draft-files"
import { LearningAiGate } from "@/components/learning/ai-gate"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Card, CardFooter, CardHeader } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { addDraftFiles, shrinkPhoto, type DraftFile } from "@/lib/attachments"
import { useAuth } from "@/lib/auth"
import { FIXED_COLUMN, pageWidth } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"
import { uiDemo } from "@/lib/ui-demo-browser"
import { useStartUiDemo } from "@/lib/use-start-ui-demo"
import { requestedUiDemo } from "@/lib/ui-demo"

const loadVoiceDock = () => import("@/components/ask/voice-dock")

/** 共用對話與草稿；路線頁使用原有的 AI 輸入列。 */
export function Assistant() {
  const user = useAuth()?.user
  const page = useCurrentPageContext()
  const { pathname } = useLocation()
  const placement = pageAssistantPlacement(pathname)
  const enabled = placement !== "none"
  const bare = pageWidth(pathname) === "bare"
  const open = useSyncExternalStore(
    assistantWindow.subscribe,
    assistantWindow.getSnapshot,
    assistantWindow.getSnapshot
  )
  const { inset, availableHeight } = useAssistantLayout(enabled)
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
  useEffect(() => closeAssistant(), [pathname])
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
            .getElementById("page-assistant-input")
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
        "pointer-events-none flex flex-col pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pl-[max(env(safe-area-inset-left),0.625rem)] pr-[max(env(safe-area-inset-right),0.625rem)]",
        demo.status === "running" && "hidden",
        bare
          ? "fixed inset-x-0 z-30 mx-auto max-w-md"
          : cn(FIXED_COLUMN, "z-30 lg:max-w-xl")
      )}
      style={
        {
          bottom: inset,
          maxHeight: `max(0px, calc(${availableHeight === undefined ? "100dvh" : `${availableHeight}px`} - max(env(safe-area-inset-top), 0.5rem)))`,
          "--assistant-height": "min(28rem, 65dvh)",
        } as CSSProperties
      }
    >
      <Card
        id="page-assistant-panel"
        hidden={!active}
        className={cn(
          "pointer-events-auto min-h-0 gap-0 overflow-hidden rounded-2xl border-border/80 py-0 shadow-lg shadow-foreground/5",
          open && "max-h-[var(--assistant-height)]",
          !active && "hidden",
          !user && "overflow-y-auto overscroll-contain"
        )}
      >
        {open && (
          <CardHeader className="shrink-0 border-b px-3 py-1">
            <div className="flex items-center gap-3">
              <p
                className="min-w-0 flex-1 truncate text-sm font-semibold"
                title={`熊熊滾 · ${page.title}`}
              >
                熊熊滾 · {page.title}
              </p>
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
                      .getElementById("page-assistant-input")
                      ?.focus({ preventScroll: true })
                  )
                }}
              >
                <ChevronDown className="size-5" />
              </Button>
            </div>
          </CardHeader>
        )}
        {user ? (
          <LearningAiGate embedded compact active={active}>
            <AssistantContent open={open && active} active={active} />
          </LearningAiGate>
        ) : (
          <SignedOutAssistant />
        )}
      </Card>
    </div>
  )
}

function SignedOutAssistant() {
  const { pathname, search, state } = useLocation()
  const from =
    (state as { from?: string } | null)?.from ??
    (pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/auth/")
      ? "/"
      : pathname + search)
  return (
    <section className="flex min-h-14 items-center gap-2 p-2" aria-label="AI 助理登入提示">
      <Mascot size={28} bust className="shrink-0" />
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">
        登入後就能問熊熊滾
      </p>
      <Button asChild className="h-11 shrink-0 px-3">
        <Link to="/login" state={{ from }}>
          登入提問
        </Link>
      </Button>
    </section>
  )
}

function AssistantContent({
  open,
  active,
}: {
  open: boolean
  active: boolean
}) {
  const user = useAuth()?.user
  const page = useCurrentPageContext()
  const startDemo = useStartUiDemo()
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
  const [voiceOn, setVoiceOn] = useState(false)
  if (!active && voiceOn) setVoiceOn(false)
  const [session, setSession] = useState<VoiceSession | null>(null)
  const [VoiceDock, setVoiceDock] = useState(() => lazy(loadVoiceDock))
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
      inputRef.current?.focus({ preventScroll: true })
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

  async function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy || preparingRef.current) return
    openAssistant()
    const snapshot = {
      path: page.path,
      title: page.title,
      facts: [...page.facts],
    }
    setQuestion("")
    if (session && open && !requestedUiDemo(trimmed, snapshot.path)) {
      session.sendText(trimmed)
      return
    }
    if (session) setVoiceOn(false)
    const file = files[0]?.file
    setFiles([])
    setPickError(null)
    preparingRef.current = true
    setPreparing(true)
    try {
      const ready = file ? await shrinkPhoto(file) : undefined
      if (!asking.polls.aborted) {
        await asking.ask(trimmed, ready, snapshot)
        const reply = conversation.getSnapshot().at(-1)
        if (!asking.polls.aborted && reply?.kind === "model" && reply.demo) {
          inputRef.current?.blur()
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
  const replaceAsk = (id: number, patch: { ask: Ask }) =>
    conversation.replace(id, patch)
  const failVoice = () => {
    setVoiceOn(false)
    setNotice({
      text: "語音載入失敗，請重新整理後再試。打字仍可使用。",
      retryByReload: true,
    })
    setVoiceDock(() => lazy(loadVoiceDock))
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
          {entries.map((entry) => (
            <div
              key={entry.id}
              id={`ask-entry-${entry.id}`}
              tabIndex={-1}
              className="min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <EntryView
                entry={entry}
                onAskChange={replaceAsk}
                onAskAsTyped={(id) => void asking.askAsTyped(id)}
                busy={busy}
              />
            </div>
          ))}
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
        {active && voiceOn && (
          <VoiceBoundary onFail={failVoice}>
            <Suspense
              fallback={
                <p className="text-sm text-muted-foreground">載入語音中…</p>
              }
            >
              <VoiceDock
                conversation={conversation}
                polls={asking.polls}
                page={page}
                onClose={() => {
                  setVoiceOn(false)
                  setNotice(null)
                }}
                onSession={setSession}
                onNotice={(text) => setNotice(text ? { text } : null)}
              />
            </Suspense>
          </VoiceBoundary>
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
              className="size-11 shrink-0"
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
            maxLength={500}
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
            placeholder={
              session
                ? "打字也能問"
                : files.length
                  ? "想問檔案的什麼？"
                  : busy
                    ? "先寫下下一題…"
                    : "輸入問題…"
            }
            aria-label="輸入問題"
            className="max-h-[min(6rem,24dvh)] min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border-0 bg-transparent px-1 py-2.5 text-base shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
          />
          <div className="flex shrink-0 items-center">
            {!session && (
              <AttachButton onPick={pick} disabled={busy} multiple={false} />
            )}
            {!voiceOn && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                disabled={busy}
                onClick={() => {
                  setNotice(null)
                  setVoiceOn(true)
                  openAssistant()
                }}
                aria-label="用說的問"
              >
                <Mic className="size-4" />
              </Button>
            )}
            <Button
              type="submit"
              size="icon"
              className="ml-auto size-11 shrink-0 rounded-xl shadow-none active:transform-none"
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

class VoiceBoundary extends Component<
  { onFail: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

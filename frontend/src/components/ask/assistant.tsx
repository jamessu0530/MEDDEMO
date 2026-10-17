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
import { pageContextFor } from "@/ask/page-context"
import {
  shouldAcceptSuggestion,
  suggestedCompletion,
} from "@/ask/question-guidance"
import { useQuestionGuidance } from "@/ask/use-question-guidance"
import { useAssistantInset } from "@/ask/use-assistant-inset"
import { EntryView } from "@/components/ask/entry-view"
import {
  QuestionSuggestions,
  SuggestionHint,
} from "@/components/ask/question-suggestions"
import type { VoiceSession } from "@/components/ask/voice-dock"
import { AttachButton, DraftFiles } from "@/components/attachments/draft-files"
import { LearningAiGate } from "@/components/learning/ai-gate"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Card, CardFooter, CardHeader } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PageDemoButton } from "@/components/ui-demo/page-demo-button"
import { Textarea } from "@/components/ui/textarea"
import { addDraftFiles, shrinkPhoto, type DraftFile } from "@/lib/attachments"
import { useAuth } from "@/lib/auth"
import { askScopeText } from "@/lib/scope"
import { FIXED_COLUMN } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"
import { uiDemo } from "@/lib/ui-demo-browser"

const loadVoiceDock = () => import("@/components/ask/voice-dock")

/** 所有頁面共用對話與草稿；已有操作列的頁面由浮動按鈕展開。 */
export function Assistant() {
  const user = useAuth()?.user
  const page = useCurrentPageContext()
  const { pathname } = useLocation()
  const floating = pageAssistantPlacement(pathname) === "floating"
  const inset = useAssistantInset(true, floating)
  const open = useSyncExternalStore(
    assistantWindow.subscribe,
    assistantWindow.getSnapshot,
    assistantWindow.getSnapshot
  )
  const demo = useSyncExternalStore(
    uiDemo.subscribe,
    uiDemo.getSnapshot,
    uiDemo.getSnapshot
  )
  const active = !floating || open
  const dockRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (floating) {
      document.documentElement.style.removeProperty(
        "--page-assistant-dock-space"
      )
      return
    }
    if (open || !dockRef.current) return
    const element = dockRef.current
    const update = () =>
      document.documentElement.style.setProperty(
        "--page-assistant-dock-space",
        `${Math.ceil(element.getBoundingClientRect().height + inset)}px`
      )
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [floating, open, inset])
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(
        "--page-assistant-dock-space"
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
        document
          .getElementById(
            floating ? "page-assistant-launcher" : "page-assistant-input"
          )
          ?.focus({ preventScroll: true })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, active, floating])
  return (
    <div
      ref={dockRef}
      data-page-assistant
      hidden={demo.status === "running"}
      data-placement={floating ? "floating" : "dock"}
      className={cn(
        "pointer-events-none",
        demo.status === "running" && "hidden",
        floating
          ? "fixed right-2.5 z-40 w-[calc(100%-1.25rem)] max-w-md pb-[max(env(safe-area-inset-bottom),0.5rem)]"
          : cn(FIXED_COLUMN, "z-30 px-2.5 py-2 lg:max-w-xl")
      )}
      style={
        {
          bottom: inset,
          "--assistant-height": `min(36rem, calc(100dvh - ${inset}px - ${floating ? 5 : 1}rem))`,
        } as CSSProperties
      }
    >
      <div
        id="page-assistant-panel"
        hidden={!active}
        className={cn(
          "pointer-events-auto",
          !active && "hidden",
          floating && "mb-2 overflow-y-auto overscroll-contain"
        )}
        style={
          floating
            ? { maxHeight: `calc(100dvh - ${inset}px - 5rem)` }
            : undefined
        }
      >
        <div data-ui-demo-entry className="flex justify-end">
          <PageDemoButton />
        </div>
        {user ? (
          <LearningAiGate embedded compact active={active}>
            <AssistantContent
              open={open && active}
              active={active}
              floating={floating}
            />
          </LearningAiGate>
        ) : (
          <SignedOutAssistant />
        )}
      </div>
      {floating && (
        <div className="flex items-center justify-end gap-2">
          {!open && user && (
            <button
              type="button"
              onClick={openAssistant}
              className="pointer-events-auto min-h-11 max-w-52 min-w-0 rounded-2xl border border-border/60 bg-background/95 px-3 py-2 text-left text-xs leading-relaxed text-muted-foreground shadow-sm sm:max-w-64"
            >
              <span className="block text-[10px] opacity-70">
                在{page.title}可以問
              </span>
              <span className="line-clamp-2">{page.suggestions[0]}</span>
            </button>
          )}
          <Button
            id="page-assistant-launcher"
            type="button"
            className="pointer-events-auto h-12 gap-2 rounded-full px-4 shadow-lg"
            aria-label={open ? "收起 AI 助理" : "開啟 AI 助理"}
            aria-expanded={open}
            aria-controls="page-assistant-panel"
            onClick={() => (open ? closeAssistant() : openAssistant())}
          >
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <Mascot size={28} bust />
            )}
            {open ? "收起助理" : "AI 助理"}
          </Button>
        </div>
      )}
    </div>
  )
}

function SignedOutAssistant() {
  const { pathname, search, state } = useLocation()
  const page = pageContextFor(pathname, search)
  const from =
    (state as { from?: string } | null)?.from ??
    (pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/auth/")
      ? "/"
      : pathname + search)
  return (
    <section
      className="rounded-2xl border bg-card p-4 shadow-lg"
      aria-label="AI 助理登入提示"
    >
      <p className="text-sm font-semibold text-primary">
        熊熊滾 · {page.title}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        登入後就能在每個頁面問熊熊滾，查詢你有權限查看的公司資料。
      </p>
      <Button asChild className="mt-3 w-full">
        <Link to="/login" state={{ from }}>
          登入使用 AI 助理
        </Link>
      </Button>
    </section>
  )
}

function AssistantContent({
  open,
  active,
  floating,
}: {
  open: boolean
  active: boolean
  floating: boolean
}) {
  const user = useAuth()?.user
  const page = useCurrentPageContext()
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
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const entries = useConversation(conversation).filter(
    (entry) => entry.kind === "tool" || entry.text.trim()
  )
  const busy = sending || preparing
  const guidance = useQuestionGuidance(
    page,
    entries,
    busy || Boolean(session),
    active
  )
  const inputSuggestions = files.length ? [] : guidance.suggestions
  const completion = suggestedCompletion(question, inputSuggestions)

  function fillQuestion(text: string) {
    setQuestion(text)
    session?.noteActivity()
    inputRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ block: "nearest" })
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [open])
  useEffect(() => {
    if (open)
      bottomRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
  }, [entries.length, open])

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
    if (session && open) {
      session.sendText(trimmed)
      return
    }
    const file = files[0]?.file
    setFiles([])
    setPickError(null)
    preparingRef.current = true
    setPreparing(true)
    try {
      const ready = file ? await shrinkPhoto(file) : undefined
      if (!asking.polls.aborted) await asking.ask(trimmed, ready, snapshot)
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
    <Card
      className={cn(
        "gap-0 overflow-hidden rounded-2xl border-border/80 shadow-xl shadow-foreground/10",
        open && "h-[var(--assistant-height)]"
      )}
    >
      <CardHeader
        hidden={!open}
        className={cn(
          "shrink-0 flex-row items-center gap-3 border-b bg-muted/20 px-4 py-3",
          !open && "hidden"
        )}
      >
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10"
          aria-hidden="true"
        >
          <Mascot state={busy ? "think" : "hi"} size={38} bust />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold"
            title={`熊熊滾 · ${page.title}`}
          >
            熊熊滾 · {page.title}
          </p>
          {user && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {askScopeText(user)}
            </p>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-11 shrink-0 rounded-xl text-muted-foreground"
          aria-label="收起 AI 回覆"
          onClick={() => {
            closeAssistant()
            if (floating)
              document
                .getElementById("page-assistant-launcher")
                ?.focus({ preventScroll: true })
            else inputRef.current?.focus({ preventScroll: true })
          }}
        >
          <ChevronDown className="size-5" />
        </Button>
      </CardHeader>
      <ScrollArea
        id="page-assistant-answers"
        hidden={!open}
        role="region"
        aria-label="與熊熊滾的共用對話"
        className={cn(
          "min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:overscroll-contain",
          !open && "hidden"
        )}
      >
        <div className="flex flex-col gap-5 px-4 py-5 [overflow-wrap:anywhere]">
          {entries.length === 0 && (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-base font-semibold">今天需要幫忙什麼？</p>
              <p className="-mt-1 text-sm leading-relaxed text-muted-foreground">
                {page.hint}
              </p>
              <div className="mt-1 flex w-full flex-col gap-2">
                {guidance.suggestions.map((example) => (
                  <Button
                    key={example}
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => fillQuestion(example)}
                    className="min-h-11 justify-start rounded-xl border px-3 py-2.5 text-left text-sm whitespace-normal shadow-none active:transform-none"
                  >
                    {example}
                  </Button>
                ))}
              </div>
            </div>
          )}
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
              {guidance.replyId === entry.id && (
                <div className="mt-3 px-1">
                  <QuestionSuggestions
                    suggestions={guidance.suggestions}
                    onSelect={fillQuestion}
                  />
                </div>
              )}
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
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <CardFooter
        className={cn(
          "shrink-0 flex-col items-stretch gap-2 p-2.5",
          open && "border-t bg-muted/10 p-3"
        )}
      >
        <p
          id="page-assistant-guidance"
          className="px-1 text-xs leading-relaxed text-muted-foreground"
        >
          {guidance.hint}
        </p>
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
          className="flex flex-col gap-2 rounded-xl border bg-muted/25 p-1.5 transition-shadow focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10"
        >
          {pickError && (
            <p role="alert" className="px-2 pt-1 text-xs text-destructive">
              {pickError}
            </p>
          )}
          {!session && files.length > 0 && (
            <div className="px-2 pt-2">
              <DraftFiles
                files={files}
                onRemove={() => setFiles([])}
                disabled={busy}
              />
            </div>
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
              if (shouldAcceptSuggestion(event, completion)) {
                event.preventDefault()
                fillQuestion(completion!)
                return
              }
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
                  : inputSuggestions[0] ||
                    (busy
                      ? "可以先寫下下一個問題…"
                      : "補充細節，或輸入你的問題…")
            }
            aria-label="輸入問題"
            aria-describedby={`page-assistant-guidance${completion ? " page-assistant-completion" : ""}`}
            className="max-h-32 min-h-11 min-w-0 resize-none overflow-y-auto rounded-lg border-0 bg-transparent px-2.5 py-2.5 text-base shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
          />
          {completion && (
            <SuggestionHint
              id="page-assistant-completion"
              suggestion={completion}
              onAccept={() => fillQuestion(completion)}
            />
          )}
          <div className="flex items-center gap-1">
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
                <Mascot state={busy ? "think" : "hi"} size={32} bust />
              </Button>
            )}
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
            <span className="ml-1 hidden flex-1 text-xs text-muted-foreground sm:block">
              Shift + Enter 換行
            </span>
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
    </Card>
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

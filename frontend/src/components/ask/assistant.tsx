import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { ChevronDown, Loader2, Mic, SendHorizontal } from "@/components/icons"
import { useLocation } from "react-router"

import type { Ask } from "@/api/asks"
import { askSessionFor } from "@/ask/ask-session"
import {
  assistantWindow,
  closeAssistant,
  openAssistant,
} from "@/ask/assistant-window"
import { useConversation } from "@/ask/use-conversation"
import { useCurrentPageContext } from "@/ask/use-page-context"
import { hasPageAssistant } from "@/ask/page-assistant"
import { useAssistantInset } from "@/ask/use-assistant-inset"
import { EntryView } from "@/components/ask/entry-view"
import type { VoiceSession } from "@/components/ask/voice-dock"
import { AttachButton, DraftFiles } from "@/components/attachments/draft-files"
import { LearningAiGate } from "@/components/learning/ai-gate"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addDraftFiles, shrinkPhoto, type DraftFile } from "@/lib/attachments"
import { useAuth } from "@/lib/auth"
import { askScopeText } from "@/lib/scope"
import { FIXED_COLUMN } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"

const loadVoiceDock = () => import("@/components/ask/voice-dock")

/** 各頁的底部輸入列；共用對話與草稿，答案直接在輸入列上方展開。 */
export function Assistant() {
  const user = useAuth()?.user
  const { pathname, search } = useLocation()
  const active = hasPageAssistant(pathname, search)
  const inset = useAssistantInset(active)
  const open = useSyncExternalStore(
    assistantWindow.subscribe,
    assistantWindow.getSnapshot
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
          .getElementById("page-assistant-input")
          ?.focus({ preventScroll: true })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, active])
  if (!user) return null
  return (
    <div
      data-page-assistant
      hidden={!active}
      className={cn(
        FIXED_COLUMN,
        "pointer-events-none z-30 px-2.5 py-2",
        !active && "hidden"
      )}
      style={{ bottom: inset }}
    >
      <div className="pointer-events-auto">
        <LearningAiGate embedded compact active={active}>
          <AssistantContent open={open && active} active={active} />
        </LearningAiGate>
      </div>
    </div>
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
  const asking = askSessionFor(user?.id ?? "")
  const conversation = asking.conversation
  const sending = useSyncExternalStore(asking.subscribe, asking.isBusy)
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
  const inputRef = useRef<HTMLInputElement>(null)
  const entries = useConversation(conversation).filter(
    (entry) => entry.kind === "tool" || entry.text.trim()
  )
  const busy = sending || preparing

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
    <>
      <section
        id="page-assistant-answers"
        hidden={!open}
        aria-label="與熊熊滾的共用對話"
        className={cn(
          "mb-2 max-h-[min(42dvh,24rem)] overflow-y-auto overscroll-contain rounded-2xl border bg-card p-3 shadow-lg",
          !open && "hidden"
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-primary">
              熊熊滾 · {page.title}
            </p>
            {user && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {askScopeText(user)}
              </p>
            )}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9 shrink-0"
            aria-label="收起 AI 回覆"
            onClick={() => {
              closeAssistant()
              inputRef.current?.focus({ preventScroll: true })
            }}
          >
            <ChevronDown className="size-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {entries.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                可以接著{page.title}問，也能延續其他頁的對話
              </p>
              {page.suggestions.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={busy}
                  onClick={() => void submit(example)}
                  className="min-h-11 rounded-xl border bg-card px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              id={`ask-entry-${entry.id}`}
              tabIndex={-1}
              className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          <div ref={bottomRef} />
        </div>
      </section>
      <div className="flex flex-col gap-2 rounded-2xl border-2 bg-background/95 p-2 shadow-lip backdrop-blur">
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
          className="flex flex-col gap-1.5"
        >
          {pickError && <p className="text-xs text-destructive">{pickError}</p>}
          {!session && (
            <DraftFiles
              files={files}
              onRemove={() => setFiles([])}
              disabled={busy}
            />
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              className="flex w-8 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
              aria-label={open ? "收起共用對話" : "展開共用對話"}
              aria-expanded={open}
              aria-controls="page-assistant-answers"
              onClick={() => (open ? closeAssistant() : openAssistant())}
            >
              <Mascot state={busy ? "think" : "hi"} size={32} bust />
            </button>
            {!session && (
              <AttachButton onPick={pick} disabled={busy} multiple={false} />
            )}
            <Input
              id="page-assistant-input"
              ref={inputRef}
              value={question}
              maxLength={500}
              onChange={(event) => {
                setQuestion(event.target.value)
                session?.noteActivity()
              }}
              placeholder={
                session
                  ? "打字也能問"
                  : files.length
                    ? "想問檔案的什麼？"
                    : `問問${page.title}…`
              }
              aria-label="輸入問題"
              className="h-12 min-w-0 border-0 bg-transparent px-1 shadow-none"
            />
            {!voiceOn && (
              <Button
                type="button"
                variant="outline"
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
              className="size-11 shrink-0"
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
      </div>
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

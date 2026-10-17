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
import { Loader2, Mic, Minus, Send } from "@/components/icons"

import type { Ask } from "@/api/asks"
import { askSessionFor } from "@/ask/ask-session"
import {
  assistantWindow,
  closeAssistant,
  openAssistant,
} from "@/ask/assistant-window"
import { useConversation } from "@/ask/use-conversation"
import { useCurrentPageContext } from "@/ask/use-page-context"
import { EntryView } from "@/components/ask/entry-view"
import { AskMemoryMap } from "@/components/ask/memory-map"
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
import { cn } from "@/lib/utils"

const loadVoiceDock = () => import("@/components/ask/voice-dock")

/** 掛在登入外框中，所有頁面共用同一扇窗；收起時保留文字草稿、對話與查詢。 */
export function Assistant() {
  const user = useAuth()?.user
  const open = useSyncExternalStore(
    assistantWindow.subscribe,
    assistantWindow.getSnapshot
  )
  const [visited, setVisited] = useState(false)
  if (open && !visited) setVisited(true)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const close = () => {
    closeAssistant()
    trigger.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      const dialog =
        event.target instanceof Element
          ? event.target.closest('[role="dialog"]')
          : null
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        (!dialog || dialog === panel.current)
      ) {
        closeAssistant()
        trigger.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
  if (!user) return null
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={open ? "熊熊滾助理已開啟" : "問熊熊滾"}
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={() => {
          setVisited(true)
          openAssistant()
        }}
        className={cn(
          "fixed right-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 flex min-h-12 items-center gap-2 rounded-full border-2 border-primary/25 bg-card px-3 py-1 shadow-lg lg:right-6 lg:bottom-5",
          open && "hidden"
        )}
      >
        <Mascot state="hi" size={40} bust />
        <span className="text-sm font-semibold">問熊熊滾</span>
      </button>
      {(open || visited) && (
        <section
          ref={panel}
          id="assistant-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="assistant-title"
          aria-describedby="assistant-context"
          hidden={!open}
          className={cn(
            "fixed right-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-2 z-40 flex h-[min(42rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-2xl border-2 bg-background shadow-2xl lg:right-5 lg:bottom-4 lg:left-auto lg:h-[min(46rem,calc(100dvh-2rem))] lg:w-[30rem] lg:max-w-[calc(100vw-16rem)]",
            !open && "hidden"
          )}
        >
          <header className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2.5">
            <Mascot state="hi" size={36} bust />
            <div className="min-w-0 flex-1">
              <h2 id="assistant-title" className="font-semibold">
                熊熊滾助理
              </h2>
              <p className="text-xs text-muted-foreground">
                直接問，也可以問其他頁面的事
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={close}
              aria-label="收起熊熊滾"
            >
              <Minus className="size-5" />
            </Button>
          </header>
          <LearningAiGate embedded active={open}>
            <AssistantContent open={open} />
          </LearningAiGate>
        </section>
      )}
    </>
  )
}

function AssistantContent({ open }: { open: boolean }) {
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
  if (!open && voiceOn) setVoiceOn(false)
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
      <div className="shrink-0 border-b bg-primary/5 px-4 py-2">
        <p
          id="assistant-context"
          className="truncate text-xs font-medium text-primary"
        >
          正在參考：{page.title}
        </p>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4"
        aria-label="與熊熊滾的對話"
      >
        <AskMemoryMap
          entries={entries}
          edits={asking.mapEdits}
          onJump={(id) =>
            requestAnimationFrame(() => {
              const element = document.getElementById(`ask-entry-${id}`)
              element?.scrollIntoView({ behavior: "smooth", block: "nearest" })
              element?.focus({ preventScroll: true })
            })
          }
        />
        <div className="mt-4 flex flex-col gap-4">
          {entries.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                可以接著這個頁面問，也能換個話題
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
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t bg-card p-3">
        {open && voiceOn && (
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
          {user && !session && (
            <p className="text-xs text-muted-foreground">
              {askScopeText(user)}
            </p>
          )}
          {pickError && <p className="text-xs text-destructive">{pickError}</p>}
          {!session && (
            <DraftFiles
              files={files}
              onRemove={() => setFiles([])}
              disabled={busy}
            />
          )}
          <div className="flex gap-1.5">
            {!session && (
              <AttachButton onPick={pick} disabled={busy} multiple={false} />
            )}
            <Input
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
                    : "直接問熊熊滾…"
              }
              aria-label="輸入問題"
              className="h-11 min-w-0 bg-background"
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
                <Send className="size-4" />
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

import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Loader2, Mic, Send } from "lucide-react"

import { type Ask, type AskKind } from "@/api/asks"
import { createConversation } from "@/ask/conversation"
import { runAsk } from "@/ask/run-ask"
import { useConversation } from "@/ask/use-conversation"
import { EntryView } from "@/components/ask/entry-view"
// type-only：只拿型別，不會把 VoiceDock（跟著它的 src/voice）拉進主 chunk
import type { VoiceSession } from "@/components/ask/voice-dock"
import { BottomNav } from "@/components/bottom-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth"
import { askScopeText } from "@/lib/scope"
import { cn } from "@/lib/utils"

// 整包 src/voice（Gemini Live SDK 與音訊處理）只從這裡進來，按了麥克風才載
const VoiceDock = lazy(() => import("@/components/ask/voice-dock"))

const MODES: { kind: AskKind; label: string; placeholder: string; examples: string[] }[] = [
  {
    kind: "data",
    label: "查數字",
    placeholder: "例如：北區這一季保健品為什麼掉？",
    examples: ["北區這一季保健品類為什麼下滑？", "哪幾家客戶進貨間隔拉長，但單次金額持平？"],
  },
  {
    kind: "knowledge",
    label: "查規定",
    placeholder: "例如：近效期的貨要多久前申請退貨？",
    examples: ["近效期的貨要多久前申請退貨？", "我可以直接給客戶幾趴折扣？"],
  },
]

/** 問答（原型 S-07）：打字與語音在同一條對話裡，兩種問法共用同一套查詢與查詢軌跡 */
export function AskPage() {
  const user = useAuth()?.user
  const [conversation] = useState(() => createConversation())
  const [kind, setKind] = useState<AskKind>("data")
  const [question, setQuestion] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceOn, setVoiceOn] = useState(false)
  const [session, setSession] = useState<VoiceSession | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const polls = useRef(new AbortController())
  const mode = MODES.find((m) => m.kind === kind)!
  // 模型還在講、逐字稿還沒出來的那一格先不顯示
  const entries = useConversation(conversation).filter((entry) => entry.kind === "tool" || entry.text.trim())

  // 離開頁面時停掉所有還在跑的輪詢。React 開發模式會先卸載再掛上一次，
  // 所以卸載時中止掉的 controller 要能換一個新的，否則重新掛上之後每一次查詢都會立刻被 abort
  useEffect(() => {
    if (polls.current.signal.aborted) polls.current = new AbortController()
    const controller = polls.current
    return () => controller.abort()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [entries.length])

  async function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setError(null)
    // 語音會話開著就送進同一個會話，模型保有上下文並用講的回答；entry 由 controller 加
    if (session) {
      session.sendText(trimmed)
      setQuestion("")
      return
    }
    setSending(true)
    conversation.addUtterance("user", "typed", trimmed)
    const entryId = conversation.addToolRun(kind, trimmed)
    setQuestion("")
    try {
      await runAsk(conversation, entryId, kind, trimmed, polls.current.signal)
    } catch (err) {
      if (polls.current.signal.aborted) return
      const message = err instanceof Error ? err.message : "送出失敗，請再試一次"
      conversation.replace(entryId, { error: message })
      setError(message)
    } finally {
      setSending(false)
    }
  }

  const replaceAsk = (id: number, patch: { ask: Ask }) => conversation.replace(id, patch)

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">先查公司資料與內部文件，查不到才參考網路公開資料（會另外標示）</p>
        <h1 className="mt-0.5 text-lg font-semibold">問答</h1>
        {/* 語音會話裡是模型自己選要查數字還是查規定，這組切換只對打字有用，開著會話時收起來 */}
        {!voiceOn && (
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {MODES.map((m) => (
              <button
                key={m.kind}
                type="button"
                onClick={() => setKind(m.kind)}
                className={cn(
                  "h-10 rounded-md text-sm font-medium",
                  kind === m.kind ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-44">
        {entries.length === 0 && !voiceOn && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">可以這樣問，或按右下角的麥克風用說的：</p>
            {mode.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => submit(example)}
                className="min-h-11 rounded-xl border bg-card px-4 py-2.5 text-left text-sm active:bg-muted"
              >
                {example}
              </button>
            ))}
          </div>
        )}
        {entries.map((entry) => (
          <EntryView key={entry.id} entry={entry} onAskChange={replaceAsk} />
        ))}
        <div ref={bottomRef} />
      </main>

      <div className="fixed inset-x-0 bottom-14 z-10 mx-auto flex max-w-md flex-col gap-1.5 border-t bg-background px-3 py-2">
        {voiceOn && (
          <Suspense
            fallback={
              <Button className="h-14 w-full gap-2 text-base" disabled>
                <Loader2 className="size-5 animate-spin" />
                載入中…
              </Button>
            }
          >
            <VoiceDock conversation={conversation} onClose={() => setVoiceOn(false)} onSession={setSession} />
          </Suspense>
        )}
        {/* 輸入框永遠顯示：會話開著時打字也送進同一個會話，跟語音共用同一條對話 */}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit(question)
          }}
          className="flex flex-col gap-1.5"
        >
          {error && <p className="px-1 text-sm text-destructive">{error}</p>}
          {/* 數字查詢只查得到登入者看得到的客戶；規定題查的是公司文件，不分客戶，不必提。會話中是模型自己選工具，這行文字對不上 */}
          {user && kind === "data" && !voiceOn && <p className="px-1 text-[11px] text-muted-foreground">{askScopeText(user)}</p>}
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value)
                session?.noteActivity()
              }}
              placeholder={session ? "也可以打字問，AI 會用講的回答" : mode.placeholder}
              aria-label="輸入問題"
              className="h-11 bg-card"
            />
            {!voiceOn && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                onClick={() => setVoiceOn(true)}
                aria-label="用說的問"
              >
                <Mic className="size-4" />
              </Button>
            )}
            <Button type="submit" size="icon" className="size-11 shrink-0" disabled={sending || !question.trim()} aria-label="送出">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </form>
      </div>
      <BottomNav />
    </div>
  )
}

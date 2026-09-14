import { useEffect, useRef, useState } from "react"
import { Loader2, Send } from "lucide-react"

import { createAsk, getAsk, isFinished, type Ask, type AskKind } from "@/api/asks"
import { AskAnswer, TracePanel } from "@/components/ask/ask-result"
import { BottomNav } from "@/components/bottom-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

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

/** 問答（原型 S-07）：數字題走反覆查詢，規定題走 CRAG，兩條線共用同一個畫面與查詢軌跡 */
export function AskPage() {
  const [kind, setKind] = useState<AskKind>("data")
  const [question, setQuestion] = useState("")
  const [asks, setAsks] = useState<Ask[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const mode = MODES.find((m) => m.kind === kind)!
  const pending = asks.filter((a) => !isFinished(a)).map((a) => a.id).join(",")

  // 還沒答完的提問每秒問一次進度（NFR-5），查到第幾輪會即時出現在畫面上
  useEffect(() => {
    if (!pending) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const updated = await Promise.all(pending.split(",").map((id) => getAsk(id, controller.signal)))
        setAsks((current) => current.map((a) => updated.find((u) => u.id === a.id) ?? a))
      } catch {
        // 網路一時不通就等下一輪
      } finally {
        if (!controller.signal.aborted) setTick((n) => n + 1)
      }
    }, 1000)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [pending, tick])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [asks.length])

  async function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError(null)
    try {
      const ask = await createAsk(kind, trimmed)
      setAsks((current) => [...current, ask])
      setQuestion("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "送出失敗，請再試一次")
    } finally {
      setSending(false)
    }
  }

  const replace = (next: Ask) => setAsks((current) => current.map((a) => (a.id === next.id ? next : a)))

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">答案只來自公司資料與內部文件</p>
        <h1 className="mt-0.5 text-lg font-semibold">問答</h1>
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
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-40">
        {asks.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">可以這樣問：</p>
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
        {asks.map((ask) => (
          <AskThread key={ask.id} ask={ask} onChange={replace} />
        ))}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit(question)
        }}
        className="fixed inset-x-0 bottom-14 z-10 mx-auto flex max-w-md gap-2 border-t bg-background px-3 py-2"
      >
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={mode.placeholder}
          aria-label="輸入問題"
          className="h-11 bg-card"
        />
        <Button type="submit" size="icon" className="size-11 shrink-0" disabled={sending || !question.trim()} aria-label="送出">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
      {error && <p className="fixed inset-x-0 bottom-28 mx-auto max-w-md px-4 text-sm text-destructive">{error}</p>}
      <BottomNav />
    </div>
  )
}

function AskThread({ ask, onChange }: { ask: Ask; onChange: (ask: Ask) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="ml-10 self-end rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        {ask.question}
      </p>
      <div className="mr-4 rounded-2xl rounded-bl-md border bg-card px-4 py-3">
        <AskAnswer ask={ask} onChange={onChange} />
        {ask.trace.length > 0 && <TracePanel trace={ask.trace} live={!isFinished(ask)} />}
      </div>
    </section>
  )
}

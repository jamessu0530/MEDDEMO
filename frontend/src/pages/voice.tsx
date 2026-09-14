import { useEffect, useRef } from "react"
import { AudioLines, Hand, Loader2, Mic, PhoneOff } from "lucide-react"

import { isFinished, type Ask } from "@/api/asks"
import { AskAnswer, TracePanel } from "@/components/ask/ask-result"
import { BottomNav } from "@/components/bottom-nav"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { useVoiceSession } from "@/voice/use-voice-session"
import type { Entry, ToolRun } from "@/voice/voice-controller"

const EXAMPLES = ["北區這一季保健品為什麼掉？", "近效期的貨要多久前申請退貨？"]
const TOOL_LABEL = { data: "查數字", knowledge: "查規定" }

/** 語音問答：用講的問，AI 先查公司資料再用講的回答；查到的表格與出處同時列在畫面上 */
export default function VoicePage() {
  const voice = useVoiceSession()
  const bottomRef = useRef<HTMLDivElement>(null)
  // 模型還在講、逐字稿還沒出來的那一格先不顯示
  const entries = voice.entries.filter((entry) => entry.kind === "tool" || entry.text.trim())

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [entries.length])

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">答案只來自公司資料與內部文件</p>
        <h1 className="mt-0.5 text-lg font-semibold">語音問答</h1>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-44">
        {entries.length === 0 && voice.status === "idle" && !voice.notice && <Intro />}
        {entries.map((entry) => (
          <EntryView key={entry.id} entry={entry} onAskChange={voice.replaceAsk} />
        ))}
        {voice.notice && <Notice text={voice.notice} action={{ label: "重新開始", onClick: voice.start }} />}
        <div ref={bottomRef} />
      </main>

      <div className="fixed inset-x-0 bottom-14 z-10 mx-auto max-w-md border-t bg-background px-4 py-3">
        <Controls voice={voice} />
      </div>
      <BottomNav />
    </div>
  )
}

function Intro() {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">按「開始對話」之後直接用說的問，例如：</p>
      {EXAMPLES.map((example) => (
        <p key={example} className="rounded-xl border bg-card px-4 py-2.5">
          「{example}」
        </p>
      ))}
      <p className="text-xs leading-relaxed text-muted-foreground">
        AI 會先查公司資料再回答，查到的表格和出處會列在這裡。查資料時會有提示音；AI 說話或查資料時會暫停收音，要插話就按「打斷」。
      </p>
    </div>
  )
}

type Voice = ReturnType<typeof useVoiceSession>

function Controls({ voice }: { voice: Voice }) {
  if (voice.status === "idle") {
    return (
      <Button className="h-14 w-full gap-2 text-base" onClick={voice.start}>
        <Mic className="size-5" />
        開始對話
      </Button>
    )
  }
  if (voice.status === "connecting") {
    return (
      <Button className="h-14 w-full gap-2 text-base" disabled>
        <Loader2 className="size-5 animate-spin" />
        連線中…
      </Button>
    )
  }
  const speaking = voice.status === "speaking"
  const label = speaking ? "AI 回答中" : voice.pending > 0 ? "查詢中…" : "聆聽中，直接說"
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex size-12 shrink-0 items-center justify-center" aria-hidden>
        {/* 外圈跟著麥克風音量放大，看得出有收到聲音 */}
        <span
          className="absolute inset-0 rounded-full bg-primary/25 transition-transform duration-100"
          style={{ transform: `scale(${1 + Math.min(voice.level * 6, 0.7)})` }}
        />
        <span className="relative flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {speaking ? <AudioLines className="size-5" /> : <Mic className="size-5" />}
        </span>
      </span>
      <p className="flex-1 text-sm font-medium" aria-live="polite">
        {label}
      </p>
      {speaking && (
        <Button variant="outline" className="h-11 gap-1.5" onClick={voice.interrupt}>
          <Hand className="size-4" />
          打斷
        </Button>
      )}
      <Button variant="outline" className="h-11 gap-1.5 text-destructive" onClick={voice.stop}>
        <PhoneOff className="size-4" />
        結束
      </Button>
    </div>
  )
}

function EntryView({ entry, onAskChange }: { entry: Entry; onAskChange: (entryId: number, ask: Ask) => void }) {
  if (entry.kind === "tool") return <ToolCard run={entry} onAskChange={onAskChange} />
  if (entry.kind === "user") {
    // 這一句是 Gemini 另外做的語音轉文字，常有同音錯字；AI 查資料用的是它自己聽懂的問題（寫在查詢卡片上）
    return (
      <div className="ml-10 flex flex-col items-end gap-1 self-end">
        <p className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{entry.text}</p>
        <p className="text-[11px] text-muted-foreground">語音辨識，僅供參考</p>
      </div>
    )
  }
  return (
    <p className="mr-10 self-start rounded-2xl rounded-bl-md border bg-card px-4 py-2.5 text-sm leading-relaxed">
      {entry.text}
    </p>
  )
}

/** AI 呼叫查詢工具的那一步：跟打字問答同一套查詢，結果、依據與查詢過程都看得到 */
function ToolCard({ run, onAskChange }: { run: ToolRun; onAskChange: (entryId: number, ask: Ask) => void }) {
  return (
    <section className="mr-4 rounded-2xl border border-dashed bg-card px-4 py-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {run.askKind ? TOOL_LABEL[run.askKind] : "查詢"}：{run.question || "（沒有問題內容）"}
      </p>
      {run.error ? (
        <p className="text-sm text-destructive">{run.error}</p>
      ) : run.ask ? (
        <AskAnswer ask={run.ask} onChange={(ask) => onAskChange(run.id, ask)} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          送出查詢…
        </p>
      )}
      {run.ask && run.ask.trace.length > 0 && <TracePanel trace={run.ask.trace} live={!isFinished(run.ask)} />}
      {run.cancelled && <p className="mt-2 text-xs text-muted-foreground">對話已經不需要這個結果，查到的內容仍保留在這裡。</p>}
    </section>
  )
}

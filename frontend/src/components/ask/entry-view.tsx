import { isFinished, type Ask } from "@/api/asks"
import type { Entry, ToolRun } from "@/ask/conversation"
import { AskAnswer, TracePanel } from "@/components/ask/ask-result"
import { AttachmentGallery } from "@/components/attachments/attachment-gallery"
import { Mascot } from "@/components/mascot"

const TOOL_LABEL = { data: "查數字", knowledge: "查規定", memory: "查頻道" }

export function EntryView({
  entry,
  onAskChange,
}: {
  entry: Entry
  onAskChange: (entryId: number, patch: { ask: Ask }) => void
}) {
  if (entry.kind === "tool") return <ToolCard run={entry} onAskChange={onAskChange} />
  if (entry.kind === "user") {
    // 語音那句是 Gemini 另外做的語音轉文字，常有同音錯字；打字的是業務原文，不必標
    return (
      <div className="ml-10 flex flex-col items-end gap-1 self-end">
        <p className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{entry.text}</p>
        {entry.attachment && <AttachmentGallery attachments={[entry.attachment]} className="w-56 max-w-full items-end" />}
        {entry.source === "voice" && <p className="text-[11px] text-muted-foreground">語音辨識，僅供參考</p>}
      </div>
    )
  }
  return (
    <p className="mr-10 self-start rounded-2xl rounded-bl-md border-2 bg-card px-4 py-2.5 text-sm leading-relaxed">
      {entry.text}
    </p>
  )
}

/** AI 呼叫查詢工具的那一步：跟打字問答同一套查詢，結果、依據與查詢過程都看得到 */
function ToolCard({
  run,
  onAskChange,
}: {
  run: ToolRun
  onAskChange: (entryId: number, patch: { ask: Ask }) => void
}) {
  return (
    <section className="mr-4 rounded-2xl border border-dashed bg-card px-4 py-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {run.askKind ? TOOL_LABEL[run.askKind] : "查詢"}：{run.question || "（沒有問題內容）"}
      </p>
      {run.error ? (
        <p className="text-sm text-destructive">{run.error}</p>
      ) : run.ask ? (
        <AskAnswer ask={run.ask} onChange={(ask) => onAskChange(run.id, { ask })} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mascot state="think" size={28} bust className="shrink-0 rounded-full bg-accent" />
          送出查詢…
        </p>
      )}
      {run.ask && run.ask.trace.length > 0 && <TracePanel trace={run.ask.trace} live={!isFinished(run.ask)} />}
      {run.cancelled && <p className="mt-2 text-xs text-muted-foreground">對話已經不需要這個結果，查到的內容仍保留在這裡。</p>}
    </section>
  )
}

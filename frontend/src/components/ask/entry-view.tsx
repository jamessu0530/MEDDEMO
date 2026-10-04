import type { ReactNode } from "react"

import { ASK_KINDS, isFinished, type Ask, type AskKind } from "@/api/asks"
import type { Entry, ToolRun } from "@/ask/conversation"
import { AskAnswer, TracePanel } from "@/components/ask/ask-result"
import { AttachmentGallery } from "@/components/attachments/attachment-gallery"
import { Mascot } from "@/components/mascot"

const TOOL_LABEL = { data: "查數字", knowledge: "查規定", memory: "查頻道" }
// 請業務選要查哪一種時，每個按鈕下面的一句說明：查得到什麼
const KIND_HINT = { data: "業績、進貨、帳款這類數字", knowledge: "公司規定、文件或網路資料", memory: "同事在頻道說過的" }

type EntryViewProps = {
  entry: Entry
  onAskChange: (entryId: number, patch: { ask: Ask }) => void
  /** 業務選了要查哪一種（等他選的那一格，或自動判斷完想換一種重查） */
  onChoose: (entryId: number, kind: AskKind) => void
  /** 看了前文改寫的意思不對：用業務原本打的那句重查 */
  onAskAsTyped: (entryId: number) => void
  /** 有一題還在查：選種類的按鈕先停用，按了也不會送 */
  busy: boolean
}

export function EntryView({ entry, ...actions }: EntryViewProps) {
  if (entry.kind === "tool") return <ToolCard run={entry} {...actions} />
  if (entry.kind === "user") {
    // 語音那句是 Gemini 另外做的語音轉文字，常有同音錯字；打字的是業務原文，不必標
    return (
      <div className="ml-10 flex flex-col items-end gap-1 self-end">
        <p className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{entry.text}</p>
        {entry.attachment && <AttachmentGallery attachments={[entry.attachment]} className="w-56 max-w-full items-end" />}
        {entry.source === "voice" && <p className="text-[0.6875rem] text-muted-foreground">語音辨識，僅供參考</p>}
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
function ToolCard({ run, onAskChange, onChoose, onAskAsTyped, busy }: Omit<EntryViewProps, "entry"> & { run: ToolRun }) {
  const done = run.error !== null || (run.ask !== null && isFinished(run.ask))
  return (
    <section className="mr-4 rounded-2xl border border-dashed bg-card px-4 py-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {run.askKind ? TOOL_LABEL[run.askKind] : "查詢"}
        {run.auto && "（自動判斷）"}：{run.question || "（沒有問題內容）"}
      </p>
      {/* 改寫可能誤會意思：讓業務看得到實際查的是哪一句、是從哪一句補出來的 */}
      {run.original && (
        <p className="-mt-1 mb-2 text-[0.6875rem] text-muted-foreground">接著前面的對話，把「{run.original}」補成完整的問題</p>
      )}
      {run.routing ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mascot state="think" size={28} bust className="shrink-0 rounded-full bg-accent" />
          {run.askKind ? "看一下前面聊了什麼…" : "判斷要查哪一種…"}
        </p>
      ) : run.choices ? (
        <KindPicker
          // 三種都列：這次沒能判斷（Jev 沒回答）；兩種：這句話兩種都說得通
          prompt={run.choices.length === ASK_KINDS.length ? "這次沒能自動判斷，你想查哪一種？" : "這句話兩種都說得通，你想查哪一種？"}
          kinds={run.choices}
          onPick={(kind) => onChoose(run.id, kind)}
          disabled={busy}
        />
      ) : run.error ? (
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
      {run.askKind && done && (run.auto || run.original) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
          不是要查這個？
          {run.original && (
            <LinkButton disabled={busy} onClick={() => onAskAsTyped(run.id)}>
              照原話查
            </LinkButton>
          )}
          {run.auto &&
            ASK_KINDS.filter((kind) => kind !== run.askKind).map((kind) => (
              <LinkButton key={kind} disabled={busy} onClick={() => onChoose(run.id, kind)}>
                改{TOOL_LABEL[kind]}
              </LinkButton>
            ))}
        </div>
      )}
      {run.cancelled && <p className="mt-2 text-xs text-muted-foreground">對話已經不需要這個結果，查到的內容仍保留在這裡。</p>}
    </section>
  )
}

function LinkButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-8 font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function KindPicker({
  prompt,
  kinds,
  onPick,
  disabled,
}: {
  prompt: string
  kinds: AskKind[]
  onPick: (kind: AskKind) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm">
        <Mascot state="hi" size={28} bust className="shrink-0 rounded-full bg-accent" />
        {prompt}
      </p>
      <div className="flex flex-col gap-1.5">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={disabled}
            onClick={() => onPick(kind)}
            className="min-h-11 rounded-xl border-2 bg-background px-3 py-2 text-left shadow-lip press disabled:opacity-50"
          >
            <span className="text-sm font-medium">{TOOL_LABEL[kind]}</span>
            <span className="ml-2 text-xs text-muted-foreground">{KIND_HINT[kind]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

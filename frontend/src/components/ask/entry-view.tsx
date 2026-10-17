import type { ReactNode } from "react"

import { isFinished, type Ask } from "@/api/asks"
import type { Entry, ToolRun } from "@/ask/conversation"
import { AskAnswer, TracePanel } from "@/components/ask/ask-result"
import { AttachmentGallery } from "@/components/attachments/attachment-gallery"
import { Mascot } from "@/components/mascot"
import { UiDemoOffer } from "@/components/ui-demo/offer"
import { wantsOrderDemo } from "@/lib/ui-demo"

const TOOL_LABEL = {
  data: "公司資料",
  knowledge: "文件與公開資料",
  memory: "頻道內容",
}

type EntryViewProps = {
  entry: Entry
  onAskChange: (entryId: number, patch: { ask: Ask }) => void
  /** 看了前文改寫的意思不對：用業務原本打的那句重查 */
  onAskAsTyped: (entryId: number) => void
  /** 有一題還在查：選種類的按鈕先停用，按了也不會送 */
  busy: boolean
}

export function EntryView({ entry, ...actions }: EntryViewProps) {
  if (entry.kind === "tool") return <ToolCard run={entry} {...actions} />
  if (entry.kind === "model" && entry.demo === "create-order")
    return <UiDemoOffer />
  if (entry.kind === "user") {
    // 語音那句是 Gemini 另外做的語音轉文字，常有同音錯字；打字的是業務原文，不必標
    return (
      <>
        <div className="ml-10 flex flex-col items-end gap-1 self-end">
          <p className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
            {entry.text}
          </p>
          {entry.attachment && (
            <AttachmentGallery
              attachments={[entry.attachment]}
              className="w-56 max-w-full items-end"
            />
          )}
          {entry.source === "voice" && (
            <p className="text-xs text-muted-foreground">語音辨識，僅供參考</p>
          )}
        </div>
        {entry.source === "voice" && wantsOrderDemo(entry.text) && (
          <UiDemoOffer />
        )}
      </>
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
  onAskAsTyped,
  busy,
}: Omit<EntryViewProps, "entry"> & { run: ToolRun }) {
  const done = run.error !== null || (run.ask !== null && isFinished(run.ask))
  return (
    <section className="mr-4 rounded-2xl border border-dashed bg-card px-4 py-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {run.askKind ? TOOL_LABEL[run.askKind] : "查詢"}：
        {run.question || "（沒有問題內容）"}
      </p>
      {run.page && (
        <p className="mb-2 text-xs text-muted-foreground">
          提問時：{run.page.title}
          {run.contextUsed ? " · 已帶入頁面情境" : ""}
        </p>
      )}
      {/* 改寫可能誤會意思：讓業務看得到實際查的是哪一句、是從哪一句補出來的 */}
      {run.original && (
        <p className="-mt-1 mb-2 text-xs text-muted-foreground">
          把「{run.original}」補成完整的問題
        </p>
      )}
      {run.routing ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mascot
            state="think"
            size={28}
            bust
            className="shrink-0 rounded-full bg-accent"
          />
          正在理解你的問題…
        </p>
      ) : run.clarification ? (
        <p className="text-sm leading-relaxed" role="status">
          {run.clarification}
          <span className="mt-2 block text-xs text-muted-foreground">
            在下方直接補充就可以。
          </span>
        </p>
      ) : run.error ? (
        <p className="text-sm text-destructive">{run.error}</p>
      ) : run.ask ? (
        <AskAnswer
          ask={run.ask}
          onChange={(ask) => onAskChange(run.id, { ask })}
        />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mascot
            state="think"
            size={28}
            bust
            className="shrink-0 rounded-full bg-accent"
          />
          送出查詢…
        </p>
      )}
      {run.ask && run.ask.trace.length > 0 && (
        <TracePanel trace={run.ask.trace} live={!isFinished(run.ask)} />
      )}
      {run.askKind && done && run.original && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
          不是要查這個？
          {run.original && (
            <LinkButton disabled={busy} onClick={() => onAskAsTyped(run.id)}>
              照原話查
            </LinkButton>
          )}
        </div>
      )}
      {run.cancelled && (
        <p className="mt-2 text-xs text-muted-foreground">
          對話已經不需要這個結果，查到的內容仍保留在這裡。
        </p>
      )}
    </section>
  )
}

function LinkButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
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

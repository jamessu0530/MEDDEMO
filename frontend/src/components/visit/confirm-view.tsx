import { useState, type ReactNode } from "react"
import { ChevronDown, Pencil } from "lucide-react"
import { useNavigate } from "react-router"

import { confirmVisit, discardVisit, type FieldKey, type Visit } from "@/api/visits"
import { FieldEditor } from "@/components/visit/field-editor"
import { FIELD_LABEL, FIELD_ORDER, summarize } from "@/components/visit/field-format"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type ConfirmViewProps = {
  visit: Visit
  onChange: (visit: Visit) => void
}

/** 欄位確認（FR-5）：預設全部採用，業務只改錯的，確認後一次寫回三套系統 */
export function ConfirmView({ visit, onChange }: ConfirmViewProps) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState<FieldKey | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [askDiscard, setAskDiscard] = useState(false)

  const filled = FIELD_ORDER.filter((key) => visit.fields[key] !== null).length

  async function confirm() {
    setConfirming(true)
    setProblem(null)
    try {
      onChange(await confirmVisit(visit.id))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "送出失敗，請再試一次")
    } finally {
      setConfirming(false)
    }
  }

  async function rerecord() {
    await discardVisit(visit.id)
    navigate(`/customers/${visit.customer_id}/record`, { replace: true })
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {visit.error_message && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{visit.error_message}</p>
      )}

      <TranscriptPanel transcript={visit.transcript} sources={visit.sources} />

      <p className="text-sm text-muted-foreground">已整理出 {filled} 個欄位 · 點欄位可以修改</p>
      <ul className="flex flex-col gap-2">
        {FIELD_ORDER.map((key) => (
          <FieldRow
            key={key}
            label={FIELD_LABEL[key]}
            value={summarize(key, visit.fields)}
            unsourced={visit.unsourced.includes(key)}
            onEdit={() => setEditing(key)}
          />
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">確認後會同時寫入 CRM · SAP · OA</p>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      <Button className="h-12 text-base" onClick={confirm} disabled={confirming}>
        {confirming ? "寫入中…" : "確認並回寫"}
      </Button>
      <Button variant="ghost" className="h-11" onClick={() => setAskDiscard(true)}>
        整段重錄
      </Button>

      <FieldEditor visit={visit} field={editing} onClose={() => setEditing(null)} onSaved={onChange} />

      <Dialog open={askDiscard} onOpenChange={setAskDiscard}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>放棄這次整理的結果？</DialogTitle>
            <DialogDescription>這段錄音和整理出來的欄位都會刪掉，接著重新錄一次。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setAskDiscard(false)}>
              不要
            </Button>
            <Button variant="destructive" className="h-11" onClick={rerecord}>
              放棄並重錄
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FieldRow({ label, value, unsourced, onEdit }: { label: string; value: string | null; unsourced: boolean; onEdit: () => void }) {
  return (
    <li>
      <button type="button" onClick={onEdit} className="w-full rounded-xl border bg-card px-4 py-3 text-left active:bg-muted">
        <div className="flex items-start gap-3">
          <span className="w-9 shrink-0 pt-0.5 text-sm text-muted-foreground">{label}</span>
          <span className={cn("min-w-0 flex-1 text-sm", value ? "font-medium" : "text-muted-foreground")}>
            {value ?? "沒提到"}
          </span>
          <Pencil className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </div>
        {unsourced && <p className="mt-2 pl-12 text-xs text-destructive">逐字稿裡找不到這段，請核對</p>}
      </button>
    </li>
  )
}

/** FR-5.4 來源對照：逐字稿裡標出每個欄位對應的原文 */
function TranscriptPanel({ transcript, sources }: { transcript: string; sources: Visit["sources"] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-xl border bg-card">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-12 w-full items-center gap-2 px-4 text-sm">
        <span className="font-medium">逐字稿</span>
        <span className="flex-1 text-left text-muted-foreground">對照每個欄位的來源</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <p className="border-t px-4 py-3 text-sm leading-relaxed">{markSources(transcript, sources)}</p>}
    </section>
  )
}

function markSources(transcript: string, sources: Visit["sources"]) {
  const marks = FIELD_ORDER.flatMap((key) => {
    const quote = sources[key]
    const start = quote ? transcript.indexOf(quote) : -1
    return quote && start >= 0 ? [{ key, start, end: start + quote.length }] : []
  }).sort((a, b) => a.start - b.start)

  const parts: ReactNode[] = []
  let cursor = 0
  for (const mark of marks) {
    if (mark.start < cursor) continue // 片段重疊時只標第一個
    parts.push(transcript.slice(cursor, mark.start))
    parts.push(
      <mark key={mark.key} className="rounded bg-accent px-0.5 text-foreground">
        {transcript.slice(mark.start, mark.end)}
        <sup className="ml-0.5 text-[10px] font-medium text-primary">{FIELD_LABEL[mark.key]}</sup>
      </mark>
    )
    cursor = mark.end
  }
  parts.push(transcript.slice(cursor))
  return parts
}

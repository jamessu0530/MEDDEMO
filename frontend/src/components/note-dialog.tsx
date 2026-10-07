import { useState } from "react"

import { createNote, deleteNote, updateNote, type Note, type NoteKind } from "@/api/notes"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NOTE_KIND_LABEL } from "@/lib/calendar"

// 跟後端同一個上限（api/notes.py 的 TEXT_MAX）
const TEXT_MAX = 200
const KINDS: NoteKind[] = ["bring", "told"]

type NoteDialogProps = {
  open: boolean
  onClose: () => void
  customerId: string
  customerName: string
  // 系統日：講過的沒選日期就放今天，跟首頁、後端同一天
  today: string
  // 有給就是修改這一則，沒給是新增
  note?: Note | null
  // 在日曆的某一天按「記一筆」：日期預設那一天
  defaultDate?: string | null
  // 存好或刪掉之後（刪掉是 null），由呼叫的頁面重新載入
  onSaved: (note: Note | null) => void
}

/** 手寫一則備忘，或改、刪一則：客戶檔案與日曆共用 */
export function NoteDialog(props: NoteDialogProps) {
  const { open, onClose, note, customerName } = props
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90svh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{note ? "改備忘" : "記一筆"}</DialogTitle>
          <DialogDescription>{customerName}：下次去之前，客戶檔案與日曆都看得到。</DialogDescription>
        </DialogHeader>
        {/* key 讓每次打開都從這一則（或空白）重新開始 */}
        {open && <NoteForm key={note?.id ?? `new-${props.defaultDate ?? ""}`} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function NoteForm({ customerId, today, note, defaultDate, onSaved, onClose }: NoteDialogProps) {
  const [kind, setKind] = useState<NoteKind>(note?.kind ?? "bring")
  const [text, setText] = useState(note?.text ?? "")
  const [date, setDate] = useState(note?.on_date ?? defaultDate ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function chooseKind(next: NoteKind) {
    setKind(next)
    // 講過的一定是某一天講的：沒選日期就是今天
    if (next === "told" && !date) setDate(today)
  }

  async function run(action: () => Promise<Note | null>) {
    setSaving(true)
    setError(null)
    try {
      onSaved(await action())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗，請再試一次")
      setSaving(false)
    }
  }

  function save() {
    const body = { kind, text: text.trim(), on_date: date || (kind === "told" ? today : null) }
    void run(() => (note ? updateNote(note.id, body) : createNote(customerId, body)))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map((value) => (
          <Button
            key={value}
            type="button"
            variant={kind === value ? "default" : "outline"}
            className="h-11"
            onClick={() => chooseKind(value)}
          >
            {NOTE_KIND_LABEL[value]}
          </Button>
        ))}
      </div>
      <Label htmlFor="note-text">{kind === "bring" ? "要帶什麼" : "講了什麼"}</Label>
      <Textarea
        id="note-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={TEXT_MAX}
        placeholder={kind === "bring" ? "DM、POP、試用包、比價表…" : "跟客戶講的促銷、實銷、搭贈條件"}
      />
      <Label htmlFor="note-date">{kind === "bring" ? "哪天要帶（可以不填，下次去這家就會看到）" : "哪天講的"}</Label>
      <Input id="note-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
        {note ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 text-destructive"
            disabled={saving}
            onClick={() => void run(async () => (await deleteNote(note.id), null))}
          >
            刪除
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" className="h-11 px-6" disabled={saving || !text.trim()} onClick={save}>
          {saving ? "儲存中…" : "儲存"}
        </Button>
      </DialogFooter>
    </div>
  )
}

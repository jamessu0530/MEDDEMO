import { useState } from "react"

import { submitTranscript, type Visit } from "@/api/visits"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

type TranscriptDialogProps = {
  visit: Visit
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted: (visit: Visit) => void
}

export function TranscriptDialog({ visit, open, onOpenChange, onSubmitted }: TranscriptDialogProps) {
  const [text, setText] = useState(visit.transcript)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const next = await submitTranscript(visit.id, text.trim())
      onOpenChange(false)
      onSubmitted(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "送出失敗，請再試一次")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>手動輸入逐字稿</DialogTitle>
          <DialogDescription>把剛剛講的內容打進來，系統一樣會整理成五個欄位。</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="例如：御松田有來談，條件比我們好。店長抱怨補貨延遲三天……"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button className="h-11" onClick={submit} disabled={saving || !text.trim()}>
            {saving ? "送出中…" : "送出整理"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

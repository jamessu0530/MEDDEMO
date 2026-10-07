import { useEffect, useState } from "react"
import { Plus } from "lucide-react"

import { getNextNotes, type Note } from "@/api/notes"
import { NoteDialog } from "@/components/note-dialog"
import { NoteRow } from "@/components/note-row"
import { Button } from "@/components/ui/button"

type NextNotesProps = {
  customerId: string
  customerName: string
  // 系統日：手寫講過的預設這天
  today: string
}

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; notes: Note[] }

/**
 * 客戶檔案的「下次去要記得」：最近一次有備忘的拜訪記下的，加上那之後手寫的（services/customer_notes.py）。
 * 載不到只有這一區顯示失敗，客戶檔案其他區照常
 */
export function NextNotes({ customerId, customerName, today }: NextNotesProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  // undefined：對話框關著；null：新增；Note：修改那一則
  const [editing, setEditing] = useState<Note | null | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    getNextNotes(customerId, controller.signal)
      .then(({ next }) => setState({ status: "ready", notes: next }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  return (
    <section className="rounded-2xl border-2 bg-card px-4 pb-3 shadow-lip">
      <div className="flex items-center justify-between gap-3 py-2">
        <p className="text-sm font-semibold">下次去要記得</p>
        <Button type="button" variant="ghost" className="-mr-2 h-11 gap-1 text-primary" onClick={() => setEditing(null)}>
          <Plus className="size-4" />
          記一筆
        </Button>
      </div>
      {state.status === "loading" && <p className="pb-1 text-sm text-muted-foreground">載入備忘中…</p>}
      {state.status === "error" && (
        <p className="pb-1 text-sm text-muted-foreground">
          備忘沒有載入。
          <button type="button" className="ml-1 min-h-11 text-primary" onClick={() => setAttempt((n) => n + 1)}>
            重新載入
          </button>
        </p>
      )}
      {state.status === "ready" && state.notes.length === 0 && (
        <p className="pb-1 text-sm text-muted-foreground">還沒有備忘。錄音時講到要帶什麼、跟客戶講了什麼促銷，會自動記在這裡。</p>
      )}
      {state.status === "ready" && state.notes.length > 0 && (
        <ul className="flex flex-col">
          {state.notes.map((note) => (
            <li key={note.id} className="border-t first:border-t-0">
              <button
                type="button"
                onClick={() => setEditing(note)}
                className="flex min-h-11 w-full items-center py-2 active:bg-muted"
                aria-label={`改這則備忘：${note.text}`}
              >
                <NoteRow note={note} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <NoteDialog
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        customerId={customerId}
        customerName={customerName}
        today={today}
        note={editing}
        onSaved={() => setAttempt((n) => n + 1)}
      />
    </section>
  )
}

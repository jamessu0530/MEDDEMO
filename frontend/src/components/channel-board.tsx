import { useEffect, useState } from "react"
import { ArrowUpFromLine, Check, Pencil } from "lucide-react"

import { ApiError } from "@/api/client"
import type { Channel } from "@/api/channels"
import { deleteMemory, editMemory, getBoard, withdrawMemory, type Board, type MemoryCategory, type OwnItem } from "@/api/memory"
import { AttachmentThumbs } from "@/components/attachments/attachment-thumbs"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { CATEGORIES, CATEGORY_LABEL, dueText, localToday } from "@/lib/memory"
import { cn } from "@/lib/utils"

// 看板每 15 秒更新一次：熊熊滾整理完就會出現
const POLL_MS = 15_000

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; board: Board }

/** 記憶看板：熊熊滾從對話整理出來的重點，加上下層往上傳的。點一下重點捲到原始訊息 */
export function ChannelBoard({ channel, onJump }: { channel: Channel; onJump: (messageId: number) => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [editing, setEditing] = useState<OwnItem | null>(null)
  const [withdrawing, setWithdrawing] = useState<OwnItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const today = localToday()
  const readOnly = channel.archived

  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      getBoard(channel.id, controller.signal)
        .then((board) => setState({ status: "ready", board }))
        .catch(() => {
          if (!controller.signal.aborted) setState((current) => (current.status === "ready" ? current : { status: "error" }))
        })
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void load()
    }, POLL_MS)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [channel.id, version])

  const reload = () => setVersion((v) => v + 1)

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
      reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "沒有存到，請再試一次")
      throw err
    }
  }

  if (state.status === "loading") return <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>
  if (state.status === "error") return <Notice text="連不上伺服器，看板沒有載入。" action={{ label: "再試一次", onClick: reload }} />

  const { own, below } = state.board
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mascot size={24} bust className="shrink-0 rounded-full bg-accent" />
        熊熊滾會在大家發言兩分鐘後整理重點，對其他組有用的會往上傳。
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <section className="flex flex-col gap-2">
        {own.length === 0 && (
          <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">還沒有重點。在對話裡回報，熊熊滾會整理出來。</p>
        )}
        {own.map((item) => (
          <OwnCard
            key={item.id}
            item={item}
            today={today}
            readOnly={readOnly}
            onJump={onJump}
            onToggle={() => void run(() => editMemory(item.id, { status: item.status === "done" ? "open" : "done" })).catch(() => {})}
            onEdit={() => setEditing(item)}
            onWithdraw={() => setWithdrawing(item)}
          />
        ))}
      </section>
      {below.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">來自下層</h2>
          {below.map((group) => (
            <div key={group.channel_id} className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">{group.channel_name}</p>
              {group.items.map((item) => (
                <article key={item.id} className="rounded-xl border bg-card p-3">
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {CATEGORY_LABEL[item.category]}
                    {item.category === "todo" && item.status === "done" && " · 已完成"}
                    {item.category === "todo" && item.status === "open" && item.due_date && ` · ${dueText(item.due_date, today).text}`}
                  </p>
                  <p className="mt-0.5 text-sm">{item.text}</p>
                  <AttachmentThumbs attachments={item.attachments} />
                </article>
              ))}
            </div>
          ))}
        </section>
      )}
      {editing && (
        <EditDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(edit) => run(() => editMemory(editing.id, edit))}
          onDelete={() => run(() => deleteMemory(editing.id))}
        />
      )}
      {withdrawing && (
        <WithdrawDialog item={withdrawing} onClose={() => setWithdrawing(null)} onConfirm={() => run(() => withdrawMemory(withdrawing.id))} />
      )}
    </div>
  )
}

function OwnCard({
  item,
  today,
  readOnly,
  onJump,
  onToggle,
  onEdit,
  onWithdraw,
}: {
  item: OwnItem
  today: string
  readOnly: boolean
  onJump: (messageId: number) => void
  onToggle: () => void
  onEdit: () => void
  onWithdraw: () => void
}) {
  const todo = item.category === "todo"
  const done = todo && item.status === "done"
  const due = todo && !done && item.due_date ? dueText(item.due_date, today) : null
  const source = item.source_message_ids[0]
  return (
    <article className={cn("rounded-xl border bg-card p-3", done && "opacity-60")}>
      <div className="flex items-start gap-2">
        {todo && (
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={done ? "標成還沒做" : "標成完成"}
            disabled={readOnly}
            onClick={onToggle}
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2",
              done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
            )}
          >
            {done && <Check className="size-4" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[0.6875rem] text-muted-foreground">
            {CATEGORY_LABEL[item.category]}
            {due && <span className={cn(due.overdue && "font-medium text-destructive")}> · {due.text}</span>}
            {" · "}
            {item.edited_by ? `${item.edited_by} 改過` : "熊熊滾整理"}
          </p>
          <button
            type="button"
            disabled={source === undefined}
            onClick={() => source !== undefined && onJump(source)}
            className={cn("mt-0.5 text-left text-sm", done && "line-through")}
          >
            {item.text}
          </button>
          <AttachmentThumbs attachments={item.attachments} raised={item.shared && !item.withdrawn ? item.shared_attachment_ids : []} />
          {item.shared && !item.withdrawn && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[0.6875rem] text-primary">
              <ArrowUpFromLine className="mt-0.5 size-3.5 shrink-0" />
              <p className="min-w-0 flex-1">已往上傳：{item.shared_text}</p>
              {!readOnly && (
                <button type="button" className="shrink-0 font-medium underline-offset-2 hover:underline" onClick={onWithdraw}>
                  撤回
                </button>
              )}
            </div>
          )}
          {item.withdrawn && <p className="mt-2 text-[0.6875rem] text-muted-foreground">已撤回往上傳</p>}
        </div>
        {!readOnly && (
          <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label="修改這條重點" onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
        )}
      </div>
    </article>
  )
}

function EditDialog({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: OwnItem
  onClose: () => void
  onSave: (edit: Parameters<typeof editMemory>[1]) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [text, setText] = useState(item.text)
  const [category, setCategory] = useState<MemoryCategory>(item.category)
  const [due, setDue] = useState(item.due_date ?? "")
  const [raised, setRaised] = useState(item.shared && !item.withdrawn ? item.shared_attachment_ids : [])
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const raisedFiles = item.attachments.filter((a) => item.shared_attachment_ids.includes(a.id))

  async function act(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改重點</DialogTitle>
          <DialogDescription>改過之後，熊熊滾只能把待辦標成完成，不會再改這條的內容。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Textarea value={text} maxLength={500} rows={3} onChange={(event) => setText(event.target.value)} aria-label="內容" />
          <div className="flex gap-2">
            <NativeSelect value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} aria-label="分類">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </NativeSelect>
            {category === "todo" && (
              <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label="到期日" className="h-11" />
            )}
          </div>
          {item.shared && !item.withdrawn && raisedFiles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">跟著往上傳的附件（只能拿掉，不能另外加）</p>
              {raisedFiles.map((file) => {
                const kept = raised.includes(file.id)
                return (
                  <label key={file.id} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={kept}
                      onChange={() => setRaised((current) => (kept ? current.filter((id) => id !== file.id) : current))}
                      disabled={!kept}
                      className="size-5"
                    />
                    <span className="truncate">{file.filename}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          {confirmDelete ? (
            <Button variant="destructive" className="h-11" disabled={busy} onClick={() => void act(onDelete)}>
              確定刪除
            </Button>
          ) : (
            <Button variant="ghost" className="h-11 text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
              刪除
            </Button>
          )}
          <Button variant="outline" className="h-11" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            className="h-11"
            disabled={busy || !text.trim()}
            onClick={() =>
              void act(() =>
                onSave({
                  text: text.trim(),
                  category,
                  due_date: category === "todo" && due ? due : null,
                  ...(item.shared && !item.withdrawn ? { shared_attachment_ids: raised } : {}),
                })
              )
            }
          >
            儲存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WithdrawDialog({ item, onClose, onConfirm }: { item: OwnItem; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>撤回往上傳？</DialogTitle>
          <DialogDescription>
            撤回之後，整區與全國的看板都看不到這條，跟著上去的附件也一起收回。撤回是單向的，之後不能再往上傳。
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-xl bg-muted px-3 py-2 text-sm">{item.shared_text}</p>
        <DialogFooter>
          <Button variant="outline" className="h-11" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              onConfirm()
                .then(onClose)
                .catch(() => setBusy(false))
            }}
          >
            撤回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

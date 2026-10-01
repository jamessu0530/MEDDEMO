import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router"

import { createTopic, updateTopic, type Channel } from "@/api/channels"
import { ApiError } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { railPath } from "@/lib/channel-rail"

// 跟後端一樣（models.TOPIC_NAME_MAX）
const TOPIC_NAME_MAX = 20

/** 後端說得出原因的（重名、名稱不對）照它的說；其他的給一句通用的 */
function reason(error: unknown, fallback: string) {
  return error instanceof ApiError && (error.status === 409 || error.status === 422) ? error.message : fallback
}

/** 在全國或整區頻道底下開文字頻道。開好直接進新頻道的對話頁，返回時停在上層 */
export function CreateTopicDialog({ parent, onClose }: { parent: Channel; onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const topic = await createTopic(parent.id, name.trim())
      navigate(`/channels/${topic.id}`, { state: { backTo: railPath(topic) } })
    } catch (err) {
      setError(reason(err, "沒有建立，請再試一次"))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>新增文字頻道</DialogTitle>
            <DialogDescription>{parent.audience}，大家都能發言。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="topic-name">頻道名稱</Label>
            <Input
              id="topic-name"
              value={name}
              maxLength={TOPIC_NAME_MAX}
              placeholder="例如：新品上市"
              autoFocus
              className="h-11"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" className="h-11" disabled={busy || !name.trim()}>
              {busy ? "建立中…" : "建立"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 文字頻道改名、封存或解除封存。改好呼叫 onDone 讓頻道頁馬上重新載入，不必等即時通知 */
export function ManageTopicDialog({ topic, onClose, onDone }: { topic: Channel; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(topic.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()

  async function run(changes: { name?: string; archived?: boolean }) {
    setBusy(true)
    setError(null)
    try {
      await updateTopic(topic.id, changes)
      onDone()
      onClose()
    } catch (err) {
      setError(reason(err, "沒有改到，請再試一次"))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>管理「{topic.name}」</DialogTitle>
          <DialogDescription>{topic.audience}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            void run({ name: trimmed })
          }}
        >
          <Label htmlFor="topic-rename">頻道名稱</Label>
          <div className="flex gap-2">
            <Input
              id="topic-rename"
              value={name}
              maxLength={TOPIC_NAME_MAX}
              className="h-11 flex-1"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" className="h-11" disabled={busy || !trimmed || trimmed === topic.name}>
              儲存
            </Button>
          </div>
        </form>
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {topic.archived ? "解除封存後大家又能在這裡發言。" : "封存後大家還看得到，但不能再發言。"}
          </p>
          <Button
            variant={topic.archived ? "outline" : "destructive"}
            className="h-11"
            disabled={busy}
            onClick={() => void run({ archived: !topic.archived })}
          >
            {topic.archived ? "解除封存" : "封存這個頻道"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}

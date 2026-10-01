import { useEffect, useState } from "react"
import { Check, Loader2 } from "lucide-react"

import type { PresenceStatus } from "@/api/presence"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusDot, UserAvatar } from "@/components/user-avatar"
import { useAuth } from "@/lib/auth"
import {
  CHOICE_LABEL,
  chooseStatus,
  loadMyPresence,
  ownStatus,
  STATUS_LABEL,
  STATUS_ORDER,
  useMyPresence,
  usePresence,
} from "@/lib/presence"
import { cn } from "@/lib/utils"

/** 自己頭像上該顯示的狀態與文字：選了就照選的（「顯示為離線」也照實寫），沒選就是別人看到的 */
function useOwnStatus() {
  const user = useAuth()?.user
  const mine = useMyPresence()
  const live = usePresence(user?.id ?? "")
  const choice = mine?.choice ?? null
  return {
    user,
    choice,
    status: ownStatus(choice, live),
    label: choice ? CHOICE_LABEL[choice] : STATUS_LABEL[live],
  }
}

/** 狀態選單，跟 Teams 一樣：有空、忙碌、請勿打擾、馬上回來、顯示為離開、顯示為離線，加上重設回自動 */
export function StatusPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { choice } = useOwnStatus()
  const [busy, setBusy] = useState<PresenceStatus | "reset" | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 打開時問一次最新的：可能在別的裝置改過
  useEffect(() => {
    if (open) void loadMyPresence()
  }, [open])

  async function pick(next: PresenceStatus | null) {
    if (busy) return
    setBusy(next ?? "reset")
    setError(null)
    try {
      await chooseStatus(next)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "狀態沒有改成功，請再試一次")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>你的狀態</DialogTitle>
          <DialogDescription>
            {choice
              ? "這是你手動選的，會一直維持到你改掉。"
              : "現在是自動：有在用就是有空，閒置 5 分鐘或切到背景就是離開。"}
            選「顯示為離線」，別人看到的你是離線，你照常可以用。
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="狀態" className="flex flex-col">
          {STATUS_ORDER.map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={choice === status}
              disabled={busy !== null}
              onClick={() => void pick(status)}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-muted disabled:opacity-60",
                choice === status && "font-semibold"
              )}
            >
              <StatusDot status={status} />
              <span className="flex-1">{CHOICE_LABEL[status]}</span>
              {busy === status ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                choice === status && <Check className="size-4 text-primary" />
              )}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button variant="outline" className="h-11" disabled={!choice || busy !== null} onClick={() => void pick(null)}>
          {busy === "reset" ? <Loader2 className="size-4 animate-spin" /> : "重設狀態（回到自動）"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

/** 頁首自己的頭像，點了換狀態 */
export function MyStatusButton({ className }: { className?: string }) {
  const { user, status, label } = useOwnStatus()
  const [open, setOpen] = useState(false)
  if (!user) return null
  return (
    <>
      <button
        type="button"
        aria-label={`你的狀態：${label}，點一下更改`}
        onClick={() => setOpen(true)}
        className={cn("flex shrink-0 items-center justify-center rounded-full hover:bg-muted", className)}
      >
        <UserAvatar id={user.id} name={user.name} status={status} />
      </button>
      <StatusPicker open={open} onOpenChange={setOpen} />
    </>
  )
}

/** 設定頁的「狀態」一段 */
export function MyStatusSection() {
  const { user, choice, status, label } = useOwnStatus()
  const [open, setOpen] = useState(false)
  if (!user) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">狀態</h2>
      <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
        <UserAvatar id={user.id} name={user.name} status={status} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {choice ? "手動選的，改回自動請按「重設狀態」。" : "自動：有在用就是有空，閒置或切到背景就是離開。"}
          </p>
        </div>
        <Button variant="outline" className="h-11 shrink-0 px-4" onClick={() => setOpen(true)}>
          變更
        </Button>
      </div>
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        全公司的帳號都看得到你的狀態。選「顯示為離線」，別人看到的你是離線，你照常可以用。
      </p>
      <StatusPicker open={open} onOpenChange={setOpen} />
    </section>
  )
}

import { useEffect, useState } from "react"
import { Users } from "lucide-react"

import { listMembers, type ChannelMember } from "@/api/channels"
import type { PresenceStatus } from "@/api/presence"
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusDot, UserAvatar } from "@/components/user-avatar"
import { presence, STATUS_LABEL, STATUS_ORDER, usePresenceMap } from "@/lib/presence"

// 頁首最多疊幾個頭像，再多顯示 +N
const SHOWN = 3

type Listed = ChannelMember & { live: PresenceStatus }

/**
 * 頻道頁首右邊：除了自己以外在線的人疊成一排，點了打開成員清單（依狀態分組）。
 * 成員打開頻道時問一次；狀態之後由 WebSocket 推來，收過完整的一份就用即時的（lib/presence.ts）
 */
export function ChannelMembers({ channelId, selfId }: { channelId: number; selfId: string }) {
  const [members, setMembers] = useState<ChannelMember[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  // 打開清單時重問一次：可能有人換組、新開帳號
  const [attempt, setAttempt] = useState(0)
  // 只為了狀態一變就重畫；實際的值從 presence.statusOr 拿
  usePresenceMap()

  useEffect(() => {
    const controller = new AbortController()
    listMembers(channelId, controller.signal)
      .then((list) => {
        setMembers(list)
        setFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [channelId, attempt])

  const listed: Listed[] = (members ?? []).map((m) => ({
    ...m,
    live: presence.statusOr(m.id, m.status),
  }))
  const rank = (m: Listed) => STATUS_ORDER.indexOf(m.live)
  const others = listed.filter((m) => m.id !== selfId && m.live !== "offline").sort((a, b) => rank(a) - rank(b))
  const label = others.length ? `成員，${others.length} 人在線` : "成員"

  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          setOpen(true)
          setAttempt((n) => n + 1)
        }}
        className="flex h-11 shrink-0 items-center justify-center rounded-lg px-2 text-muted-foreground hover:bg-muted"
      >
        {others.length ? (
          // 中文縮寫是兩個字，疊少一點才不會被下一個頭像蓋住
          <AvatarGroup className="-space-x-1">
            {others.slice(0, SHOWN).map((m) => (
              <UserAvatar key={m.id} id={m.id} name={m.name} status={m.live} />
            ))}
            {others.length > SHOWN && (
              <AvatarGroupCount className="text-xs">+{others.length - SHOWN}</AvatarGroupCount>
            )}
          </AvatarGroup>
        ) : (
          <Users className="size-5" />
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80svh] grid-rows-[auto_1fr] overflow-hidden">
          <DialogHeader>
            <DialogTitle>成員{members ? `（${members.length}）` : ""}</DialogTitle>
            <DialogDescription>
              {others.length ? `除了你，${others.length} 人在線。` : "除了你，現在沒有人在線。"}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-4 overflow-y-auto px-4">
            {members === null && !failed && <p className="py-6 text-center text-sm text-muted-foreground">載入中…</p>}
            {failed && <p className="py-6 text-center text-sm text-destructive">成員沒有載入，請再試一次。</p>}
            {members?.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">這個頻道沒有成員。</p>
            )}
            {STATUS_ORDER.map((status) => {
              const group = listed.filter((m) => m.live === status)
              if (!group.length) return null
              return (
                <section key={status} className="flex flex-col gap-1 pb-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <StatusDot status={status} className="size-3 [&>svg]:size-2" />
                    {STATUS_LABEL[status]}（{group.length}）
                  </p>
                  {group.map((m) => (
                    <div key={m.id} className="flex min-h-11 items-center gap-3">
                      <UserAvatar id={m.id} name={m.name} status={m.live} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {m.name}
                        {m.id === selfId && <span className="text-muted-foreground">（你）</span>}
                      </span>
                    </div>
                  ))}
                </section>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

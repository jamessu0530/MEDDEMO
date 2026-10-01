import { Check, Clock, Minus } from "lucide-react"

import type { PresenceStatus } from "@/api/presence"
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useAvatarUrl } from "@/lib/avatars"
import { avatarTone, initials, STATUS_LABEL, usePresence } from "@/lib/presence"
import { cn } from "@/lib/utils"

// 頭像底色：主題色票的淡色，五個彼此分得開；字一律用前景色，淡底上才看得清楚。深色配色下跟著換，不會跳出一塊亮色
// 頻道左欄的方塊也用這一組（components/channel-rail.tsx）。
// 順序跟主管頁路線的顏色一樣（lib/team-routes.ts 的 ROUTE_COLOR_VARS），改這裡要一起改。
// eslint-disable-next-line react-refresh/only-export-components -- 給 channel-rail.tsx 共用，跟頭像放一起比另開檔案合理
export const AVATAR_TONES = [
  "bg-primary/20 text-foreground",
  "bg-chart-4/20 text-foreground",
  "bg-chart-5/20 text-foreground",
  "bg-warning/25 text-foreground",
  "bg-muted-foreground/20 text-foreground",
]

// 狀態點：顏色加圖示，不只靠顏色分辨（跟 Teams 一樣）。離線是空心的灰圈
const DOT: Record<PresenceStatus, string> = {
  available: "bg-success text-white",
  busy: "bg-destructive",
  dnd: "bg-destructive text-white",
  brb: "bg-warning text-white",
  away: "bg-warning text-white",
  offline: "border-2 border-muted-foreground bg-background",
}

function DotIcon({ status }: { status: PresenceStatus }) {
  if (status === "available") return <Check strokeWidth={4} />
  if (status === "dnd") return <Minus strokeWidth={4} />
  if (status === "brb" || status === "away") return <Clock strokeWidth={3} />
  return null
}

type Size = "sm" | "default" | "lg"

/** 頭像：有大頭貼就用照片，沒有（或載入失敗）用名字縮寫；給了 status 就在右下角加狀態點 */
export function UserAvatar({
  id,
  name,
  status,
  size = "default",
  className,
}: {
  id: string
  name: string
  status?: PresenceStatus
  size?: Size
  className?: string
}) {
  const url = useAvatarUrl(id)
  return (
    <Avatar size={size} className={className}>
      {/* 旁邊一定寫著名字，照片本身不必再念一次 */}
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback
        aria-hidden
        className={cn(
          "text-[0.6875rem] font-medium group-data-[size=lg]/avatar:text-sm group-data-[size=sm]/avatar:text-[0.5625rem]",
          AVATAR_TONES[avatarTone(id, AVATAR_TONES.length)]
        )}
      >
        {initials(name)}
      </AvatarFallback>
      {status && (
        <AvatarBadge role="img" aria-label={`狀態：${STATUS_LABEL[status]}`} className={DOT[status]}>
          <DotIcon status={status} />
        </AvatarBadge>
      )}
    </Avatar>
  )
}

/** 即時跟著這個人的狀態變的頭像（訊息旁邊） */
export function LiveAvatar({ id, name, size }: { id: string; name: string; size?: Size }) {
  return <UserAvatar id={id} name={name} size={size} status={usePresence(id)} />
}

/** 不在頭像上的狀態點：狀態選單、成員清單的分組標題 */
export function StatusDot({ status, className }: { status: PresenceStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full [&>svg]:size-2.5",
        DOT[status],
        className
      )}
    >
      <DotIcon status={status} />
    </span>
  )
}

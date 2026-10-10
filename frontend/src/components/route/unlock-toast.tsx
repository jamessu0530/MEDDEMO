import { useEffect, useEffectEvent } from "react"
import { ChevronRight, Medal as MedalIcon } from "lucide-react"
import { Link } from "react-router"

import type { Medal } from "@/api/me"
import { HOME_LEFT_FIXED } from "@/lib/desktop-layout"
import { unlockedText } from "@/lib/medals"
import { cn } from "@/lib/utils"

// 停幾秒自己收起來
const SHOW_MS = 4000

/** 首頁點站剛好解鎖獎牌時，底部跳一行「解鎖銀牌：跑過 3 家藥局」，點了進個人頁看那一面轉起來 */
export function UnlockToast({ medals, onDone }: { medals: Medal[]; onDone: () => void }) {
  const done = useEffectEvent(onDone)
  useEffect(() => {
    const timer = window.setTimeout(() => done(), SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [medals])
  // 疊在「跟熊熊滾說要怎麼排…」上面（那一條底在 4.25rem、高 3rem），不蓋住輸入框，也不蓋住底部分頁。
  // 電腦版沒有底部分頁，輸入列貼著左欄底部（底在 1rem）：一樣疊在它上面、寬度跟左欄一樣，不壓到側邊欄與右邊的地圖
  return (
    <Link
      to="/me"
      role="status"
      className={cn(
        "fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+8rem)] z-20 flex min-h-12 items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lip press animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none",
        HOME_LEFT_FIXED,
        "lg:bottom-20 lg:px-4"
      )}
    >
      <MedalIcon aria-hidden className="size-6 shrink-0 text-amber-500" />
      <span className="flex-1 text-sm font-semibold">{unlockedText(medals)}</span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </Link>
  )
}

import { useEffect, useEffectEvent } from "react"
import { ChevronRight, Medal as MedalIcon } from "lucide-react"
import { Link } from "react-router"

import type { Medal } from "@/api/me"
import { unlockedText } from "@/lib/medals"

// 停幾秒自己收起來
const SHOW_MS = 4000

/** 首頁點站剛好解鎖獎牌時，底部跳一行「解鎖銀牌：跑過 3 家藥局」，點了進個人頁看那一面轉起來 */
export function UnlockToast({ medals, onDone }: { medals: Medal[]; onDone: () => void }) {
  const done = useEffectEvent(onDone)
  useEffect(() => {
    const timer = window.setTimeout(() => done(), SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [medals])
  return (
    <Link
      to="/me"
      role="status"
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-20 flex min-h-12 items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lip press animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
    >
      <MedalIcon aria-hidden className="size-6 shrink-0 text-amber-500" />
      <span className="flex-1 text-sm font-semibold">{unlockedText(medals)}</span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </Link>
  )
}

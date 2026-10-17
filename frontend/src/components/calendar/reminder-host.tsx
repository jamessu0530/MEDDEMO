import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { Bell, X } from "@/components/icons"
import {
  getCalendarNotices,
  readCalendarNotice,
  type CalendarNotice,
} from "@/api/planner"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { dateKey, timeLabel } from "@/lib/planner"

/** 登入後全站共用的站內提醒；背景通知由 service worker 處理。 */
export function CalendarReminderHost() {
  const session = useAuth()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<CalendarNotice | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [error, setError] = useState("")
  useEffect(() => {
    if (!session?.token) return
    let running = false
    const controller = new AbortController()
    const poll = async () => {
      if (running || controller.signal.aborted) return
      running = true
      try {
        const data = await getCalendarNotices(controller.signal)
        if (!controller.signal.aborted)
          setNotice(
            data.notifications.find((n) => !dismissed.includes(n.id)) ?? null
          )
      } catch {
        /* 離線時保留日曆操作；下一輪重試。 */
      } finally {
        running = false
      }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 30_000)
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      controller.abort()
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [session?.token, dismissed])
  if (!notice) return null
  async function dismiss() {
    if (!notice) return
    try {
      await readCalendarNotice(notice.id)
      setDismissed((values) => [...values.slice(-100), notice.id])
      setNotice(null)
      setError("")
    } catch {
      setError("提醒尚未標為已讀，請再試一次")
    }
  }
  return (
    <aside
      role="status"
      aria-label="行程提醒"
      className="fixed right-3 bottom-24 left-3 z-40 rounded-2xl border-2 bg-card p-4 shadow-xl sm:left-auto sm:w-96 lg:bottom-6"
    >
      <div className="flex items-start gap-3">
        <Bell className="mt-1 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            行程提醒 · {dateKey(notice.starts_at)} {timeLabel(notice.starts_at)}
          </p>
          <p className="font-semibold break-words">{notice.title}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="關閉提醒"
          onClick={() => void dismiss()}
        >
          <X />
        </Button>
      </div>
      <Button
        variant="link"
        className="mt-1"
        onClick={() => {
          navigate(
            `/calendar?event=${notice.event_id}&date=${dateKey(notice.starts_at)}`
          )
          void dismiss()
        }}
      >
        查看行程
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </aside>
  )
}

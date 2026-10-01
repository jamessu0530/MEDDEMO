import { useEffect, useState } from "react"
import { MapPin } from "lucide-react"

import { ApiError } from "@/api/client"
import { pauseSharing, resumeSharing, type ShareHours } from "@/api/location"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { barState, barText, CONSENT_TEXT, locationShare, useLocationShare, type BarState } from "@/lib/location-share"
import { cn } from "@/lib/utils"

const DOT: Record<"sharing" | "paused" | "denied", string> = {
  sharing: "bg-success",
  paused: "bg-warning",
  denied: "bg-muted-foreground",
}

/** 每分鐘換一次的現在時間：18:30 一到分享列就收起來 */
function useMinute() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * 業務首頁橫幅下面的位置分享列（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈位置分享〉）。
 * 位置本身跟著在線狀態的心跳送（lib/location-share.ts、lib/realtime.ts），這裡只顯示狀態、暫停與繼續。
 */
export function ShareBar() {
  const snapshot = useLocationShare()
  const now = useMinute()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    void locationShare.load()
  }, [])

  const state = barState(snapshot, now)

  async function toggle(pause: boolean) {
    setBusy(true)
    setError(null)
    try {
      locationShare.setShare(await (pause ? pauseSharing() : resumeSharing()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "連不上伺服器，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ShareBarView
        state={state}
        managerName={snapshot.share?.manager_name ?? null}
        hours={snapshot.share?.hours ?? null}
        busy={busy}
        error={error}
        onPause={() => void toggle(true)}
        onResume={() => void toggle(false)}
        onHelp={() => setHelp(true)}
      />
      {/* 第一次：先說明，按「知道了」才向瀏覽器要定位權限。只能按「知道了」關掉 */}
      <Dialog open={state === "consent"}>
        <DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <MapPin className="size-4 text-primary" />
              分享位置
            </DialogTitle>
            <DialogDescription className="leading-relaxed">{CONSENT_TEXT}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="h-11" onClick={() => locationShare.consent()}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>怎麼開定位權限</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-2 text-left leading-relaxed">
                <p>iPhone：設定 → 隱私權與安全性 → 定位服務 → Safari 網站，選「使用 App 期間」。</p>
                <p>Android：點 Chrome 網址列左邊的圖示 → 權限 → 位置，選「允許」。</p>
                <p>開好之後回到這裡重新整理一次。</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setHelp(false)}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type ViewProps = {
  state: BarState
  managerName: string | null
  hours: ShareHours | null
  busy: boolean
  error: string | null
  onPause: () => void
  onResume: () => void
  onHelp: () => void
}

/** 分享列本身（純畫面）：分享中、暫停中、沒有權限三種；下班時間與還沒同意不顯示 */
export function ShareBarView({ state, managerName, hours, busy, error, onPause, onResume, onHelp }: ViewProps) {
  if ((state !== "sharing" && state !== "paused" && state !== "denied") || !hours) return null
  return (
    <div data-share-bar={state} className="mt-2 rounded-xl border-2 bg-card px-3 py-1.5 shadow-lip">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[state])} />
        <p className="min-w-0 flex-1 text-xs leading-snug">{barText(state, managerName, hours)}</p>
        {state === "sharing" && (
          <Button variant="outline" className="h-9 shrink-0 px-3" disabled={busy} onClick={onPause}>
            暫停
          </Button>
        )}
        {state === "paused" && (
          <Button variant="outline" className="h-9 shrink-0 px-3" disabled={busy} onClick={onResume}>
            繼續
          </Button>
        )}
        {state === "denied" && (
          <Button variant="outline" className="h-9 shrink-0 px-3" onClick={onHelp}>
            怎麼開
          </Button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

import { useEffect, useState } from "react"
import { MapPin } from "@/components/icons"

import { ApiError } from "@/api/client"
import { pauseSharing, resumeSharing, type ShareHours } from "@/api/location"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  CONSENT_TEXT,
  hoursLabel,
  locationShare,
  settingsStatus,
  shareStatus,
  statusText,
  useLocationShare,
  type SettingsStatus,
} from "@/lib/location-share"
import { cn } from "@/lib/utils"

const DOT: Record<Exclude<SettingsStatus, "hidden">, string> = {
  sharing: "bg-success",
  paused: "bg-warning",
  denied: "bg-muted-foreground",
  consent: "bg-muted-foreground",
  off: "bg-muted-foreground",
}

/** 每分鐘換一次的現在時間：上班、下班的時間一到，說明與狀態跟著換 */
function useMinute() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * 業務首頁只有第一次的說明（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈位置分享〉）：
 * 按「知道了」才向瀏覽器要定位權限、開始分享，之後首頁不再有位置分享的東西，不佔版面。
 * 暫停、繼續、沒有權限怎麼開在帳號設定（LocationShareSection）。位置本身跟著在線狀態的心跳送（lib/location-share.ts、lib/realtime.ts）。
 */
export function LocationConsent() {
  const snapshot = useLocationShare()
  const now = useMinute()

  useEffect(() => {
    void locationShare.load()
  }, [])

  // 只能按「知道了」關掉
  return (
    <Dialog open={shareStatus(snapshot, now) === "consent"}>
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
  )
}

/** 帳號設定的位置分享：分享中可以暫停、暫停中可以繼續、沒有權限說明怎麼開；主管與 IT 不顯示 */
export function LocationShareSection() {
  const snapshot = useLocationShare()
  const now = useMinute()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    void locationShare.load()
  }, [])

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
      <LocationShareView
        state={settingsStatus(snapshot, now)}
        managerName={snapshot.share?.manager_name ?? null}
        hours={snapshot.share?.hours ?? null}
        busy={busy}
        error={error}
        onConsent={() => locationShare.consent()}
        onPause={() => void toggle(true)}
        onResume={() => void toggle(false)}
        onHelp={() => setHelp(true)}
      />
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
  state: SettingsStatus
  managerName: string | null
  hours: ShareHours | null
  busy: boolean
  error: string | null
  onConsent: () => void
  onPause: () => void
  onResume: () => void
  onHelp: () => void
}

/** 位置分享的區塊本身（純畫面）：還沒問到、不是業務不顯示 */
export function LocationShareView({ state, managerName, hours, busy, error, onConsent, onPause, onResume, onHelp }: ViewProps) {
  if (state === "hidden" || !hours) return null
  return (
    <section data-location-share={state} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">位置分享</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          上班時間（{hoursLabel(hours)}）主管看得到你的位置，只存最新的一筆，不留軌跡。
        </p>
      </div>
      <div className="rounded-xl border-2 bg-card px-3 py-2 shadow-lip">
        <div className="flex min-h-9 items-center gap-2">
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[state])} />
          <p className="min-w-0 flex-1 text-xs leading-snug">{statusText(state, managerName, hours)}</p>
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
          {state === "consent" && (
            <Button variant="outline" className="h-9 shrink-0 px-3" onClick={onConsent}>
              開始分享
            </Button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </section>
  )
}

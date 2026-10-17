import {
  createContext,
  lazy,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ExternalLink, MapPin, Store } from "@/components/icons"

import { MapGate } from "@/components/map-slot"
import { getMapsConfig, type MapsConfig } from "@/api/maps"
import { storefrontSearchUrl, type StorefrontCustomer } from "@/lib/storefront"

const GoogleStorefront = lazy(
  () => import("@/components/customer-storefront-google")
)

const PhotoConfig = createContext<MapsConfig | undefined>(undefined)

/** 清單只讀一次設定；沒有網路時保留客戶資訊，照片不額外連線。 */
export function CustomerStorefrontList({
  children,
  offline = false,
}: {
  children: ReactNode
  offline?: boolean
}) {
  const [config, setConfig] = useState<MapsConfig | undefined>(undefined)
  useEffect(() => {
    if (offline) return
    const controller = new AbortController()
    getMapsConfig(controller.signal)
      .then(setConfig)
      .catch(() => {
        if (!controller.signal.aborted) setConfig(null)
      })
    return () => controller.abort()
  }, [offline])
  return (
    <PhotoConfig.Provider value={offline ? null : config}>
      {children}
    </PhotoConfig.Provider>
  )
}

/** 選擇拜訪客戶時直接看到縮圖；捲到附近才查詢這一家。 */
export function CustomerStorefrontThumbnail({
  customer,
}: {
  customer: StorefrontCustomer
}) {
  const config = useContext(PhotoConfig)
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined")
  useEffect(() => {
    if (!host.current) return
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "80px" }
    )
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  const fallback = <StorefrontThumbnailFallback />
  return (
    <div
      ref={host}
      className="w-24 shrink-0 overflow-hidden rounded-lg"
      aria-label={`${customer.name}的店家照片`}
    >
      {visible && config !== undefined ? (
        <MapGate
          config={config}
          className="h-20 rounded-lg"
          fallback={fallback}
        >
          {(settings, onFail) => (
            <GoogleStorefront
              customer={customer}
              config={settings}
              onFail={onFail}
              compact
            />
          )}
        </MapGate>
      ) : (
        fallback
      )}
    </div>
  )
}

export function StorefrontThumbnailFallback() {
  return (
    <div className="flex h-20 flex-col items-center justify-center gap-1 rounded-lg bg-muted/70 text-muted-foreground">
      <Store className="size-6 opacity-50" />
      <span className="text-[10px]">暫無照片</span>
    </div>
  )
}

export function CustomerStorefront({
  customer,
  clinic = false,
}: {
  customer: StorefrontCustomer
  clinic?: boolean
}) {
  const searchUrl = storefrontSearchUrl(customer)
  return (
    <section
      className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip"
      aria-label={clinic ? "診所外觀" : "藥局外觀"}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Store className="size-4 text-primary" />
            {clinic ? "診所外觀" : "藥局外觀"}
          </h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            {customer.city}
            {customer.area}
          </p>
        </div>
        <a
          href={searchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-medium text-primary"
        >
          Google 地圖
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <MapGate
        className="h-64 rounded-none"
        fallback={
          <StorefrontFallback text="外觀照片暫時載入不了，可以到 Google 地圖查看。" />
        }
      >
        {(config, onFail) => (
          <GoogleStorefront
            customer={customer}
            config={config}
            onFail={onFail}
          />
        )}
      </MapGate>
    </section>
  )
}

export function StorefrontFallback({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 bg-muted/50 px-5 py-6 text-center">
      <Store className="size-7 text-muted-foreground/60" />
      <p
        role="status"
        className="max-w-sm text-sm leading-relaxed text-muted-foreground"
      >
        {text}
      </p>
    </div>
  )
}

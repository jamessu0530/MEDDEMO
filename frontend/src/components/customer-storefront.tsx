import { lazy } from "react"
import { ExternalLink, MapPin, Store } from "@/components/icons"

import { MapGate } from "@/components/map-slot"
import { storefrontSearchUrl, type StorefrontCustomer } from "@/lib/storefront"

const GoogleStorefront = lazy(
  () => import("@/components/customer-storefront-google")
)

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

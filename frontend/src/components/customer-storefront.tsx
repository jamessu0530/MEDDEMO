import { createContext, useContext, useState, type ReactNode } from "react"
import { ExternalLink, MapPin, Store } from "@/components/icons"
import {
  storefrontSearchUrl,
  type StorefrontCustomer,
  type StoredStorefrontPhoto,
} from "@/lib/storefront"

const OfflinePhotos = createContext(false)

/** Photo metadata comes with the customer record; this list never loads Places. */
export function CustomerStorefrontList({
  children,
  offline = false,
}: {
  children: ReactNode
  offline?: boolean
}) {
  return (
    <OfflinePhotos.Provider value={offline}>{children}</OfflinePhotos.Provider>
  )
}

function SourceCredit({ photo }: { photo: StoredStorefrontPhoto }) {
  return (
    <p className="mt-1 text-xs leading-tight text-muted-foreground">
      <a
        href={photo.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        {photo.credit || "照片來源"}
      </a>
      {photo.license_name && (
        <>
          {" "}
          ·{" "}
          {photo.license_url ? (
            <a
              href={photo.license_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {photo.license_name}
            </a>
          ) : (
            photo.license_name
          )}
        </>
      )}
    </p>
  )
}

function StoredPhoto({
  customer,
  compact = false,
}: {
  customer: StorefrontCustomer
  compact?: boolean
}) {
  const photo = customer.storefront_photo
  const offline = useContext(OfflinePhotos)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (!photo || offline || failedUrl === photo.image_url)
    return compact ? (
      <StorefrontThumbnailFallback />
    ) : (
      <StorefrontFallback text="目前沒有可顯示的店家照片。" />
    )
  return (
    <div className={compact ? "" : "p-3"}>
      <a
        href={photo.source_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={"查看" + customer.name + "的照片來源"}
      >
        <img
          src={photo.image_url}
          alt={customer.name + "的店家照片"}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={
            compact
              ? "h-20 w-24 rounded-lg bg-muted object-cover"
              : "aspect-video w-full rounded-lg bg-muted object-contain"
          }
          onError={() => setFailedUrl(photo.image_url)}
        />
      </a>
      <SourceCredit photo={photo} />
    </div>
  )
}

export function CustomerStorefrontThumbnail({
  customer,
}: {
  customer: StorefrontCustomer
}) {
  return (
    <div
      className="w-24 shrink-0 overflow-hidden rounded-lg"
      aria-label={customer.name + "的店家照片"}
    >
      <StoredPhoto customer={customer} compact />
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
  return (
    <section
      className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip"
      aria-label="店家照片"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Store className="size-4 text-primary" />
            {clinic ? "診所照片" : "店家照片"}
          </h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            {customer.city}
            {customer.area}
          </p>
        </div>
        <a
          href={storefrontSearchUrl(customer)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-medium text-primary"
        >
          Google 地圖
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <StoredPhoto customer={customer} />
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

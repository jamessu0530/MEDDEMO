import { useEffect, useMemo, useRef, useState } from "react"
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps"
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Navigation,
} from "@/components/icons"

import type { MapsConfig } from "@/api/maps"
import {
  StorefrontFallback,
  StorefrontThumbnailFallback,
} from "@/components/customer-storefront"
import { LoadWatch } from "@/components/map-load-watch"
import {
  findStorefront,
  storefrontHeading,
  storefrontQuery,
  type StorefrontCustomer,
} from "@/lib/storefront"
import { cn } from "@/lib/utils"
import { storefrontPlaceIds } from "@/lib/storefront-place-ids"

type SearchState =
  | { status: "loading" }
  | { status: "missing" | "error" }
  | { status: "ready"; place: google.maps.places.Place }

export default function GoogleStorefront({
  customer,
  config,
  onFail,
  compact = false,
}: {
  customer: StorefrontCustomer
  config: NonNullable<MapsConfig>
  onFail: () => void
  compact?: boolean
}) {
  return (
    <APIProvider
      apiKey={config.browser_key}
      language="zh-TW"
      region="TW"
      onError={onFail}
    >
      <LoadWatch onFail={onFail} />
      <StorefrontSearch customer={customer} compact={compact} />
    </APIProvider>
  )
}

function StorefrontSearch({
  customer,
  compact,
}: {
  customer: StorefrontCustomer
  compact: boolean
}) {
  const places = useMapsLibrary("places")
  const [state, setState] = useState<SearchState>({ status: "loading" })
  const { name, city, area, address } = customer
  const query = storefrontQuery(customer)
  const knownPlaceId = customer.id ? storefrontPlaceIds[customer.id] : undefined

  // 連 Google 程式或 Places library 都載不下來時，也不能讓這一區一直轉圈。
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setState((current) =>
          current.status === "loading" ? { status: "error" } : current
        ),
      15000
    )
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!places) return
    let cancelled = false
    const find = async () => {
      if (knownPlaceId) {
        const place = new places.Place({ id: knownPlaceId })
        try {
          await place.fetchFields({
            fields: [
              "displayName",
              "formattedAddress",
              "location",
              "googleMapsURI",
              "photos",
            ],
          })
          return place
        } catch {
          // A removed Place ID can be found again through the current shop identity.
          if (cancelled) return null
        }
      }
      const { places: candidates } = await places.Place.searchByText({
        textQuery: query,
        fields: [
          "id",
          "displayName",
          "formattedAddress",
          "location",
          "googleMapsURI",
        ],
        maxResultCount: 5,
        language: "zh-TW",
        region: "tw",
      })
      if (cancelled) return null
      const place = findStorefront({ name, city, area, address }, candidates)
      if (place) {
        // 只拿核對過的這一家照片；不下載、不存資料庫或 localStorage。
        try {
          await place.fetchFields({ fields: ["photos"] })
        } catch {
          // 照片失敗仍可用核對過的 Google 店址看街景。
        }
      }
      return place
    }
    find()
      .then((place) => {
        if (!cancelled)
          setState(place ? { status: "ready", place } : { status: "missing" })
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" })
      })
    return () => {
      cancelled = true
    }
  }, [places, query, name, city, area, address, knownPlaceId])

  if (compact)
    return state.status === "ready" ? (
      <StorefrontThumbnail place={state.place} />
    ) : (
      <StorefrontThumbnailFallback />
    )

  if (state.status === "loading")
    return <StorefrontLoading text="正在 Google 找這家店的照片…" />
  if (state.status === "missing")
    return (
      <StorefrontFallback text="Google 尚未找到店名與地區都符合的店家，可以到 Google 地圖進一步確認。" />
    )
  if (state.status === "error")
    return (
      <StorefrontFallback text="Google 店家照片暫時載入不了，可以到 Google 地圖查看。" />
    )
  return state.status === "ready" ? (
    <StorefrontGallery place={state.place} />
  ) : null
}

function StorefrontThumbnail({ place }: { place: google.maps.places.Place }) {
  const photo = place.photos?.[0]
  const [failed, setFailed] = useState(false)
  if (!photo || failed) return <StorefrontThumbnailFallback />
  return (
    <div>
      <img
        src={photo.getURI({ maxWidth: 320, maxHeight: 240 })}
        alt={`${place.displayName ?? "店家"}的照片`}
        loading="lazy"
        className="h-20 w-24 rounded-lg bg-muted object-cover"
        onError={() => setFailed(true)}
      />
      <p
        className="mt-1 truncate text-[9px] leading-tight text-muted-foreground"
        translate="no"
      >
        Google Maps
      </p>
      {photo.authorAttributions.map((author, index) => (
        <p
          key={index}
          className="truncate text-[9px] leading-tight text-muted-foreground"
        >
          {author.uri ? (
            <a
              href={author.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {author.displayName}
            </a>
          ) : (
            author.displayName
          )}
        </p>
      ))}
    </div>
  )
}

function StorefrontGallery({ place }: { place: google.maps.places.Place }) {
  const photos = place.photos?.slice(0, 5) ?? []
  const [view, setView] = useState<"photos" | "street">(
    photos.length ? "photos" : "street"
  )
  const [index, setIndex] = useState(0)
  const location = place.location?.toJSON()
  return (
    <div>
      <div className="flex gap-1 border-t px-3 py-2">
        {photos.length > 0 && (
          <button
            type="button"
            aria-pressed={view === "photos"}
            onClick={() => setView("photos")}
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium",
              view === "photos"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Camera className="size-4" />
            店家照片
          </button>
        )}
        {location && (
          <button
            type="button"
            aria-pressed={view === "street"}
            onClick={() => setView("street")}
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium",
              view === "street"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Navigation className="size-4" />
            街景看門口
          </button>
        )}
      </div>
      {view === "photos" && photos[index] && (
        <div className="relative">
          <PlacePhoto
            key={index}
            photo={photos[index]}
            name={place.displayName ?? "店家"}
          />
          {photos.length > 1 && (
            <>
              <button
                type="button"
                aria-label="上一張店家照片"
                onClick={() =>
                  setIndex((index + photos.length - 1) % photos.length)
                }
                className="absolute top-32 left-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                aria-label="下一張店家照片"
                onClick={() => setIndex((index + 1) % photos.length)}
                className="absolute top-32 right-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow"
              >
                <ChevronRight className="size-5" />
              </button>
              <span className="absolute top-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white tabular-nums">
                {index + 1} / {photos.length}
              </span>
            </>
          )}
        </div>
      )}
      {view === "street" &&
        (location ? (
          <StorefrontStreet location={location} />
        ) : (
          <StorefrontFallback text="這家店目前沒有照片或街景。" />
        ))}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{place.displayName}</p>
          <p className="mt-1 leading-relaxed">{place.formattedAddress}</p>
        </div>
        <a
          href={
            place.googleMapsURI ??
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName ?? "")}&query_place_id=${encodeURIComponent(place.id)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap"
          translate="no"
        >
          Google Maps
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  )
}

function PlacePhoto({
  photo,
  name,
}: {
  photo: google.maps.places.Photo
  name: string
}) {
  const src = useMemo(
    () => photo.getURI({ maxWidth: 1200, maxHeight: 800 }),
    [photo]
  )
  const [failed, setFailed] = useState(false)
  return (
    <>
      {failed ? (
        <StorefrontFallback text="這張照片暫時載入不了，可切換其他照片或街景。" />
      ) : (
        <img
          src={src}
          alt={`${name}的 Google 店家照片`}
          className="h-64 w-full bg-muted object-cover"
          onError={() => setFailed(true)}
        />
      )}
      {photo.authorAttributions.length > 0 && (
        <p className="flex flex-wrap gap-x-2 gap-y-1 px-4 pt-2 text-xs text-muted-foreground">
          <span>照片：</span>
          {photo.authorAttributions.map((author, index) =>
            author.uri ? (
              <a
                key={index}
                href={author.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {author.displayName}
              </a>
            ) : (
              <span key={index}>{author.displayName}</span>
            )
          )}
        </p>
      )}
    </>
  )
}

function StorefrontStreet({
  location,
}: {
  location: google.maps.LatLngLiteral
}) {
  const street = useMapsLibrary("streetView")
  const container = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(
    "loading"
  )
  const { lat, lng } = location

  useEffect(() => {
    let cancelled = false
    let panorama: google.maps.StreetViewPanorama | undefined
    const timer = window.setTimeout(() => {
      cancelled = true
      setStatus("missing")
    }, 15000)
    if (street) {
      new street.StreetViewService()
        .getPanorama({
          location: { lat, lng },
          radius: 50,
          source: street.StreetViewSource.OUTDOOR,
        })
        .then(({ data }) => {
          if (cancelled || !container.current || !data.location?.latLng) return
          panorama = new street.StreetViewPanorama(container.current, {
            pano: data.location.pano,
            pov: {
              heading: storefrontHeading(data.location.latLng.toJSON(), {
                lat,
                lng,
              }),
              pitch: 0,
            },
            visible: true,
            motionTracking: false,
            motionTrackingControl: false,
            enableCloseButton: false,
          })
          window.clearTimeout(timer)
          setStatus("ready")
        })
        .catch(() => {
          if (!cancelled) setStatus("missing")
          window.clearTimeout(timer)
        })
    }
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      panorama?.setVisible(false)
      if (panorama) google.maps.event.clearInstanceListeners(panorama)
    }
  }, [street, lat, lng])

  return (
    <div className="relative h-64 bg-muted">
      <div
        ref={container}
        className="h-full w-full"
        aria-label="店家附近的 Google 街景"
      />
      {status !== "ready" && (
        <div className="absolute inset-0 bg-card">
          {status === "loading" ? (
            <StorefrontLoading text="正在載入門口附近的街景…" />
          ) : (
            <StorefrontFallback text="這家店附近目前沒有可顯示的街景，可以到 Google 地圖查看。" />
          )}
        </div>
      )}
    </div>
  )
}

function StorefrontLoading({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex h-64 animate-pulse items-center justify-center bg-muted px-5 text-center text-sm text-muted-foreground"
    >
      {text}
    </div>
  )
}

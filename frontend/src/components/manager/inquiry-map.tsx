import { useEffect, useMemo } from "react"
import {
  AdvancedMarker,
  APIProvider,
  ColorScheme,
  InfoWindow,
  Map,
  useMap,
} from "@vis.gl/react-google-maps"
import type { CustomerInquiry, InquiryLocation } from "@/api/customer-inquiries"
import type { MapsConfig } from "@/api/maps"
import { MessageCircleQuestion } from "@/components/icons"
import { LoadWatch } from "@/components/map-load-watch"
import { formatTaipeiDateTime } from "@/lib/format"
import { groupInquiryLocations, inquiryPlaceLabel } from "@/lib/inquiry-map"
import { boundsOf } from "@/lib/route-geometry-work"
import { useSkin } from "@/lib/skin"
import { cn } from "@/lib/utils"

/** Fixed question locations only: no user location, tracking subscription or route layer. */
export default function InquiryMap({
  config,
  items,
  selectedId,
  onSelect,
  className,
  onFail,
}: {
  config: NonNullable<MapsConfig>
  items: CustomerInquiry[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  className: string
  onFail: () => void
}) {
  const skin = useSkin()
  const places = useMemo(() => groupInquiryLocations(items), [items])
  const selected = places.find((place) =>
    place.inquiries.some((item) => item.id === selectedId)
  )
  const bounds = boundsOf(places.map((place) => place.location)) ?? {
    north: 25.5,
    south: 21.8,
    east: 122,
    west: 120,
  }
  return (
    <APIProvider
      apiKey={config.browser_key}
      language="zh-TW"
      region="TW"
      onError={onFail}
    >
      <LoadWatch onFail={onFail} />
      <div
        aria-label="提問地圖"
        className={cn("overflow-hidden rounded-2xl border", className)}
      >
        <Map
          key={skin}
          mapId={config.map_id}
          colorScheme={skin === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT}
          defaultBounds={{ ...bounds, padding: 48 }}
          gestureHandling="cooperative"
          disableDefaultUI
          clickableIcons={false}
          className="size-full"
        >
          <FocusQuestion location={selected?.location} />
          {places.map((place) => (
            <AdvancedMarker
              key={place.id}
              position={place.location}
              title={`${inquiryPlaceLabel(place.location)} · ${place.inquiries.length} 則提問`}
              onClick={() => onSelect(place.inquiries[0].id)}
              anchorLeft="-50%"
              anchorTop="-100%"
            >
              <span
                className={cn(
                  "relative flex size-10 items-center justify-center rounded-2xl rounded-bl-sm border-2 border-background bg-primary text-primary-foreground shadow-md",
                  selected?.id === place.id &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
              >
                <MessageCircleQuestion className="size-5" />
                {place.inquiries.length > 1 && (
                  <span className="absolute -top-2 -right-2 flex min-w-5 items-center justify-center rounded-full border bg-background px-1 text-xs font-semibold text-foreground">
                    {place.inquiries.length}
                  </span>
                )}
              </span>
            </AdvancedMarker>
          ))}
          {selected && (
            <InfoWindow
              position={selected.location}
              pixelOffset={[0, -42]}
              onCloseClick={() => onSelect(null)}
              headerContent={
                <span className="text-sm font-semibold text-neutral-900">
                  {inquiryPlaceLabel(selected.location)}
                </span>
              }
            >
              <div
                className="max-w-72 space-y-3 overflow-y-auto text-neutral-900"
                style={{
                  maxHeight:
                    "min(16rem, calc(var(--manager-map-height, 20rem) - 5rem))",
                }}
              >
                {selected.inquiries.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "block w-full rounded-lg border border-neutral-200 p-2 text-left",
                      item.id === selectedId && "bg-neutral-100"
                    )}
                  >
                    <p className="text-xs text-neutral-600">
                      {item.rep.name} ·{" "}
                      {formatTaipeiDateTime(item.location.captured_at)}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap">
                      {item.question}
                    </p>
                  </button>
                ))}
                {selected.location.accuracy_m != null && (
                  <p className="text-xs text-neutral-600">
                    定位誤差約 {Math.round(selected.location.accuracy_m)} 公尺
                  </p>
                )}
              </div>
            </InfoWindow>
          )}
        </Map>
      </div>
    </APIProvider>
  )
}

function FocusQuestion({ location }: { location?: InquiryLocation }) {
  const map = useMap()
  const lat = location?.lat,
    lng = location?.lng
  useEffect(() => {
    if (!map || lat == null || lng == null) return
    map.panTo({ lat, lng })
    if ((map.getZoom() ?? 0) < 14) map.setZoom(14)
  }, [map, lat, lng])
  return null
}

import { lazy } from "react"
import type { CustomerInquiry } from "@/api/customer-inquiries"
import { MapPin } from "@/components/icons"
import { MapGate } from "@/components/map-slot"

const InquiryMap = lazy(() => import("@/components/manager/inquiry-map"))

export function InquiryMapSlot({
  items,
  selectedId,
  onSelect,
  className,
}: {
  items: CustomerInquiry[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  className: string
}) {
  if (!items.length)
    return (
      <div
        className={`${className} flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-5 text-center`}
      >
        <MapPin className="size-7 text-muted-foreground" />
        <p className="text-sm font-medium">這段期間還沒有提問地點</p>
        <p className="text-xs text-muted-foreground">
          業務提問時允許定位，地點就會出現在這裡。
        </p>
      </div>
    )
  return (
    <MapGate
      className={className}
      fallback={
        <p
          role="status"
          className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground"
        >
          地圖暫時無法載入，仍可查看提問清單與地點。
        </p>
      }
    >
      {(config, onFail) => (
        <InquiryMap
          config={config}
          items={items}
          selectedId={selectedId}
          onSelect={onSelect}
          className={className}
          onFail={onFail}
        />
      )}
    </MapGate>
  )
}

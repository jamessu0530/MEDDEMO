import { Car, Motorbike, TrainFront, type LucideIcon } from "lucide-react"

import type { TravelMode } from "@/api/route"

const ICONS: Record<TravelMode, LucideIcon> = { drive: Car, scooter: Motorbike, transit: TrainFront }

/** 交通方式的圖示：首頁地圖左上角與帳號設定頁 */
export function TravelModeIcon({ mode, className }: { mode: TravelMode; className?: string }) {
  const Icon = ICONS[mode]
  return <Icon className={className} />
}

import type { LegMode } from "@/api/route"
import { MODE_ICON } from "@/lib/travel-mode"

/** 交通方式的圖示：首頁地圖左上角、帳號設定頁與每一段的膠囊 */
export function TravelModeIcon({ mode, className }: { mode: LegMode; className?: string }) {
  const Icon = MODE_ICON[mode]
  return <Icon className={className} />
}

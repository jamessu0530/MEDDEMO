import { request } from "@/api/client"

// Google 地圖要的設定（後端 api/maps.py）：主管行程、首頁地圖與客戶外觀共用。
// 沒有瀏覽器金鑰是 null，地圖區塊就換成一行說明
export type MapsConfig = { browser_key: string; map_id: string } | null

export function getMapsConfig(signal?: AbortSignal) {
  return request<MapsConfig>("/api/maps/config", { signal })
}

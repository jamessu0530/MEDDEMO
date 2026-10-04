import { useEffect } from "react"
import { APILoadingStatus, useApiLoadingStatus } from "@vis.gl/react-google-maps"

/**
 * Google 的程式載不下來（FAILED）時呼叫 onFail，由外面（map-slot.tsx）換成說明；金鑰被拒（AUTH_FAILURE）理論上也會到這裡，
 * 但這版 @vis.gl/react-google-maps 不會設這個狀態，實際由 map-slot.tsx 的 gm_authFailure 處理。
 * 只給另外打包的地圖（manager/route-map.tsx、route/home-map.tsx）用，放在 APIProvider 裡面
 */
export function LoadWatch({ onFail }: { onFail: () => void }) {
  const status = useApiLoadingStatus()
  useEffect(() => {
    if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) onFail()
  }, [status, onFail])
  return null
}

import { useSyncExternalStore } from "react"

import { getChannelUnread } from "@/api/channels"
import { CountPoller } from "@/lib/count-poller"
import { realtime } from "@/lib/realtime"

/** 頻道分頁與標頭按鈕上的紅點。讀過一個頻道之後呼叫 channelUnread.refresh()，紅點馬上更新 */
export const channelUnread = new CountPoller(() => getChannelUnread())

// 有新訊息的通知、重連之後，不等下一分鐘的輪詢
realtime.subscribe((event) => {
  if (event.type === "message" || event.type === "resync") void channelUnread.refresh()
})

export function useChannelUnread() {
  return useSyncExternalStore(channelUnread.subscribe, channelUnread.getSnapshot)
}

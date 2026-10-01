import { useSyncExternalStore } from "react"

import { getChannelUnread } from "@/api/channels"
import { CountPoller } from "@/lib/count-poller"
import { realtime } from "@/lib/realtime"

/** 頻道分頁與標頭按鈕上的紅點。讀過一個頻道之後呼叫 channelUnread.refresh()，紅點馬上更新 */
export const channelUnread = new CountPoller(() => getChannelUnread())

// 有新訊息的通知、重連之後，不等下一分鐘的輪詢。等 2 秒再問：很多人同時發言時一陣通知只問一次，
// 不然 50 支手機每則通知都問，幾秒內就是幾千個請求
realtime.subscribe((event) => {
  if (event.type !== "avatars") channelUnread.refreshSoon()
})

export function useChannelUnread() {
  return useSyncExternalStore(channelUnread.subscribe, channelUnread.getSnapshot)
}

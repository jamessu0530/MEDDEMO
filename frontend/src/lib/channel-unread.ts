import { useSyncExternalStore } from "react"

import { getChannelUnread } from "@/api/channels"
import { CountPoller } from "@/lib/count-poller"

/** 頻道分頁與標頭按鈕上的紅點。讀過一個頻道之後呼叫 channelUnread.refresh()，紅點馬上更新 */
export const channelUnread = new CountPoller(() => getChannelUnread())

export function useChannelUnread() {
  return useSyncExternalStore(channelUnread.subscribe, channelUnread.getSnapshot)
}

import { useSyncExternalStore } from "react"

import { listOaInbox } from "@/api/oa"
import { CountPoller } from "@/lib/count-poller"

export const pendingOa = new CountPoller(() => listOaInbox().then((data) => ({ count: data.counts.pending ?? data.items.length })))

export function usePendingOa() {
  return useSyncExternalStore(pendingOa.subscribe, pendingOa.getSnapshot)
}

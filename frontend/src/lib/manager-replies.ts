import { useSyncExternalStore } from "react"

import { getUnseenCount } from "@/api/escalations"
import { CountPoller } from "@/lib/count-poller"

/** 業務還沒看過的主管回覆有幾則（FR-8.4「有回覆會通知你」）。有畫面在看的時候，每分鐘問一次 */
export const managerReplies = new CountPoller(() => getUnseenCount())

export function useUnseenReplies() {
  return useSyncExternalStore(managerReplies.subscribe, managerReplies.getSnapshot)
}

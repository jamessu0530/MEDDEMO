import { useSyncExternalStore } from "react"

import { getUnseenNoticeCount } from "@/api/notices"
import { listOaInbox } from "@/api/oa"
import { CountPoller } from "@/lib/count-poller"

/** 主管端的兩個數字：還沒看的風險通報、等自己簽的申請單。電腦版的側邊欄和手機的分頁列讀同一份，有畫面在看就每分鐘問一次；
 * 切換分頁、按「知道了」、簽完一張時呼叫 refresh() 馬上重問。業務沒有主管端，不要讓業務的畫面訂閱（後端會擋） */
export const unseenNotices = new CountPoller(() => getUnseenNoticeCount())
export const pendingOa = new CountPoller(() => listOaInbox().then((data) => ({ count: data.counts.pending ?? data.items.length })))

export function useUnseenNotices() {
  return useSyncExternalStore(unseenNotices.subscribe, unseenNotices.getSnapshot)
}

export function usePendingOa() {
  return useSyncExternalStore(pendingOa.subscribe, pendingOa.getSnapshot)
}

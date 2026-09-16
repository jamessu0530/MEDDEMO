import { request } from "@/api/client"
import type { RiskNotice } from "@/api/visits"

// 業務確認拜訪時提到競品或客訴，後端算完風險分通報給轄區主管（原型「回寫完成」的「主管同步收到通報」）。只有主管打得通，只看自己轄區
export type ManagerNotice = Omit<RiskNotice, "manager_name"> & {
  id: number
  customer_id: string
  customer_name: string
  rep_name: string
  visit_id: string
  created_at: string
  seen_at: string | null
}

/** 新的在前 */
export function listNotices(signal?: AbortSignal) {
  return request<ManagerNotice[]>("/api/manager/notices", { signal })
}

export function getUnseenNoticeCount(signal?: AbortSignal) {
  return request<{ count: number }>("/api/manager/notices/unseen", { signal })
}

export function markNoticeSeen(id: number) {
  return request<ManagerNotice>(`/api/manager/notices/${id}/seen`, { method: "POST" })
}

import { jsonBody, request } from "@/api/client"
import { CUSTOMER_TYPE_LABEL, type Customer } from "@/api/customers"

// 方法卡：主管寫的「遇到這種情況怎麼談」，全公司的業務都看得到。內容是人寫的，AI 不生成也不改寫
export type MethodCard = {
  id: number
  title: string
  // 什麼時候用
  situation: string
  // 怎麼做、怎麼說
  approach: string
  // null 代表每種客戶都適用
  customer_type: Customer["type"] | null
  // 「情況」標籤，畫面上的名稱在 lib/methods.ts
  tags: string[]
  author_name: string
  // retired 是下架：業務看不到，作者在主管端看得到、可以重新上架
  status: "published" | "retired"
  // 有幫上、沒幫上各幾次；採用次數就是有幫上的次數
  adopted: number
  not_helped: number
  // 我在這個情境（帶了客戶就是那家客戶，沒帶就是方法卡清單）按過什麼；沒按過是 null
  my_feedback: boolean | null
  updated_at: string
}

/** 卡片上寫適用哪一種客戶；null 是每種都適用 */
export function customerTypeLabel(type: MethodCard["customer_type"]) {
  return type ? CUSTOMER_TYPE_LABEL[type] : "都適用"
}

export type MethodCardInput = Pick<MethodCard, "title" | "situation" | "approach" | "customer_type" | "tags">

/** 上架的卡，後端已經照採用次數排好。一次全拿回來，標籤與關鍵字在手機上篩（lib/methods.ts） */
export function listMethods(signal?: AbortSignal) {
  return request<MethodCard[]>("/api/methods", { signal })
}

/** 主管端：自己寫的卡，含下架的；IT 拿到全部 */
export function listMyMethods(signal?: AbortSignal) {
  return request<MethodCard[]>("/api/methods/mine", { signal })
}

/** 作者是誰由後端看 token 認 */
export function createMethod(input: MethodCardInput) {
  return request<MethodCard>("/api/methods", jsonBody("POST", input))
}

/** 只送要改的欄位；下架、重新上架是改 status */
export function updateMethod(id: number, changes: Partial<MethodCardInput & Pick<MethodCard, "status">>) {
  return request<MethodCard>(`/api/methods/${id}`, jsonBody("PATCH", changes))
}

/** 有幫上／沒幫上。再按一次是改答案；回傳按完之後的這張卡。customerId 是在哪一家客戶的談判卡上按的 */
export function sendMethodFeedback(id: number, helped: boolean, customerId?: string) {
  return request<MethodCard>(
    `/api/methods/${id}/feedback`,
    jsonBody("POST", customerId ? { helped, customer_id: customerId } : { helped })
  )
}

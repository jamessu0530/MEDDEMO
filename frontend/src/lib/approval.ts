import type { Approval } from "@/api/customers"
import type { OaFormItem, OaStatus } from "@/api/oa"
import { formatDate } from "@/lib/format"

// 《報價權限與折扣審核》：業務自己 3%、區處主管 8%、業務處長 12%，再上去總經理；最多收到 20%，每 0.5% 一格。
// 真正的判斷在後端（services/approvals.py），這裡只是讓業務填的時候就知道這個折扣要誰簽
export const DISCOUNT_FREE = 3
export const DISCOUNT_MANAGER = 8
export const DISCOUNT_DIRECTOR = 12
export const DISCOUNT_MAX = 20
export const DISCOUNT_STEP = 0.5
// 申請理由最多幾個字（後端同一個上限）
export const REASON_MAX_LENGTH = 500

/** 申請單的狀態（OA 上的字） */
export const OA_STATUS_LABEL: Record<OaStatus, string> = {
  draft: "草稿",
  pending: "審核中",
  returned: "已退回",
  rejected: "已駁回",
  approved: "已批准",
}

export type DiscountSteps = {
  // 這個折扣送得出去嗎；不行的話 text 是原因
  valid: boolean
  // 依序要經過哪幾關，空的就是不用簽
  steps: string[]
  text: string
}

/** 折扣輸入框的內容 → 百分比。沒填就是不打折；打到一半或亂打的字是 NaN，由 discountSteps 說明 */
export function parseDiscount(text: string) {
  return text.trim() === "" ? 0 : Number(text)
}

/** 這個折扣要經過哪幾關，以及畫面上那句話 */
export function discountSteps(pct: number): DiscountSteps {
  if (!Number.isFinite(pct) || pct < 0 || pct > DISCOUNT_MAX) {
    return { valid: false, steps: [], text: `折扣要在 0～${DISCOUNT_MAX}% 之間` }
  }
  if (!Number.isInteger(pct / DISCOUNT_STEP)) return { valid: false, steps: [], text: `折扣每 ${DISCOUNT_STEP}% 一格` }
  if (pct <= DISCOUNT_FREE) return { valid: true, steps: [], text: "在你的權限內，直接送出" }
  if (pct <= DISCOUNT_MANAGER) {
    return { valid: true, steps: ["區處主管"], text: "要區處主管核准，系統有把握會直接核准" }
  }
  if (pct <= DISCOUNT_DIRECTOR) return { valid: true, steps: ["區處主管", "業務處長"], text: "要區處主管與業務處長核准" }
  return { valid: true, steps: ["區處主管", "業務處長", "總經理"], text: "要區處主管、業務處長與總經理核准" }
}

/** 續約要誰簽：照原費率由區處主管核准；上架費率或通路獎勵有任何調整，都要再送業務處長 */
export function contractRoute(listingFrom: number, listingTo: number, rewardFrom: number, rewardTo: number) {
  const changed = listingFrom !== listingTo || rewardFrom !== rewardTo
  return {
    changed,
    text: changed ? "費率有調整，要送業務處長" : "照原費率續約，要區處主管核准，系統有把握會直接核准",
  }
}

/** 0.62 → 62%。最多寫到 99%：模型估的是機率，四捨五入成 100% 會像是在保證 */
export function formatProbability(probability: number) {
  return `${Math.min(99, Math.round(probability * 100))}%`
}

/** 費率 0.085 → 8.5%，到 0.1 個百分點 */
export function formatRate(rate: number) {
  return `${Math.round(rate * 1000) / 10}%`
}

/** 申請單是哪一天的：出差單是拜訪日，優惠與合約是送單那天 */
export function oaDateText(item: Pick<OaFormItem, "trip_date" | "request_date">) {
  if (item.trip_date) return `${formatDate(item.trip_date)} 拜訪`
  return item.request_date ? `${formatDate(item.request_date)} 申請` : ""
}

/** 送出之後回到客戶檔案頁的那句提示：系統核准了，或是送給誰簽 */
export function approvalFlash(what: string, approval: Approval) {
  if (approval.auto_approved) {
    const share = approval.probability === null ? "" : `（過去類似的申請 ${formatProbability(approval.probability)} 會過）`
    return `${what} 系統已核准${share}`
  }
  return approval.waiting_for ? `${what} 已送${approval.waiting_for.name}簽核` : `${what} 已送出`
}

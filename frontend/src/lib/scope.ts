import type { AuthUser } from "@/lib/auth"

/*
 * 誰看得到什麼由後端看 token 決定（backend/app/services/scope.py），三種資料三種範圍：
 * 客戶清單全公司共用；數字查詢查得到整個區；客戶檔案、議價卡、報價只有負責人和他的主管打得開。
 * 這裡只負責把範圍講給使用者聽，三個地方（客戶清單、問答、找不到客戶）用同一套說法。
 */

/** 客戶清單標題下面那一行。清單是全公司的，但點進去的檔案不是，先在這裡講清楚 */
export function customerScopeText(user: AuthUser, count: number) {
  if (user.acting_as) return `全公司 ${count} 家客戶，示範業務${user.acting_as.name}負責的才打得開檔案`
  if (user.role === "manager") return `全公司 ${count} 家客戶，你團隊負責的才打得開檔案`
  return `全公司 ${count} 家客戶，你負責的才打得開檔案`
}

/** 問答輸入框上面那一句：數字查詢查得到這些客戶的資料 */
export function askScopeText(user: AuthUser) {
  if (user.acting_as) return `只查得到示範業務${user.acting_as.name}那一區（${user.region}）的客戶`
  if (user.role === "manager") return `只查得到${user.region}的客戶`
  return `只查得到${user.region}的客戶，不只你自己負責的`
}

/** 客戶頁 404：後端對「不存在」和「不是你的」回一樣的 404，這裡兩種可能都講 */
export function customerNotFoundText(user: AuthUser | null | undefined) {
  if (!user) return "找不到這家客戶。"
  if (user.acting_as) return `找不到這家客戶。這個帳號只打得開示範業務${user.acting_as.name}負責的客戶，這家可能是別人負責的，或連結有誤。`
  if (user.role === "manager") return "找不到這家客戶。客戶檔案只有負責人和他的主管打得開，這家可能不是你團隊負責的，或連結有誤。"
  return "找不到這家客戶。客戶檔案只有負責人打得開，這家可能是別人負責的，或連結有誤。"
}

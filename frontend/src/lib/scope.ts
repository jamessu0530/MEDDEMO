import type { AuthUser } from "@/lib/auth"

/*
 * 登入的人看得到哪些客戶，由後端看 token 決定：業務是自己負責的，主管是自己轄區的，
 * 第三方登入開的帳號是示範業務的。這裡只負責把範圍講給使用者聽，三個地方（客戶清單、問答、找不到客戶）用同一套說法。
 */

/** 客戶清單標題下面那一行 */
export function customerScopeText(user: AuthUser, count: number) {
  if (user.acting_as) return `示範業務${user.acting_as.name}的 ${count} 家客戶`
  if (user.role === "manager") return `${user.region}的 ${count} 家客戶`
  return `你負責的 ${count} 家客戶`
}

/** 問答輸入框上面那一句：數字查詢只查得到這些客戶的資料 */
export function askScopeText(user: AuthUser) {
  if (user.acting_as) return `只查得到示範業務${user.acting_as.name}負責的客戶`
  if (user.role === "manager") return `只查得到${user.region}的客戶`
  return "只查得到你負責的客戶"
}

/** 客戶頁 404：後端對「不存在」和「不是你的」回一樣的 404，這裡兩種可能都講 */
export function customerNotFoundText(user: AuthUser | null | undefined) {
  if (!user) return "找不到這家客戶。"
  if (user.acting_as) return `找不到這家客戶。這個帳號只看得到示範業務${user.acting_as.name}的客戶，這家可能不在裡面，或連結有誤。`
  if (user.role === "manager") return `找不到這家客戶。主管只看得到${user.region}的客戶，這家可能不在轄區內，或連結有誤。`
  return "找不到這家客戶。你只看得到自己負責的客戶，這家可能不是你負責的，或連結有誤。"
}

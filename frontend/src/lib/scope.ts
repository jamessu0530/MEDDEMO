import type { AuthUser } from "@/lib/auth"

export function customerScopeText(_user: AuthUser, count: number) {
  return `全公司客戶皆可搜尋，目前 ${count} 筆結果；可查看與建立拜訪、訂單`
}
export function askScopeText(_user: AuthUser) {
  void _user
  return "可查詢全公司的客戶業務資料；個人 AI 記憶按帳號保存"
}
export function customerNotFoundText(_user: AuthUser | null | undefined) {
  void _user
  return "找不到這家客戶，連結可能有誤。"
}

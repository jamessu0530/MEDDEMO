import { jsonBody, request } from "@/api/client"
import type { Skin } from "@/lib/skin"
import type { TextSize } from "@/lib/text-size"

/** 帳號的設定。兩個都是 null：這個帳號還沒存過 */
export type Preferences = { skin: Skin | null; text_size: TextSize | null }

/** 只帶要改的；沒帶的後端不動 */
export type PreferenceChanges = { skin?: Skin; text_size?: TextSize }

export function getMyPreferences(signal?: AbortSignal) {
  return request<Preferences>("/api/preferences/me", { signal })
}

export function saveMyPreferences(changes: PreferenceChanges) {
  return request<Preferences>("/api/preferences/me", jsonBody("PATCH", changes))
}

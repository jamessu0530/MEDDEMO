import { request, upload } from "@/api/client"

/** 有大頭貼的人：帳號 → 圖片網址（簽過名，<img> 直接用）。不在裡面的用名字縮寫 */
export function listAvatars(signal?: AbortSignal) {
  return request<{ avatars: Record<string, string> }>("/api/avatars", { signal })
}

/** 換成這張照片；後端會再轉正、清 EXIF、裁成 256×256 */
export function uploadAvatar(file: File, onProgress?: (fraction: number) => void) {
  const form = new FormData()
  form.append("file", file)
  return upload<{ url: string }>("/api/avatars/me", form, onProgress)
}

export function removeMyAvatar() {
  return request<void>("/api/avatars/me", { method: "DELETE" })
}

/** IT 移除別人的大頭貼 */
export function removeAvatar(userId: string) {
  return request<void>(`/api/avatars/${encodeURIComponent(userId)}`, { method: "DELETE" })
}

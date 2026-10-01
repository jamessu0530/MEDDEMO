import { useSyncExternalStore } from "react"

import { listAvatars } from "@/api/avatars"
import { realtime } from "@/lib/realtime"

/*
 * 大頭貼（docs/superpowers/specs/2026-10-01-avatars-text-size-design.md）：登入後拿一次全部的網址，
 * 有人換了或移除時 WebSocket 會通知（lib/realtime.ts 的 avatars 事件），重連時也重拿一次。
 * 網址換了內容才換，瀏覽器可以一直快取。
 */

// 前端先裁成正方形、縮到這麼大再傳，少傳一點；後端會再縮成 256
export const UPLOAD_EDGE = 512
const JPEG_QUALITY = 0.9

export class AvatarStore {
  private urls: ReadonlyMap<string, string> = new Map()
  private readonly listeners = new Set<() => void>()

  replace(urls: Record<string, string>) {
    this.set(new Map(Object.entries(urls)))
  }

  /** 自己剛換或剛移除：不等通知，畫面馬上換 */
  update(id: string, url: string | null) {
    const next = new Map(this.urls)
    if (url) next.set(id, url)
    else next.delete(id)
    this.set(next)
  }

  urlOf = (id: string) => this.urls.get(id) ?? null

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(next: ReadonlyMap<string, string>) {
    this.urls = next
    this.listeners.forEach((listener) => listener())
  }
}

export const avatars = new AvatarStore()

// 每次重拿都編一個號：比較舊的那次晚回來，不要蓋掉比較新的
let generation = 0

export async function loadAvatars() {
  const mine = ++generation
  try {
    const { avatars: urls } = await listAvatars()
    if (mine === generation) avatars.replace(urls)
  } catch {
    // 拿不到就照舊用名字縮寫，下次通知或重連再拿
  }
}

/** 登出、換人時清掉；還沒回來的那次也作廢 */
export function clearAvatars() {
  generation += 1
  avatars.replace({})
}

realtime.subscribe((event) => {
  if (event.type === "avatars" || event.type === "resync") void loadAvatars()
})

export function useAvatarUrl(id: string) {
  const read = () => avatars.urlOf(id)
  // 第三個參數給伺服器端 render（元件測試）用，同一份
  return useSyncExternalStore(avatars.subscribe, read, read)
}

/** 從中間裁出最大的正方形，再縮到 maxEdge 以內（本來就比較小的不放大） */
export function squareCrop(width: number, height: number, maxEdge: number) {
  const edge = Math.min(width, height)
  return {
    sx: Math.floor((width - edge) / 2),
    sy: Math.floor((height - edge) / 2),
    edge,
    size: Math.min(edge, maxEdge),
  }
}

/** 照片裁成正方形、縮到 512 存成 JPEG 再傳。瀏覽器解不開（例如桌機遇到 HEIC）就原檔送，讓後端處理或說明 */
export async function squarePhoto(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    return file
  }
  const { sx, sy, edge, size } = squareCrop(bitmap.width, bitmap.height, UPLOAD_EDGE)
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) {
    bitmap.close()
    return file
  }
  // 透明的地方墊白，跟後端一樣
  context.fillStyle = "#fff"
  context.fillRect(0, 0, size, size)
  context.drawImage(bitmap, sx, sy, edge, edge, 0, 0, size, size)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY))
  return blob ? new File([blob], "avatar.jpg", { type: "image/jpeg" }) : file
}

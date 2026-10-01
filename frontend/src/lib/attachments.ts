/*
 * 頻道與問答的附件：選檔、上傳前縮圖（docs/superpowers/specs/2026-10-01-attachments-design.md）。
 * 後端會再整理一次（轉正、清 EXIF、縮到長邊 2048），這裡先縮是為了少傳一點：手機照片動輒 3–5MB。
 */

// 跟後端一樣（services/attachments.py）
export const MAX_FILE_BYTES = 15 * 1024 * 1024
export const MAX_EDGE = 2048
const JPEG_QUALITY = 0.85
// iPhone 選照片時 HEIC 多半已經自動轉成 JPEG；沒轉的也先收下，讓後端說清楚哪裡不行
export const ACCEPT = "image/*,application/pdf"
const SERVER_FORMATS = ["image/jpeg", "image/png", "image/webp"]

export type DraftFile = { key: string; file: File; kind: "image" | "pdf" }

let nextKey = 0

/** 長邊縮到 maxEdge 以內，比例不變；本來就比較小的不放大 */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function kindOf(file: File): DraftFile["kind"] | null {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf"
  if (file.type.startsWith("image/")) return "image"
  return null
}

/** 把剛選的檔案加進輸入框上方的清單。不收的（不是照片或 PDF、太大）跳過，超過上限的截掉，error 說明原因 */
export function addDraftFiles(current: DraftFile[], incoming: File[], max: number) {
  let error: string | null = null
  const accepted: DraftFile[] = []
  for (const file of incoming) {
    const kind = kindOf(file)
    if (!kind || file.size > MAX_FILE_BYTES) {
      error = "只能附照片或 PDF；單一檔案最大 15MB"
      continue
    }
    accepted.push({ key: `draft-${nextKey++}`, file, kind })
  }
  const room = Math.max(0, max - current.length)
  if (accepted.length > room) error = `最多附 ${max} 個檔案`
  return { files: [...current, ...accepted.slice(0, room)], error }
}

export function removeDraftFile(files: DraftFile[], key: string) {
  return files.filter((f) => f.key !== key)
}

/** 照片縮到長邊 2048 再傳，存成 JPEG（後端只收 JPEG 與 PNG，透明背景後端會自己判斷）。
 * 瀏覽器解不開（例如桌機 Chrome 遇到 HEIC）或本來就夠小，就原檔送 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file
  // 後端看得懂的格式：本來就夠小、或縮完反而變大，就原檔送。其他格式（HEIC）解得開就一定轉成 JPEG
  const serverReadable = SERVER_FORMATS.includes(file.type)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    return file
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE)
  if (serverReadable && width === bitmap.width && file.size < 1024 * 1024) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) {
    bitmap.close()
    return file
  }
  // PNG 截圖可能有透明的地方：墊白，跟後端縮圖的做法一樣
  context.fillStyle = "#fff"
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY))
  if (!blob || (serverReadable && blob.size >= file.size)) return file
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg"
  return new File([blob], name, { type: "image/jpeg" })
}

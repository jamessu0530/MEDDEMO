import { useState } from "react"
import { FileText } from "lucide-react"

import type { Attachment } from "@/api/attachments"
import { ImageViewer } from "@/components/attachments/image-viewer"
import { cn } from "@/lib/utils"

/** 訊息或提問附的檔案：照片 1 張顯示大圖、2–4 張排成格子，點了全螢幕看；PDF 是一張卡片，點了在新分頁開 */
export function AttachmentGallery({ attachments, className }: { attachments: Attachment[]; className?: string }) {
  const [viewing, setViewing] = useState<number | null>(null)
  const images = attachments.filter((a) => a.kind === "image")
  const pdfs = attachments.filter((a) => a.kind === "pdf")
  if (!attachments.length) return null
  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      {images.length === 1 && (
        // 一張就照原本的比例顯示，不裁切也不留白
        <button
          type="button"
          aria-label={`看大圖：${images[0].filename}`}
          className="block w-fit max-w-full overflow-hidden rounded-xl bg-muted"
          onClick={() => setViewing(0)}
        >
          <img
            src={images[0].thumb_url ?? images[0].url}
            alt={images[0].filename}
            loading="lazy"
            width={images[0].width ?? undefined}
            height={images[0].height ?? undefined}
            className="block h-auto max-h-72 w-auto max-w-full"
          />
        </button>
      )}
      {images.length > 1 && (
        <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              aria-label={`看大圖：${image.filename}`}
              className={cn(
                "block aspect-square overflow-hidden bg-muted",
                // 三張時第一張橫跨兩格，不留空格
                images.length === 3 && index === 0 && "col-span-2 aspect-[2/1]"
              )}
              onClick={() => setViewing(index)}
            >
              <img
                src={image.thumb_url ?? image.url}
                alt={image.filename}
                loading="lazy"
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
      {pdfs.map((pdf) => (
        <a
          key={pdf.id}
          href={pdf.url}
          target="_blank"
          rel="noopener"
          className="flex min-h-11 items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left text-sm"
        >
          <FileText className="size-6 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{pdf.filename}</span>
            <span className="block text-xs text-muted-foreground">PDF · {pdf.page_count} 頁</span>
          </span>
        </a>
      ))}
      {viewing !== null && <ImageViewer images={images} start={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

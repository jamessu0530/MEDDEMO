import { useState } from "react"
import { ArrowUp, FileText } from "lucide-react"

import type { Attachment } from "@/api/attachments"
import { ImageViewer } from "@/components/attachments/image-viewer"
import { cn } from "@/lib/utils"

/** 看板上的小縮圖：一排 56px，照片點了全螢幕看、PDF 點了在新分頁開。raised 裡的附件標一個往上的箭頭（跟著往上傳了） */
export function AttachmentThumbs({ attachments, raised = [] }: { attachments: Attachment[]; raised?: number[] }) {
  const [viewing, setViewing] = useState<number | null>(null)
  const images = attachments.filter((a) => a.kind === "image")
  if (!attachments.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const up = raised.includes(attachment.id)
        const badge = up && (
          <span className="absolute right-0.5 bottom-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ArrowUp className="size-3" />
          </span>
        )
        if (attachment.kind === "pdf") {
          return (
            <a
              key={attachment.id}
              href={attachment.url}
              target="_blank"
              rel="noopener"
              aria-label={`打開 ${attachment.filename}`}
              className="relative flex size-14 flex-col items-center justify-center rounded-lg border bg-muted px-1"
            >
              <FileText className="size-5 text-destructive" />
              <span className="w-full truncate text-center text-[0.5625rem] text-muted-foreground">{attachment.filename}</span>
              {badge}
            </a>
          )
        }
        return (
          <button
            key={attachment.id}
            type="button"
            aria-label={`看大圖：${attachment.filename}${up ? "（已往上傳）" : ""}`}
            className={cn("relative size-14 overflow-hidden rounded-lg border bg-muted", up && "border-primary")}
            onClick={() => setViewing(images.indexOf(attachment))}
          >
            <img src={attachment.thumb_url ?? attachment.url} alt={attachment.filename} loading="lazy" className="size-full object-cover" />
            {badge}
          </button>
        )
      })}
      {viewing !== null && <ImageViewer images={images} start={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

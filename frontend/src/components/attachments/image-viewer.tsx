import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

import type { Attachment } from "@/api/attachments"

// 手指滑超過這個距離才算換張，輕輕碰一下不算
const SWIPE_PX = 50

/** 全螢幕看圖：左右滑或按箭頭換張，點背景、按 X 或 Esc 關掉 */
export function ImageViewer({ images, start, onClose }: { images: Attachment[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start)
  const touchX = useRef<number | null>(null)
  const image = images[index]
  const many = images.length > 1

  function go(step: number) {
    setIndex((current) => (current + step + images.length) % images.length)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
      if (event.key === "ArrowLeft") setIndex((current) => (current - 1 + images.length) % images.length)
      if (event.key === "ArrowRight") setIndex((current) => (current + 1) % images.length)
    }
    window.addEventListener("keydown", onKey)
    // 看大圖時後面的頁面不要跟著捲
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
    }
  }, [images.length, onClose])

  if (!image) return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.filename}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white"
      onClick={onClose}
      onTouchStart={(event) => (touchX.current = event.touches[0]?.clientX ?? null)}
      onTouchEnd={(event) => {
        const startX = touchX.current
        const endX = event.changedTouches[0]?.clientX
        touchX.current = null
        if (!many || startX === null || endX === undefined || Math.abs(endX - startX) < SWIPE_PX) return
        go(endX < startX ? 1 : -1)
      }}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
        <p className="min-w-0 truncate text-sm text-white/80">
          {many && `${index + 1}／${images.length} · `}
          {image.filename}
        </p>
        <button type="button" aria-label="關閉" className="flex size-11 items-center justify-center" onClick={onClose}>
          <X className="size-6" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <img
          key={image.id}
          src={image.url}
          alt={image.filename}
          className="max-h-full max-w-full object-contain"
          onClick={(event) => event.stopPropagation()}
        />
        {many && (
          <>
            <button
              type="button"
              aria-label="上一張"
              className="absolute left-1 flex size-11 items-center justify-center rounded-full bg-black/40"
              onClick={(event) => {
                event.stopPropagation()
                go(-1)
              }}
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              aria-label="下一張"
              className="absolute right-1 flex size-11 items-center justify-center rounded-full bg-black/40"
              onClick={(event) => {
                event.stopPropagation()
                go(1)
              }}
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

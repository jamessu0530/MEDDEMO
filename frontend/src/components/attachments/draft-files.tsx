import { useEffect, useRef } from "react"
import { FileText, Paperclip, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ACCEPT, type DraftFile } from "@/lib/attachments"

/** 迴紋針：拍照、選照片或選 PDF。選完交給 onPick，同一個檔案可以再選一次 */
export function AttachButton({ onPick, disabled, multiple = true }: { onPick: (files: File[]) => void; disabled?: boolean; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="size-11 shrink-0"
        aria-label="附加照片或 PDF"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Paperclip className="size-5" />
      </Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple={multiple}
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          // 清掉才能再選同一個檔案（例如拿掉之後又想加回來）
          event.target.value = ""
          if (files.length) onPick(files)
        }}
      />
    </>
  )
}

/** 輸入框上方準備要送的檔案：照片顯示縮圖、PDF 顯示檔名，右上角的 X 拿掉 */
export function DraftFiles({ files, onRemove, disabled }: { files: DraftFile[]; onRemove: (key: string) => void; disabled?: boolean }) {
  if (!files.length) return null
  return (
    <ul className="flex gap-2 overflow-x-auto pb-2">
      {files.map((draft) => (
        <li key={draft.key} className="relative shrink-0">
          {draft.kind === "image" ? (
            <LocalPreview file={draft.file} />
          ) : (
            <div className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border bg-muted px-1">
              <FileText className="size-5 text-muted-foreground" />
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">{draft.file.name}</span>
            </div>
          )}
          <button
            type="button"
            aria-label={`拿掉 ${draft.file.name}`}
            disabled={disabled}
            className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-50"
            onClick={() => onRemove(draft.key)}
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function LocalPreview({ file }: { file: File }) {
  const img = useRef<HTMLImageElement>(null)
  // 網址在 effect 裡建、清理時收回，每次掛上去都是新的一個（開發模式會掛兩次，第一次的會被收回）
  useEffect(() => {
    const url = URL.createObjectURL(file)
    if (img.current) img.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])
  // 瀏覽器顯示不了的格式（例如桌機的 HEIC）就只有灰底，送出時由後端說明
  return <img ref={img} alt={file.name} className="size-16 rounded-lg border bg-muted object-cover" />
}

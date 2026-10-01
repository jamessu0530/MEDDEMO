import { useState, type FormEvent } from "react"
import { FileText, Search } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router"

import { ApiError } from "@/api/client"
import { searchAttachments, type SearchHit } from "@/api/channels"
import { AttachButton, DraftFiles } from "@/components/attachments/draft-files"
import { ImageViewer } from "@/components/attachments/image-viewer"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addDraftFiles, shrinkPhoto, type DraftFile } from "@/lib/attachments"
import { formatDateTime } from "@/lib/format"

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; hits: SearchHit[] }

/** 頻道的搜尋頁：用文字找照片與檔案，或附一張照片找長得像的（以圖找圖）。
 * 從頻道頁進來（?channel=）預設只搜那個頻道，可以取消 */
export function ChannelSearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const fromChannel = Number(params.get("channel")) || null
  const [onlyHere, setOnlyHere] = useState(fromChannel !== null)
  const [text, setText] = useState("")
  const [photo, setPhoto] = useState<DraftFile[]>([])
  const [pickError, setPickError] = useState<string | null>(null)
  const [state, setState] = useState<State>({ status: "idle" })
  const [viewing, setViewing] = useState<SearchHit | null>(null)
  const backTo = fromChannel ? `/channels/${fromChannel}` : "/channels"

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!text.trim() && !photo.length) return
    setState({ status: "loading" })
    try {
      const image = photo[0] ? await shrinkPhoto(photo[0].file) : undefined
      const hits = await searchAttachments({ q: text.trim(), image, channelId: onlyHere ? fromChannel : null })
      setState({ status: "ready", hits })
    } catch (error) {
      setState({ status: "error", message: error instanceof ApiError ? error.message : "連不上伺服器，請再試一次" })
    }
  }

  function open(hit: SearchHit) {
    if (hit.reachable) {
      navigate(`/channels/${hit.channel_id}`, { state: { jumpTo: hit.message_id, backTo: `/channels/search${fromChannel ? `?channel=${fromChannel}` : ""}` } })
      return
    }
    // 靠往上傳才看得到的：只開大圖（PDF 在新分頁開），點不回原訊息
    if (hit.attachment.kind === "pdf") window.open(hit.attachment.url, "_blank", "noopener")
    else setViewing(hit)
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="找照片與檔案" backTo={backTo} />
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-1">
          <AttachButton
            multiple={false}
            onPick={(files) => {
              const result = addDraftFiles([], files.filter((f) => f.type.startsWith("image/")).slice(0, 1), 1)
              setPhoto(result.files)
              setPickError(files.some((f) => !f.type.startsWith("image/")) ? "以圖找圖只能用照片" : result.error)
            }}
          />
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={photo.length ? "可以再加幾個字，例如品名" : "例如：御松田的海報、忠孝店貨架"}
            aria-label="搜尋"
            className="h-11 flex-1"
          />
          <Button type="submit" size="icon" className="size-11 shrink-0" aria-label="搜尋" disabled={state.status === "loading" || (!text.trim() && !photo.length)}>
            <Search className="size-4" />
          </Button>
        </div>
        {pickError && <p className="text-xs text-destructive">{pickError}</p>}
        <DraftFiles files={photo} onRemove={() => setPhoto([])} />
        {fromChannel !== null && (
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={onlyHere} onChange={(event) => setOnlyHere(event.target.checked)} />
            只搜這個頻道
          </label>
        )}
      </form>
      <main className="flex-1 px-4 py-4">
        {state.status === "idle" && (
          <p className="py-10 text-center text-sm text-muted-foreground">打字找，或按迴紋針附一張照片，找長得像的照片。</p>
        )}
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">找找看…</p>}
        {state.status === "error" && <Notice text={state.message} action={{ label: "再試一次", onClick: () => void submit() }} />}
        {state.status === "ready" && state.hits.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">沒有找到。換個說法，或取消「只搜這個頻道」。</p>
        )}
        {state.status === "ready" && state.hits.length > 0 && (
          <ul className="grid grid-cols-2 gap-3">
            {state.hits.map((hit) => (
              <li key={hit.attachment.id}>
                <button type="button" onClick={() => open(hit)} className="flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left">
                  {hit.attachment.thumb_url ? (
                    <img src={hit.attachment.thumb_url} alt={hit.attachment.filename} loading="lazy" className="aspect-square w-full object-cover" />
                  ) : (
                    <span className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-muted px-2">
                      <FileText className="size-8 text-destructive" />
                      <span className="w-full truncate text-center text-xs text-muted-foreground">{hit.attachment.filename}</span>
                    </span>
                  )}
                  <span className="flex flex-col gap-0.5 px-2.5 py-2">
                    <span className="truncate text-xs font-medium">{hit.channel_name}</span>
                    <span className="truncate text-[0.6875rem] text-muted-foreground">
                      {hit.author_name ?? "熊熊滾"} · {formatDateTime(hit.created_at)}
                    </span>
                    {(hit.caption || hit.shared_text) && (
                      <span className="line-clamp-1 text-[0.6875rem] text-muted-foreground">{hit.reachable ? hit.caption : hit.shared_text}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
      {viewing && (
        <>
          <ImageViewer images={[viewing.attachment]} start={0} onClose={() => setViewing(null)} />
          {viewing.shared_text && (
            <p className="fixed inset-x-0 bottom-0 z-[60] mx-auto max-w-md bg-black/80 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-sm text-white">
              {viewing.channel_name}往上傳：{viewing.shared_text}
            </p>
          )}
        </>
      )}
    </div>
  )
}

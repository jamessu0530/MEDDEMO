import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { getChannel, listThreads, type Channel } from "@/api/channels"
import { ApiError } from "@/api/client"
import { ChannelRow } from "@/components/channel-row"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"

type LoadState =
  | { status: "loading" }
  // missing：後端回 404（不是地點頻道、不是登入者看得到的地點）
  | { status: "error"; missing: boolean }
  | { status: "ready"; place: Channel; threads: Channel[] }

/** 地點頻道底下有人發過言的客戶討論串。沒發過言的從客戶檔案的「討論串」按鈕開 */
export function ChannelThreadsPage() {
  const id = Number(useParams().channelId)
  const idValid = Number.isInteger(id) && id > 0
  const [state, setState] = useState<LoadState>({ status: "loading" })

  useEffect(() => {
    if (!idValid) return // 不是有效 id：不打 API，下面直接依 idValid 顯示找不到
    const controller = new AbortController()
    Promise.all([getChannel(id, controller.signal), listThreads(id, controller.signal)])
      .then(([place, threads]) => setState({ status: "ready", place, threads }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: error instanceof ApiError && error.status === 404 })
      })
    return () => controller.abort()
  }, [id, idValid])

  if (!idValid) {
    // 網址本身就不是有效的地點頻道 id（手打的亂數、壞掉的連結）：不必等 effect，直接顯示找不到
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="客戶討論串" subtitle="客戶討論串" backTo="/channels" />
        <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-10">
          <Notice text="找不到這個地點，或是你看不到它。" />
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={state.status === "ready" ? state.place.name : "客戶討論串"}
        subtitle="客戶討論串"
        backTo={`/channels/${id}`}
      />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
        {state.status === "error" && (
          <Notice text={state.missing ? "找不到這個地點，或是你看不到它。" : "連不上伺服器，討論串沒有載入。"} />
        )}
        {state.status === "ready" && state.threads.length === 0 && (
          <Notice text="這裡的客戶還沒有人開討論串。要開一個，從客戶檔案右上角的「討論串」進去。" />
        )}
        {state.status === "ready" && state.threads.length > 0 && (
          <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
            {state.threads.map((thread) => (
              <ChannelRow key={thread.id} channel={thread} backTo={`/channels/${id}/threads`} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

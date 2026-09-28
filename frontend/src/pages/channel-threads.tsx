import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { getChannel, listThreads, type Channel } from "@/api/channels"
import { ChannelRow } from "@/components/channel-row"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; place: Channel; threads: Channel[] }

/** 地點頻道底下有人發過言的客戶討論串。沒發過言的從客戶檔案的「討論串」按鈕開 */
export function ChannelThreadsPage() {
  const id = Number(useParams().channelId)
  const [state, setState] = useState<LoadState>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getChannel(id, controller.signal), listThreads(id, controller.signal)])
      .then(([place, threads]) => setState({ status: "ready", place, threads }))
      .catch(() => !controller.signal.aborted && setState({ status: "error" }))
    return () => controller.abort()
  }, [id])

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={state.status === "ready" ? state.place.name : "客戶討論串"}
        subtitle="客戶討論串"
        backTo={`/channels/${id}`}
      />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
        {state.status === "error" && <Notice text="連不上伺服器，討論串沒有載入。" />}
        {state.status === "ready" && state.threads.length === 0 && (
          <Notice text="這裡的客戶還沒有人開討論串。要開一個，從客戶檔案右上角的「討論串」進去。" />
        )}
        {state.status === "ready" && state.threads.length > 0 && (
          <div className="overflow-hidden rounded-2xl border bg-card">
            {state.threads.map((thread) => (
              <ChannelRow key={thread.id} channel={thread} backTo={`/channels/${id}/threads`} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { discardVisit, getVisit, reprocessVisit, type Visit } from "@/api/visits"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ConfirmView } from "@/components/visit/confirm-view"
import { ResultView } from "@/components/visit/result-view"
import { TranscriptDialog } from "@/components/visit/transcript-dialog"

const STAGE_TEXT: Partial<Record<NonNullable<Visit["stage"]>, string>> = {
  transcribing: "語音轉文字中…",
  extracting: "整理成欄位中…",
}

const TITLE: Record<Visit["status"], string> = {
  processing: "整理拜訪紀錄",
  failed: "整理拜訪紀錄",
  draft: "確認拜訪紀錄",
  confirmed: "回寫結果",
  synced: "回寫結果",
}

export function VisitPage() {
  const { visitId = "" } = useParams()
  const [visit, setVisit] = useState<Visit | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [poll, setPoll] = useState(0)

  // 處理中每秒問一次進度（NFR-5：處理期間要顯示進度）；其他狀態載入一次就好
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      getVisit(visitId, controller.signal)
        .then((next) => {
          setVisit(next)
          setLoadError(null)
          if (next.status === "processing") timer = setTimeout(load, 1000)
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          setLoadError(
            err instanceof ApiError && err.status === 404 ? "找不到這筆拜訪紀錄。" : "連不上伺服器，拜訪紀錄沒有載入。"
          )
        })
    load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [visitId, poll])

  // 動作完成後換上新的狀態；又回到處理中時，重新開始輪詢
  function update(next: Visit) {
    setVisit(next)
    if (next.status === "processing") setPoll((n) => n + 1)
  }

  const current = loadError ? null : visit

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title={visit ? TITLE[visit.status] : "拜訪紀錄"} subtitle={visit?.customer_name} backTo="/" />
      {loadError && (
        <div className="p-4">
          <Notice text={loadError} action={{ label: "重新載入", onClick: () => setPoll((n) => n + 1) }} />
        </div>
      )}
      {!loadError && !visit && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
      {/* key：每次重新開始處理就重新計時 */}
      {current?.status === "processing" && <Processing key={poll} visit={current} onChange={update} />}
      {current?.status === "failed" && <Failed visit={current} onChange={update} />}
      {current?.status === "draft" && <ConfirmView visit={current} onChange={update} />}
      {(current?.status === "confirmed" || current?.status === "synced") && <ResultView visit={current} onChange={update} />}
    </div>
  )
}

// 一分鐘都沒處理完，多半是背景工作中斷了（例如 Redis 重啟、排隊的工作不見），讓業務自己接手
const STALL_SECONDS = 60

function Processing({ visit, onChange }: { visit: Visit; onChange: (visit: Visit) => void }) {
  const navigate = useNavigate()
  const [stalled, setStalled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALL_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [])

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗，請再試一次")
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pb-16 text-muted-foreground">
      <Loader2 className="size-8 animate-spin text-primary" />
      <p className="text-sm">{(visit.stage && STAGE_TEXT[visit.stage]) || "排隊處理中…"}</p>
      {stalled && (
        <div className="mt-4 w-full">
          <Notice
            text="處理超過一分鐘還沒好，可能是背景工作中斷了。"
            action={{ label: "再試一次", onClick: () => run(async () => onChange(await reprocessVisit(visit.id))) }}
            secondary={{
              label: "重錄",
              onClick: () =>
                run(async () => {
                  await discardVisit(visit.id)
                  navigate(`/customers/${visit.customer_id}/record`, { replace: true })
                }),
            }}
          />
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** 轉文字失敗：重錄、手動輸入逐字稿，或用同一段錄音再轉一次（SDD 流程設計「轉寫是否成功 → 否」） */
function Failed({ visit, onChange }: { visit: Visit; onChange: (visit: Visit) => void }) {
  const navigate = useNavigate()
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  const rerecord = () =>
    run(async () => {
      await discardVisit(visit.id)
      navigate(`/customers/${visit.customer_id}/record`, { replace: true })
    })

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <Notice
        text={visit.error_message ?? "這段錄音沒有轉成文字。"}
        action={{ label: "手動輸入逐字稿", onClick: () => setTyping(true) }}
        secondary={{ label: "重錄", onClick: rerecord }}
      />
      <Button
        variant="outline"
        className="h-11"
        disabled={busy}
        onClick={() => run(async () => onChange(await reprocessVisit(visit.id)))}
      >
        用同一段錄音再轉一次
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <TranscriptDialog visit={visit} open={typing} onOpenChange={setTyping} onSubmitted={onChange} />
    </div>
  )
}

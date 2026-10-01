import { useEffect, useState } from "react"
import { Loader2, Plus, Search } from "lucide-react"
import { useNavigate } from "react-router"

import { ApiError } from "@/api/client"
import { CUSTOMER_TYPE_LABEL } from "@/api/customers"
import { getCandidates, previewToday, SIGNAL_LABEL, type RouteCandidate, type RouteCandidates } from "@/api/route"
import { Mascot } from "@/components/mascot"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { draftAfterInsert } from "@/lib/itinerary"
import { routeDraft, useRouteDraft } from "@/lib/route-draft"
import { signalTone, TONE_CLASS } from "@/lib/route-path"
import { cn } from "@/lib/utils"

/**
 * 加一站（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈加一站〉）：只有自己的客戶，
 * 已在調整中的行程裡的不列。順路的照估算的多繞分鐘數排前 5 家，其他照名稱。點「＋」插在多繞最少的位置，回到清單；
 * 加進去的那一站跟其他改動一樣，按「完成」才存。
 */
export function RouteAddPage() {
  const navigate = useNavigate()
  const edit = useRouteDraft()
  const [list, setList] = useState<RouteCandidates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState<string | null>(null)
  const missing = !edit

  // 直接打開這一頁（重新整理、書籤）時沒有調整中的草稿：回清單從頭來
  useEffect(() => {
    if (missing) navigate("/route/edit", { replace: true })
  }, [missing, navigate])

  useEffect(() => {
    const current = routeDraft.get()
    if (!current) return
    const controller = new AbortController()
    const stops = current.draft.stops
    getCandidates(
      stops.map((stop) => stop.customer_id),
      stops.filter((stop) => stop.locked).map((stop) => stop.customer_id),
      controller.signal
    )
      .then(setList)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof ApiError ? reason.message : "連不上伺服器，候選的客戶沒有載入。")
      })
    return () => controller.abort()
  }, [])

  async function add(customerId: string) {
    const current = routeDraft.get()
    if (!current) return
    setAdding(customerId)
    setError(null)
    try {
      const view = await previewToday(current.draft, customerId)
      const next = draftAfterInsert(current.draft, view)
      routeDraft.change(next)
      routeDraft.showView(view, next)
      navigate("/route/edit")
    } catch (reason) {
      setAdding(null)
      setError(reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有加進去，請再試一次。")
    }
  }

  const keyword = query.trim()
  const matches = (candidate: RouteCandidate) => !keyword || candidate.customer_name.includes(keyword)
  const nearby = list?.nearby.filter(matches) ?? []
  const others = list?.others.filter(matches) ?? []
  const locked = Boolean(list?.full) || adding !== null

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="加一站" backTo="/route/edit" />
      <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-10">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋客戶"
            aria-label="搜尋客戶"
            className="h-11 pl-9"
          />
        </div>
        {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        {list?.full && (
          <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">今天已經排了 8 站，要先刪掉一站</p>
        )}
        {!list && !error && (
          <div className="flex flex-col items-center gap-2 py-8">
            <Mascot state="wait" size={80} />
            <p className="text-sm text-muted-foreground">找順路的客戶…</p>
          </div>
        )}
        {nearby.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">順路的</h2>
            <ul className="flex flex-col gap-2">
              {nearby.map((candidate) => (
                <CandidateRow
                  key={candidate.customer_id}
                  candidate={candidate}
                  disabled={locked}
                  busy={adding === candidate.customer_id}
                  onAdd={() => void add(candidate.customer_id)}
                />
              ))}
            </ul>
          </section>
        )}
        {others.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">其他客戶</h2>
            <ul className="flex flex-col gap-2">
              {others.map((candidate) => (
                <CandidateRow
                  key={candidate.customer_id}
                  candidate={candidate}
                  disabled={locked}
                  busy={adding === candidate.customer_id}
                  onAdd={() => void add(candidate.customer_id)}
                />
              ))}
            </ul>
          </section>
        )}
        {list && keyword && nearby.length + others.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">找不到「{keyword}」。</p>
        )}
      </main>
    </div>
  )
}

function CandidateRow({
  candidate,
  disabled,
  busy,
  onAdd,
}: {
  candidate: RouteCandidate
  disabled: boolean
  busy: boolean
  onAdd: () => void
}) {
  const place = candidate.after_stop === 0 ? "排第一站" : `插在第 ${candidate.after_stop} 站後`
  return (
    <li className="flex items-center gap-3 rounded-2xl border-2 bg-card py-2.5 pr-2.5 pl-3.5 shadow-lip">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{candidate.customer_name}</p>
        {candidate.after_stop !== null ? (
          <p className="text-xs text-muted-foreground">
            {place} · 多約 {candidate.extra_minutes} 分鐘
            {candidate.signal && (
              <>
                {" · "}
                <span className={cn("font-semibold", TONE_CLASS[signalTone(candidate.signal)])}>{SIGNAL_LABEL[candidate.signal]}</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {CUSTOMER_TYPE_LABEL[candidate.type]} · {candidate.area}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        className="size-11 shrink-0 p-0"
        aria-label={`加進今天的行程：${candidate.customer_name}`}
        disabled={disabled}
        onClick={onAdd}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Plus className="size-5" />}
      </Button>
    </li>
  )
}

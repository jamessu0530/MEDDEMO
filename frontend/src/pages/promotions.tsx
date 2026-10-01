import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Search } from "lucide-react"

import { listPromotions, type Promotion, type PromotionItem } from "@/api/promotions"
import { BottomNav } from "@/components/bottom-nav"
import { Notice } from "@/components/notice"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { formatDate, formatMoney, formatUnitPrice } from "@/lib/format"
import { dealLabel, groupItems, matches, pickPromotion, splitNote } from "@/lib/promotions"
import { cn } from "@/lib/utils"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; promotions: Promotion[] }

const STATUS_VARIANT = { 進行中: "default", 未開始: "outline", 已結束: "secondary" } as const

/** 促銷方案：每一期的整張訂單活動（PM 提醒）與各品項的搭贈。不必問 AI，業務在店裡被問到時直接翻 */
export function PromotionsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    listPromotions(controller.signal)
      .then((promotions) => setState({ status: "ready", promotions }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  const promotions = state.status === "ready" ? state.promotions : []
  const current = pickPromotion(promotions, selected)
  // 一期只有幾十個品項，整份在手機上篩選，打字時不必等網路
  const keyword = query.trim()
  const sections = useMemo(
    () => (current ? splitNote(current.pm_note).filter((s) => matches(keyword, s.title, s.body)) : []),
    [current, keyword]
  )
  const groups = useMemo(
    () =>
      current
        ? groupItems(current.items.filter((i) => matches(keyword, i.group_name, i.name, i.deal, i.sku)))
        : [],
    [current, keyword]
  )

  function retry() {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">每月一期，品項的搭贈與整張訂單的活動</p>
        <h1 className="mt-0.5 text-lg font-semibold">促銷</h1>
        {promotions.length > 1 && (
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1.5">
            {promotions.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setSelected(p.name)}
                className={cn(
                  "h-9 shrink-0 rounded-full border-2 px-4 text-sm press",
                  p.name === current?.name
                    ? "border-primary bg-primary text-primary-foreground shadow-lip-primary"
                    : "bg-card text-muted-foreground shadow-lip"
                )}
              >
                {Number(p.start_date.slice(5, 7))} 月{p.status === "進行中" ? " · 進行中" : ""}
              </button>
            ))}
          </div>
        )}
        {current && (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋品項、品牌或料號"
              aria-label="搜尋品項、品牌或料號"
              className="h-11 bg-card pl-9"
            />
          </div>
        )}
      </header>

      <main className="flex-1 px-4 pt-3 pb-20">
        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">載入促銷方案中…</p>
        )}
        {state.status === "error" && (
          <Notice text="連不上伺服器，促銷方案沒有載入。" action={{ label: "重新載入", onClick: retry }} />
        )}
        {state.status === "ready" && !current && <Notice text="目前還沒有促銷方案。" />}
        {current && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="leading-snug font-medium">{current.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDate(current.start_date)}–{formatDate(current.end_date)} · {current.type} · {current.department}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[current.status]}>{current.status}</Badge>
            </div>

            {keyword && sections.length === 0 && groups.length === 0 && (
              <div className="mt-4">
                <Notice
                  text={`這一期找不到包含「${keyword}」的活動或品項。`}
                  action={{ label: "清除搜尋", onClick: () => setQuery("") }}
                />
              </div>
            )}

            {sections.length > 0 && (
              <section className="mt-4">
                <h2 className="mb-2 text-sm font-semibold">整張訂單的活動</h2>
                <div className="divide-y rounded-xl border-2 bg-card shadow-lip">
                  {sections.map((section, index) => (
                    <details key={`${index}-${section.title}`} className="group px-4 py-3">
                      <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                        {section.title || "PM 提醒"}
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <p className="mt-2 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
                        {section.body}
                      </p>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {groups.length > 0 && (
              <p className="mt-5 text-xs text-muted-foreground">
                一口是一個購買單位。平均每個＝每口售價 ÷ 買加送的數量；另外加贈的其他品項與滿額贈不算在內。
              </p>
            )}
            {groups.map((group) => (
              <section key={group.name} className="mt-4">
                <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
                  {group.name}
                  <span className="text-xs font-normal text-muted-foreground">{group.items.length} 項</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <ItemRow key={item.code} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </main>
      <BottomNav />
    </div>
  )
}

function ItemRow({ item }: { item: PromotionItem }) {
  return (
    <li className="rounded-xl border-2 bg-card px-4 py-3 shadow-lip">
      <div className="flex items-start justify-between gap-3">
        <p className="leading-snug font-medium">{item.name}</p>
        <Badge variant="secondary">{dealLabel(item)}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.deal}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-2 text-center">
        <div>
          <dt className="text-[0.6875rem] text-muted-foreground">每口</dt>
          <dd className="text-sm font-medium tabular-nums">{formatMoney(item.deal_price)}</dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] text-muted-foreground">平均每個</dt>
          <dd className="text-sm font-medium tabular-nums">{formatUnitPrice(item.unit_deal_price)}</dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] text-muted-foreground">比出貨價 {formatMoney(item.ship_price)}</dt>
          <dd className="text-sm font-medium text-primary tabular-nums">省 {(item.discount_rate * 100).toFixed(1)}%</dd>
        </div>
      </dl>
    </li>
  )
}

import { useEffect, useState } from "react"
import { Search } from "lucide-react"

import { CUSTOMER_TYPE_LABEL } from "@/api/customers"
import { listMethods, type MethodCard } from "@/api/methods"
import { MethodCardItem } from "@/components/method-card"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { homePath, useAuth } from "@/lib/auth"
import { filterCards, TAG_LABELS, TAGS } from "@/lib/methods"
import { cn } from "@/lib/utils"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; cards: MethodCard[] }

const CUSTOMER_TYPES = Object.keys(CUSTOMER_TYPE_LABEL) as (keyof typeof CUSTOMER_TYPE_LABEL)[]

/**
 * 方法卡：主管把「遇到這種情況怎麼談」寫成一張一張的卡，全公司的業務都看得到，不分區。
 * 用過之後按「有幫上／沒幫上」，採用次數多的排前面。內容是主管寫的原文，AI 不生成也不改寫。
 */
export function MethodsPage() {
  const user = useAuth()?.user
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [tag, setTag] = useState<string | null>(null)
  const [customerType, setCustomerType] = useState<MethodCard["customer_type"]>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    listMethods(controller.signal)
      .then((cards) => setState({ status: "ready", cards }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  const cards = state.status === "ready" ? state.cards : []
  const shown = filterCards(cards, { tag, customerType, keyword: query })
  const filtering = Boolean(tag || customerType || query.trim())

  // 按完回饋只換掉那一張，不重新排序：卡片在手指底下跳走，會按到別張
  function changed(next: MethodCard) {
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", cards: current.cards.map((card) => (card.id === next.id ? next : card)) }
        : current
    )
  }

  function clearFilters() {
    setTag(null)
    setCustomerType(null)
    setQuery("")
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="方法卡" subtitle="主管教的做法，全公司都看得到" backTo={user ? homePath(user.role) : "/"} />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入方法卡中…</p>}
        {state.status === "error" && (
          <Notice
            text="連不上伺服器，方法卡沒有載入。"
            action={{
              label: "重新載入",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
          />
        )}
        {state.status === "ready" && cards.length === 0 && <Notice text="還沒有方法卡。主管寫了之後會出現在這裡。" />}
        {cards.length > 0 && (
          <>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜尋標題或內容"
                  aria-label="搜尋方法卡的標題或內容"
                  className="h-11 bg-card pl-9"
                />
              </div>
              <NativeSelect
                value={customerType ?? ""}
                onChange={(event) => setCustomerType((event.target.value || null) as MethodCard["customer_type"])}
                aria-label="適用的客戶類型"
                className="w-28 shrink-0 bg-card"
              >
                <option value="">各類客戶</option>
                {CUSTOMER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CUSTOMER_TYPE_LABEL[type]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {/* 「情況」標籤，一排橫向捲動；再點一次已選的那個就取消 */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
              {[null, ...TAGS].map((value) => (
                <button
                  key={value ?? "all"}
                  type="button"
                  aria-pressed={tag === value}
                  onClick={() => setTag(value === tag ? null : value)}
                  className={cn(
                    "h-9 shrink-0 rounded-full border px-4 text-sm",
                    tag === value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
                  )}
                >
                  {value ? TAG_LABELS[value] : "全部"}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <Notice text="找不到符合的方法卡。" action={{ label: "清除篩選", onClick: clearFilters }} />
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {filtering ? `符合的有 ${shown.length} 張` : `共 ${shown.length} 張`}，採用次數多的在前。用過之後點開，按一下有沒有幫上。
                </p>
                {shown.map((card) => (
                  <MethodCardItem key={card.id} card={card} onChanged={changed} />
                ))}
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

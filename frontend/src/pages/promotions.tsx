import { useAskPageContext } from "@/ask/use-page-context"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronDown, Search } from "@/components/icons"

import {
  listPromotions,
  type Promotion,
  type PromotionItem,
} from "@/api/promotions"
import { Notice } from "@/components/notice"

import { ProductPhoto } from "@/components/product-photo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { formatDate, formatMoney, formatUnitPrice } from "@/lib/format"
import {
  categoryBestCodes,
  dealLabel,
  DEFAULT_PROMOTION_FILTERS,
  filterPromotionItems,
  groupItems,
  matches,
  pickPromotion,
  splitNote,
  type PromotionFilters,
} from "@/lib/promotions"
import { cn } from "@/lib/utils"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; promotions: Promotion[] }

const STATUS_VARIANT = {
  進行中: "default",
  未開始: "outline",
  已結束: "secondary",
} as const

/** 促銷方案：每一期的整張訂單活動（PM 提醒）與各品項的搭贈。不必問 AI，業務在店裡被問到時直接翻 */
export function PromotionsPanel({ heading, navigation, active = true }: { heading?: ReactNode; navigation: ReactNode; active?: boolean }) {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [filters, setFilters] = useState<PromotionFilters>(
    DEFAULT_PROMOTION_FILTERS
  )

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
  useAskPageContext({ title: current ? `${current.name} · 促銷方案` : "促銷方案", facts: [
    ...(current ? [`促銷期別：${current.name}`, `期間：${current.start_date} 至 ${current.end_date}`] : ["促銷資料尚未載入"]),
    `商品分類：${filters.category || "全部"}`, `品牌：${filters.brand || "全部"}`, `搜尋：${filters.query.trim() || "無"}`,
    `搭贈篩選：${filters.dealType}`, `最低折扣：${filters.minDiscount}`, `只看類別最優惠：${filters.bestOnly ? "是" : "否"}`, `排序：${filters.sort}`,
  ] }, active)
  // 一期只有幾十個品項，整份在手機上篩選，打字時不必等網路
  const keyword = filters.query.trim()
  const hasItemFilters = Boolean(
    filters.category ||
    filters.brand ||
    filters.dealType !== "all" ||
    filters.minDiscount ||
    filters.bestOnly
  )
  const hasFilters = Boolean(
    keyword || hasItemFilters || filters.sort !== "default"
  )
  const categories = useMemo(
    () =>
      [...new Set(current?.items.map((item) => item.category))].sort((a, b) =>
        a.localeCompare(b, "zh-TW")
      ),
    [current]
  )
  const brands = useMemo(
    () => [...new Set(current?.items.map((item) => item.group_name))],
    [current]
  )
  const bestCodes = useMemo(
    () => categoryBestCodes(current?.items ?? []),
    [current]
  )
  const sections = useMemo(
    () =>
      current && !hasItemFilters
        ? splitNote(current.pm_note).filter((s) =>
            matches(keyword, s.title, s.body)
          )
        : [],
    [current, keyword, hasItemFilters]
  )
  const found = useMemo(
    () => filterPromotionItems(current?.items ?? [], filters),
    [current, filters]
  )
  const groups = useMemo(
    () =>
      filters.sort === "default"
        ? groupItems(found)
        : [
            {
              name:
                filters.sort === "discount_desc"
                  ? "折扣高到低"
                  : "平均單價低到高",
              items: found,
            },
          ].filter((group) => group.items.length > 0),
    [found, filters.sort]
  )

  function updateFilter<K extends keyof PromotionFilters>(
    key: K,
    value: PromotionFilters[K]
  ) {
    setFilters((previous) => ({ ...previous, [key]: value }))
  }

  function clearFilters() {
    setFilters(DEFAULT_PROMOTION_FILTERS)
  }

  function selectPeriod(name: string) {
    if (name === current?.name) return
    setSelected(name)
    // 新的一期可能沒有原本選的類別或品牌，切換時清掉品項條件，保留搜尋與排序。
    setFilters((previous) => ({
      ...DEFAULT_PROMOTION_FILTERS,
      query: previous.query,
      sort: previous.sort,
    }))
  }

  function retry() {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className={cn("sticky top-0 z-10 border-b bg-background/95 px-4 backdrop-blur", heading ? "py-5 lg:px-6" : "pt-4 pb-3")}>
        {heading ?? <h1 className="mt-0.5 text-xl font-semibold">商品與促銷</h1>}
        {navigation}
        {promotions.length > 1 && (
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1.5">
            {promotions.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => selectPeriod(p.name)}
                aria-pressed={p.name === current?.name}
                className={cn(
                  "h-9 shrink-0 press rounded-full border-2 px-4 text-sm",
                  p.name === current?.name
                    ? "border-primary bg-primary text-primary-foreground shadow-lip-primary"
                    : "bg-card text-muted-foreground shadow-lip"
                )}
              >
                {Number(p.start_date.slice(5, 7))} 月
                {p.status === "進行中" ? " · 進行中" : ""}
              </button>
            ))}
          </div>
        )}
        {current && (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.query}
              onChange={(event) => updateFilter("query", event.target.value)}
              placeholder="搜尋品項、類別、品牌或料號"
              aria-label="搜尋品項、類別、品牌或料號"
              className="h-11 bg-card pl-9"
            />
          </div>
        )}
      </header>

      <main className="flex-1 px-4 pt-3 pb-20">
        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            載入促銷方案中…
          </p>
        )}
        {state.status === "error" && (
          <Notice
            text="連不上伺服器，促銷方案沒有載入。"
            action={{ label: "重新載入", onClick: retry }}
          />
        )}
        {state.status === "ready" && !current && (
          <Notice text="目前還沒有促銷方案。" />
        )}
        {current && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="leading-snug font-medium">{current.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDate(current.start_date)}–
                  {formatDate(current.end_date)} · {current.type} ·{" "}
                  {current.department}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[current.status]}>
                {current.status}
              </Badge>
            </div>

            <section
              aria-label="促銷篩選"
              className="mt-4 rounded-xl border-2 bg-card p-3 shadow-lip"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">篩選促銷</h2>
                {hasFilters && (
                  <Button variant="ghost" onClick={clearFilters}>
                    清除篩選
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FilterField label="商品類別">
                  <NativeSelect
                    aria-label="促銷商品類別"
                    value={filters.category}
                    onChange={(event) =>
                      updateFilter("category", event.target.value)
                    }
                  >
                    <option value="">全部類別</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </NativeSelect>
                </FilterField>
                <FilterField label="品牌">
                  <NativeSelect
                    aria-label="促銷品牌"
                    value={filters.brand}
                    onChange={(event) =>
                      updateFilter("brand", event.target.value)
                    }
                  >
                    <option value="">全部品牌</option>
                    {brands.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </NativeSelect>
                </FilterField>
                <FilterField label="搭贈方式">
                  <NativeSelect
                    aria-label="搭贈方式"
                    value={filters.dealType}
                    onChange={(event) =>
                      updateFilter(
                        "dealType",
                        event.target.value as PromotionFilters["dealType"]
                      )
                    }
                  >
                    <option value="all">全部方式</option>
                    <option value="gift">買送同品</option>
                    <option value="direct">直走價</option>
                  </NativeSelect>
                </FilterField>
                <FilterField label="至少省多少">
                  <NativeSelect
                    aria-label="最低折扣比例"
                    value={filters.minDiscount}
                    onChange={(event) =>
                      updateFilter("minDiscount", Number(event.target.value))
                    }
                  >
                    <option value={0}>不限折扣</option>
                    {[10, 20, 30, 40, 50].map((percent) => (
                      <option key={percent} value={percent / 100}>
                        省 {percent}% 以上
                      </option>
                    ))}
                  </NativeSelect>
                </FilterField>
                <FilterField label="排序">
                  <NativeSelect
                    aria-label="促銷排序"
                    value={filters.sort}
                    onChange={(event) =>
                      updateFilter(
                        "sort",
                        event.target.value as PromotionFilters["sort"]
                      )
                    }
                  >
                    <option value="default">依品牌分組</option>
                    <option value="discount_desc">折扣高到低</option>
                    <option value="unit_price_asc">平均單價低到高</option>
                  </NativeSelect>
                </FilterField>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 self-end rounded-xl border-2 px-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.bestOnly}
                    onChange={(event) =>
                      updateFilter("bestOnly", event.target.checked)
                    }
                    className="size-4 shrink-0 accent-primary"
                  />
                  只看各類別最高折扣
                </label>
              </div>
            </section>

            {found.length === 0 && (
              <div className="mt-3">
                <Notice
                  text={
                    hasFilters
                      ? "這一期沒有符合篩選條件的促銷品項。"
                      : "這一期沒有促銷品項。"
                  }
                  action={
                    hasFilters
                      ? { label: "清除篩選", onClick: clearFilters }
                      : undefined
                  }
                />
              </div>
            )}

            {sections.length > 0 && (
              <section className="mt-4">
                <h2 className="mb-2 text-base font-semibold">整張訂單的活動</h2>
                <div className="divide-y rounded-xl border-2 bg-card shadow-lip">
                  {sections.map((section, index) => (
                    <details
                      key={`${index}-${section.title}`}
                      className="group px-4 py-3"
                    >
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
              <div className="mt-4 flex items-center justify-between"><h2 className="text-base font-semibold">促銷品項</h2></div>
            )}
            {groups.map((group) => (
              <section key={group.name} className="mt-4">
                <h2 className="mb-2 flex items-baseline justify-between text-base font-semibold">
                  {group.name}
                </h2>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <ItemRow
                      key={item.code}
                      item={item}
                      isCategoryBest={bestCodes.has(item.code)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  )
}

function FilterField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

function ItemRow({
  item,
  isCategoryBest,
}: {
  item: PromotionItem
  isCategoryBest: boolean
}) {
  return (
    <li className="rounded-xl border-2 bg-card px-4 py-3 shadow-lip">
      <div className="flex items-start gap-3 sm:gap-4">
        <ProductPhoto product={item} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 leading-snug font-medium">{item.name}</p>
            <Badge variant="secondary" className="shrink-0">
              {dealLabel(item)}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{item.category}</Badge>
            {isCategoryBest && <Badge>類別最高折扣</Badge>}
            <span className="text-xs text-muted-foreground">
              {item.group_name} · {item.sku}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{item.deal}</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-2 text-center">
        <div>
          <dt className="text-xs text-muted-foreground">每口</dt>
          <dd className="text-sm font-medium tabular-nums">
            {formatMoney(item.deal_price)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">平均每個</dt>
          <dd className="text-sm font-medium tabular-nums">
            {formatUnitPrice(item.unit_deal_price)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            比出貨價 {formatMoney(item.ship_price)}
          </dt>
          <dd className="text-sm font-medium text-primary tabular-nums">
            省 {(item.discount_rate * 100).toFixed(1)}%
          </dd>
        </div>
      </dl>
    </li>
  )
}

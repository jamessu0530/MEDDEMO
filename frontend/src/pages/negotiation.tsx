import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { getNegotiationCard, type NegotiationCard } from "@/api/customers"
import type { MethodCard } from "@/api/methods"
import { MethodCardItem } from "@/components/method-card"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { formatMoney, formatUnitPrice } from "@/lib/format"
import { replaceCard } from "@/lib/methods"
import { applyCountdown, festivalCountdown, formatFullDate, formatRate, missedText } from "@/lib/negotiation"
import { customerNotFoundText } from "@/lib/scope"
import { FIXED_COLUMN } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"

type LoadState =
  | { status: "loading" }
  // missing：後端回 404（沒有這家，或不是登入者看得到的客戶），回客戶檔案也一樣看不到
  | { status: "error"; missing: boolean }
  | { status: "ready"; card: NegotiationCard }

type Festival = NonNullable<NegotiationCard["festival"]>
type Campaign = NonNullable<NegotiationCard["campaign"]>
type Shelf = NonNullable<NegotiationCard["shelf"]>
type Gaps = NonNullable<NegotiationCard["gaps"]>
type Deals = NonNullable<NegotiationCard["deals"]>
type Terms = NonNullable<NegotiationCard["terms"]>

const ORIENTATION_LABEL: Record<NegotiationCard["orientation"], string> = { customer: "顧客導向", cost: "成本導向" }

/**
 * 談判卡（原型 S-04，FR-3）：每種客戶都有，圍繞下一個節慶。
 * 連鎖是顧客導向（檔期、架上有什麼、缺什麼、我方底線），獨立藥局與診所是成本導向（這一檔的進價、這家的條件）。
 * 數字來自交易資料與當期促銷，節慶那一句話是設定檔裡人寫的，切入點是內部文件的原文段落，最下面是主管寫的方法卡
 */
export function NegotiationPage() {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  const user = useAuth()?.user
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const profilePath = `/customers/${customerId}`

  useEffect(() => {
    const controller = new AbortController()
    getNegotiationCard(customerId, controller.signal)
      .then((card) => setState({ status: "ready", card }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: error instanceof ApiError && error.status === 404 })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  const card = state.status === "ready" ? state.card : null

  // 方法卡按完回饋，換掉那一張；談判卡其餘的內容不必重新載入
  function methodChanged(next: MethodCard) {
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", card: { ...current.card, methods: replaceCard(current.card.methods, next) } }
        : current
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="談判卡"
        subtitle={card ? `${card.customer.name}｜${ORIENTATION_LABEL[card.orientation]}` : undefined}
        backTo={profilePath}
      />
      <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-28">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">整理談判資料中…</p>}
        {state.status === "error" && state.missing && (
          <Notice text={customerNotFoundText(user)} action={{ label: "回客戶清單", onClick: () => navigate("/customers") }} />
        )}
        {state.status === "error" && !state.missing && (
          <Notice
            text="連不上伺服器，談判卡沒有載入。"
            action={{
              label: "重新載入",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
            secondary={{ label: "回客戶檔案", onClick: () => navigate(profilePath) }}
          />
        )}
        {card && (
          <>
            {/* 行事曆裡沒有之後的節慶就不顯示這一區，其餘照常 */}
            {card.festival && <FestivalBlock festival={card.festival} />}
            {card.campaign && <CampaignBlock campaign={card.campaign} />}
            {card.shelf && <ShelfBlock shelf={card.shelf} festival={card.festival} />}
            {card.gaps && card.gaps.length > 0 && <GapsBlock gaps={card.gaps} />}
            {card.margin && (
              <section className="rounded-2xl border-2 bg-card p-4 shadow-lip">
                <p className="text-sm font-semibold">我方底線</p>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">{card.margin.summary}。</p>
                <p className="mt-1 text-[0.6875rem] text-muted-foreground">近 90 天，淨毛利＝毛利－上架費－通路獎勵</p>
              </section>
            )}
            {card.deals && <DealsBlock deals={card.deals} festival={card.festival} />}
            {card.terms && <TermsBlock terms={card.terms} />}
            <Tips tips={card.tips} />
            {/* 沒有相關的方法卡就不顯示這一區 */}
            {card.methods.length > 0 && (
              <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">主管教的做法</h2>
                  <p className="text-[0.6875rem] text-muted-foreground">用過之後點開，按一下有沒有幫上</p>
                </div>
                {/* 回饋帶這家客戶：記的是「在這一家用了有沒有幫上」 */}
                {card.methods.map((method) => (
                  <MethodCardItem key={method.id} card={method} customerId={card.customer.id} onChanged={methodChanged} />
                ))}
              </section>
            )}
          </>
        )}
      </main>

      <div className={cn(FIXED_COLUMN, "bottom-0 z-10 flex gap-2 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]")}>
        <Button variant="outline" className="h-12 w-28 shrink-0" onClick={() => navigate(profilePath)}>
          客戶檔案
        </Button>
        <Button className="h-12 flex-1" onClick={() => navigate(`/customers/${customerId}/record`)}>
          開始拜訪
        </Button>
      </div>
    </div>
  )
}

/** 下一個節慶：名稱、日期、還有幾天、主推品類，下面是設定檔裡人寫的一句話（連鎖與其他客戶看到的不同） */
function FestivalBlock({ festival }: { festival: Festival }) {
  return (
    <section className="rounded-2xl border-2 border-primary/20 bg-primary/10 p-4 shadow-lip-primary-soft">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-primary">下一個節慶</p>
        <p className="text-xs text-primary tabular-nums">{festivalCountdown(festival.days_left)}</p>
      </div>
      <p className="mt-1 text-lg font-semibold">
        {festival.name}
        <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">{formatFullDate(festival.date)}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[0.6875rem] text-muted-foreground">主推</span>
        {festival.categories.map((category) => (
          <Badge key={category} variant="outline" className="bg-card">
            {category}
          </Badge>
        ))}
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-foreground/80">{festival.note}</p>
    </section>
  )
}

/** 檔期（連鎖）：還來得及申請的那個節慶、最晚哪天送、費用上限；下一個節慶來不及了就照實寫 */
function CampaignBlock({ campaign }: { campaign: Campaign }) {
  return (
    <section className="rounded-2xl border-2 bg-card p-4 shadow-lip">
      <p className="text-sm font-semibold">檔期</p>
      {campaign.missed.length > 0 && <p className="mt-1.5 text-sm text-destructive">{missedText(campaign.missed)}。</p>}
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">
        {campaign.missed.length > 0 ? "下一個來得及的是" : "來得及申請的是"}
        {campaign.festival_name}（{formatFullDate(campaign.festival_date)}）。
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
        <div>
          <dt className="text-[0.6875rem] text-muted-foreground">最晚送申請</dt>
          <dd className="text-sm font-medium tabular-nums">{formatFullDate(campaign.apply_by)}</dd>
          <dd className="text-[0.6875rem] text-muted-foreground">{applyCountdown(campaign.days_to_apply)}</dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] text-muted-foreground">檔期費用上限</dt>
          <dd className="text-sm font-medium tabular-nums">{formatMoney(campaign.fee_cap)}</dd>
          <dd className="text-[0.6875rem] text-muted-foreground">近 3 個月平均月進貨的 15%</dd>
        </div>
      </dl>
    </section>
  )
}

/** 架上有什麼（連鎖，FR-3.1）：主推品類裡我方品項近 90 天每月進貨幾次，灰線是同區同類型客戶的平均；低於平均標紅 */
function ShelfBlock({ shelf, festival }: { shelf: Shelf; festival: Festival | null }) {
  const { items } = shelf
  const scale = Math.max(0.1, ...items.flatMap((item) => [item.orders_per_month, item.region_orders_per_month ?? 0])) * 1.15
  return (
    <section className="rounded-2xl border-2 bg-card p-4 shadow-lip">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">架上有什麼</p>
        <p className="text-[0.6875rem] text-muted-foreground">近 90 天每月進貨次數 · 灰線是同區平均</p>
      </div>
      {items.length === 0 && <p className="mt-2 text-sm text-muted-foreground">近半年沒有進貨紀錄。</p>}
      {/* 主推品類裡這家一項都沒進，後端退回不分品類，要讓業務知道下面列的不是主推品類 */}
      {items.length > 0 && festival && (
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">
          {shelf.scoped
            ? `${festival.categories.join("、")}裡，這家近半年進貨金額最高的品項`
            : `${festival.categories.join("、")}這家近半年都沒有進，改列全部品類`}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2.5">
        {items.map((item) => {
          const region = item.region_orders_per_month
          const below = region !== null && item.orders_per_month < region
          return (
            <div key={item.sku} className="flex items-center gap-2.5">
              <span className="w-24 shrink-0 truncate text-xs">{item.name}</span>
              <span className="relative block h-4 flex-1 overflow-hidden rounded bg-secondary">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded", below ? "bg-destructive" : "bg-primary")}
                  style={{ width: `${(item.orders_per_month / scale) * 100}%` }}
                />
                {region !== null && (
                  <span className="absolute inset-y-0 w-0.5 bg-muted-foreground" style={{ left: `${(region / scale) * 100}%` }} />
                )}
              </span>
              <span className={cn("w-16 shrink-0 text-right text-xs tabular-nums", below ? "text-destructive" : "text-muted-foreground")}>
                {item.orders_per_month.toFixed(1)} / {region === null ? "—" : region.toFixed(1)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** 架上缺什麼（連鎖）：主推品類裡，同區其他連鎖超過一半有進、這家近半年沒進過的品項 */
function GapsBlock({ gaps }: { gaps: Gaps }) {
  return (
    <section className="rounded-2xl border-2 bg-card px-4 pb-1 shadow-lip">
      <div className="flex items-baseline justify-between gap-2 py-3">
        <p className="text-sm font-semibold">架上缺什麼</p>
        <p className="text-[0.6875rem] text-muted-foreground">同區連鎖近 90 天有進 · 這家近半年沒進</p>
      </div>
      {gaps.map((gap) => (
        <div key={gap.sku} className="flex min-h-12 items-center justify-between gap-3 border-t py-2">
          <p className="text-sm">{gap.name}</p>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            同區其他 {gap.peers_total} 家連鎖裡 {gap.peers_with} 家有進
          </span>
        </div>
      ))}
    </section>
  )
}

/** 這一檔的進價（獨立藥局與診所）：進行中那一期促銷，一個品項一列，取搭贈後每個最便宜的那一口 */
function DealsBlock({ deals, festival }: { deals: Deals; festival: Festival | null }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">這一檔的進價</h2>
        {deals.promotion_name && <p className="truncate text-[0.6875rem] text-muted-foreground">{deals.promotion_name}</p>}
      </div>
      {!deals.promotion_name && <p className="mt-2 text-sm text-muted-foreground">這一期沒有促銷。</p>}
      {deals.items.length > 0 && (
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
          {/* 主推品類裡沒有促銷品項，後端退回全部品類 */}
          {festival && !deals.scoped && `${festival.categories.join("、")}這一期沒有促銷品項，改列全部品類。`}
          每個品項取搭贈後每個最便宜的那一口，照建議售價賣一個的毛利率由高到低；另外加贈的品項與滿額贈不算在內。
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-2">
        {deals.items.map((item) => (
          <li key={item.sku} className="rounded-xl border-2 bg-card px-4 py-3 shadow-lip">
            <div className="flex items-start justify-between gap-3">
              <p className="leading-snug font-medium">{item.name}</p>
              <Badge variant="secondary">毛利 {formatRate(item.profit_rate, 1)}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.deal}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-2 text-center">
              <div>
                <dt className="text-[0.6875rem] text-muted-foreground">每口</dt>
                <dd className="text-sm font-medium tabular-nums">{formatMoney(item.deal_price)}</dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] text-muted-foreground">搭贈後每個</dt>
                <dd className="text-sm font-medium tabular-nums">{formatUnitPrice(item.unit_deal_price)}</dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] text-muted-foreground">賣一個賺</dt>
                <dd className="text-sm font-medium text-primary tabular-nums">{formatUnitPrice(item.unit_profit)}</dd>
              </div>
            </dl>
            {/* 獨立店在意一次要壓多少貨：每個最便宜的那一口通常是大口，另外標出最小一口要多少錢 */}
            <p className="mt-2 text-[0.6875rem] text-muted-foreground tabular-nums">
              建議售價 {formatMoney(item.list_price)} · 最小一口 {formatMoney(item.smallest_deal_price)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 這家的條件（獨立藥局與診所）：供貨價、通路獎勵、付款、業務可以直接給的折扣、近 90 天進貨。成數是內部文件的規定 */
function TermsBlock({ terms }: { terms: Terms }) {
  const rows = [
    { label: "供貨價", value: `建議售價的 ${formatRate(terms.supply_rate)}` },
    {
      label: "通路獎勵",
      value: terms.channel_reward_rate === null ? "不適用" : `進貨金額的 ${formatRate(terms.channel_reward_rate)}`,
    },
    {
      label: "付款條件",
      value: `月結 ${terms.payment_days} 天`,
      note: terms.ar_max_age_days === null ? "目前沒有未收帳款" : `目前最久一筆帳款 ${terms.ar_max_age_days} 天`,
      // 帳款拖過付款天數就標紅
      alert: terms.ar_max_age_days !== null && terms.ar_max_age_days > terms.payment_days,
    },
    { label: "可以直接給的折扣", value: `${terms.free_discount_pct}% 以內`, note: "超過要簽核" },
    {
      label: "近 90 天進貨",
      value: formatMoney(terms.amount_last_90d),
      note: terms.avg_order_amount === null ? undefined : `單次平均 ${formatMoney(terms.avg_order_amount)}`,
    },
  ]
  return (
    <section className="rounded-2xl border-2 bg-card px-4 pb-1 shadow-lip">
      <p className="py-3 text-sm font-semibold">這家的條件</p>
      {rows.map((row) => (
        <div key={row.label} className="flex min-h-12 items-center justify-between gap-3 border-t py-2">
          <p className="shrink-0 text-xs text-muted-foreground">{row.label}</p>
          <div className="text-right">
            <p className="text-sm tabular-nums">{row.value}</p>
            {row.note && <p className={cn("text-[0.6875rem]", row.alert ? "text-destructive" : "text-muted-foreground")}>{row.note}</p>}
          </div>
        </div>
      ))}
    </section>
  )
}

/** FR-3.2：依這家客戶的情況，列出內部文件裡相關的規定原文 */
function Tips({ tips }: { tips: NegotiationCard["tips"] }) {
  return (
    <section className="rounded-2xl border-2 border-primary/25 bg-primary/10 p-4 shadow-lip-primary-soft">
      <p className="text-xs font-semibold tracking-wide text-primary">內部文件建議的切入點</p>
      {tips.length === 0 && <p className="mt-2 text-sm text-muted-foreground">內部文件裡沒有找到適用的段落。</p>}
      <ol className="mt-3 flex flex-col gap-4">
        {tips.map((tip) => (
          <li key={`${tip.source_name}-${tip.section}`} className="flex flex-col gap-1">
            <span className="text-[0.6875rem] text-muted-foreground">因為{tip.reason}</span>
            <p className="text-sm font-medium">{tip.section}</p>
            <p className="text-[0.8125rem] leading-relaxed text-foreground/80">{tip.content}</p>
            <span className="text-[0.6875rem] text-muted-foreground">出處：{tip.doc_title}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

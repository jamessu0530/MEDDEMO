import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import {
  createQuote,
  getCustomer,
  getLastOrder,
  getQuoteItems,
  getQuotePromotion,
  type Customer,
  type LastOrder,
  type QuoteItem,
  type QuotePromotion,
} from "@/api/customers"
import { ChangeNote } from "@/components/change-note"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { approvalFlash, DISCOUNT_MAX, DISCOUNT_STEP, discountSteps, parseDiscount, REASON_MAX_LENGTH } from "@/lib/approval"
import { useAuth } from "@/lib/auth"
import { formatMoney } from "@/lib/format"
import { lastOrderSources, repeatFill } from "@/lib/last-order"
import { packDeal, quoteBlocked, quoteTotal } from "@/lib/quote"
import { customerNotFoundText } from "@/lib/scope"
import { cn } from "@/lib/utils"
import type { CustomerLocationState } from "@/pages/customer"

type LoadState =
  | { status: "loading" }
  // missing：後端回 404（沒有這家，或不是登入者看得到的客戶）
  | { status: "error"; missing: boolean }
  // promotion：這一期的促銷，沒有進行中的一期是 null
  | { status: "ready"; customer: Customer; items: QuoteItem[]; promotion: QuotePromotion | null }

// 數量輸入框的內容；打字途中可能是空字串，算金額時當 0
type Quantities = Record<string, string>

function parseQty(text: string | undefined) {
  const value = Math.floor(Number(text))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 依 key 分組，保留第一次出現的順序：促銷品項的編號本來就依品牌排在一起 */
function groupBy<T>(rows: T[], key: (row: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  return [...groups]
}

/**
 * 開報價（原型客戶檔案的「開報價」）：列這家近半年常進的品項與這一期的促銷，改數量或口數後開 SAP 報價草稿；
 * 0 的列不送。促銷的口照每口售價、不打折；折扣只套在沒促銷的列，在業務的權限（3%）內直接開，
 * 超過的會開優惠申請單送簽，模型有把握就由系統核准
 */
export function QuotePage() {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  const user = useAuth()?.user
  const profilePath = `/customers/${customerId}`
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [quantities, setQuantities] = useState<Quantities>({})
  // 促銷的口數，key 是促銷品項編號
  const [packCounts, setPackCounts] = useState<Quantities>({})
  const [discountText, setDiscountText] = useState("")
  const [reason, setReason] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 上次訂的：沒訂過或載不到是 null，就不顯示「照上次填」
  const [last, setLast] = useState<LastOrder | null>(null)
  // 照上次填加的列（頁面上本來沒有的品項）與變了的那幾句（不走促銷用料號、口用促銷品項編號）
  const [extraItems, setExtraItems] = useState<QuoteItem[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getCustomer(customerId, controller.signal),
      getQuoteItems(customerId, controller.signal),
      getQuotePromotion(customerId, controller.signal),
    ])
      .then(([customer, items, promotion]) => {
        // 預設都不列入：報價通常只有一兩項，全部預填常進數量的話，直接按送出就是一張十幾項的報價單寫進 SAP。
        // 每一列的「常進 N」點一下就填入；促銷的口與「不走促銷」也從 0 開始
        const products = promotion?.products ?? []
        const skus = [...items.map((item) => item.sku), ...products.filter((p) => !p.usual).map((p) => p.sku)]
        setQuantities(Object.fromEntries(skus.map((sku) => [sku, "0"])))
        setPackCounts(Object.fromEntries(products.flatMap((p) => p.packs.map((pack) => [pack.code, "0"]))))
        setState({ status: "ready", customer, items, promotion })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: err instanceof ApiError && err.status === 404 })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  // 上次訂的另外問：問不到就少一個按鈕，不擋開報價
  useEffect(() => {
    const controller = new AbortController()
    getLastOrder(customerId, controller.signal)
      .then(setLast)
      .catch(() => {
        if (!controller.signal.aborted) setLast(null)
      })
    return () => controller.abort()
  }, [customerId])

  const baseItems = state.status === "ready" ? state.items : []
  // 照上次填加的列接在常進品項後面，算法跟常進品項一樣
  const items = [...baseItems, ...extraItems]
  const promotion = state.status === "ready" ? state.promotion : null
  const lines = items.map((item) => ({ item, qty: parseQty(quantities[item.sku]) }))
  // 促銷品項沒有交易、不在常進品項裡：「不走促銷」那一列照供貨價，跟常進品項一樣算
  const extraPlain: QuoteItem[] = (promotion?.products ?? [])
    .filter((p) => !p.usual)
    .map((p) => ({ sku: p.sku, name: p.name, spec: p.spec, unit: p.unit, unit_price: p.supply_price, usual_qty: 0 }))
  const chosen = [...items, ...extraPlain]
    .map((item) => ({ item, qty: parseQty(quantities[item.sku]) }))
    .filter((line) => line.qty > 0)
  const chosenPacks = (promotion?.products ?? [])
    .flatMap((p) => p.packs)
    .map((pack) => ({ pack, count: parseQty(packCounts[pack.code]) }))
    .filter((line) => line.count > 0)
  const plainLines = chosen.map((line) => ({ qty: line.qty, unitPrice: line.item.unit_price }))
  const packLines = chosenPacks.map((line) => ({ packs: line.count, dealPrice: line.pack.deal_price }))
  const discount = parseDiscount(discountText)
  const route = discountSteps(discount)
  const needsApproval = route.steps.length > 0
  const listTotal = quoteTotal(plainLines, packLines, 0)
  const total = route.valid ? quoteTotal(plainLines, packLines, discount) : listTotal
  // 送不出去的原因，寫在按鈕上
  const blocked = quoteBlocked({ plainCount: chosen.length, packCount: chosenPacks.length, discount, route, reason })
  const hasLines = items.length > 0 || promotion !== null

  function fillFromLast() {
    if (!last) return
    const skus = [...baseItems, ...extraPlain].map((item) => item.sku)
    const codes = (promotion?.products ?? []).flatMap((p) => p.packs.map((pack) => pack.code))
    const fill = repeatFill(last, skus, codes)
    setQuantities(fill.quantities)
    setPackCounts(fill.packCounts)
    setExtraItems(fill.extra)
    setNotes(fill.notes)
  }

  async function submit() {
    setSending(true)
    setError(null)
    try {
      const quote = await createQuote(
        customerId,
        [
          ...chosen.map((line) => ({ sku: line.item.sku, qty: line.qty })),
          ...chosenPacks.map((line) => ({ promo_code: line.pack.code, packs: line.count })),
        ],
        discount,
        needsApproval ? reason.trim() : ""
      )
      const opened = discount > 0 ? `報價 ${quote.quote_no} 已開，折扣 ${discount}%` : `已開 SAP 報價草稿 ${quote.quote_no}`
      // 回客戶檔案：重新載入時待處理事項就會出現這張；replace 讓返回鍵不會再回到填好的報價單
      navigate(profilePath, {
        replace: true,
        state: { flash: quote.approval ? approvalFlash(opened, quote.approval) : opened } satisfies CustomerLocationState,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "送出失敗，請再試一次")
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="開報價" subtitle={state.status === "ready" ? state.customer.name : undefined} backTo={profilePath} />
      {/* 底部固定那一塊有折扣、合計與送出鈕；要寫理由時更高，清單最後一項才不會被蓋住 */}
      <main className={cn("flex flex-1 flex-col gap-3 px-4 pt-4", needsApproval ? "pb-80" : "pb-56")}>
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入常進品項中…</p>}
        {state.status === "error" && state.missing && (
          <Notice text={customerNotFoundText(user)} action={{ label: "回客戶清單", onClick: () => navigate("/customers") }} />
        )}
        {state.status === "error" && !state.missing && (
          <Notice
            text="連不上伺服器，常進品項沒有載入。"
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
        {state.status === "ready" && !hasLines && (
          <Notice
            text="這家近半年沒有進貨紀錄，也沒有進行中的促銷，沒有可以帶入的品項。"
            action={{ label: "回客戶檔案", onClick: () => navigate(profilePath) }}
          />
        )}
        {state.status === "ready" && last && (
          <Button variant="outline" className="h-11" onClick={fillFromLast}>
            照上次填（{lastOrderSources(last, "、")}）
          </Button>
        )}
        {items.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">這家近半年常進的品項，單價是給這家的供貨價。填了數量的才會列進報價。</p>
            <ul className="flex flex-col gap-2">
              {lines.map(({ item, qty }) => (
                <li key={item.sku} className={cn("rounded-xl border-2 bg-card px-4 py-3 shadow-lip", qty === 0 && "bg-muted/60")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={cn("min-w-0 text-sm font-medium", qty === 0 && "text-muted-foreground")}>
                      {item.name}
                      {item.spec && <span className="ml-1 font-normal text-muted-foreground">{item.spec}</span>}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatMoney(item.unit_price)} / {item.unit}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={quantities[item.sku] ?? ""}
                      onChange={(event) => setQuantities((current) => ({ ...current, [item.sku]: event.target.value }))}
                      aria-label={`${item.name}${item.spec} 數量`}
                      className="h-11 w-24 bg-card tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">{item.unit}</span>
                    <span className={cn("ml-auto text-sm tabular-nums", qty === 0 ? "text-muted-foreground" : "font-medium")}>
                      {qty === 0 ? "不列入" : formatMoney(qty * item.unit_price)}
                    </span>
                  </div>
                  {item.usual_qty > 0 && (
                    <button
                      type="button"
                      onClick={() => setQuantities((current) => ({ ...current, [item.sku]: String(item.usual_qty) }))}
                      className="mt-1 -ml-2 flex min-h-11 items-center rounded-lg px-2 text-xs text-primary active:bg-muted"
                    >
                      填入常進數量 {item.usual_qty} {item.unit}
                    </button>
                  )}
                  {notes[item.sku] && <ChangeNote text={notes[item.sku]} className="mt-1" />}
                </li>
              ))}
            </ul>
          </>
        )}
        {promotion && (
          <PromotionSection
            promotion={promotion}
            packCounts={packCounts}
            quantities={quantities}
            notes={notes}
            onPackChange={(code, value) => setPackCounts((current) => ({ ...current, [code]: value }))}
            onQtyChange={(sku, value) => setQuantities((current) => ({ ...current, [sku]: value }))}
          />
        )}
      </main>

      {hasLines && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md flex-col gap-2 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {/* 折扣跟合計、送出鈕放在一起：清單有十幾項，放在清單後面要捲到底才看得到 */}
          <div className="flex items-center gap-2">
            <label htmlFor="quote-discount" className="shrink-0 text-sm font-medium">
              折扣
            </label>
            <Input
              id="quote-discount"
              type="number"
              inputMode="decimal"
              min={0}
              max={DISCOUNT_MAX}
              step={DISCOUNT_STEP}
              value={discountText}
              placeholder="0"
              onChange={(event) => setDiscountText(event.target.value)}
              aria-invalid={!route.valid}
              className="h-11 w-20 bg-card tabular-nums"
            />
            <span className="shrink-0 text-sm text-muted-foreground">%</span>
            {/* 填的時候就知道這個折扣要誰簽（《報價權限與折扣審核》） */}
            <p className={cn("min-w-0 flex-1 text-xs leading-snug", route.valid ? "text-muted-foreground" : "text-destructive")}>
              {route.valid && discount === 0 ? "3% 以內不用簽核" : route.text}
            </p>
          </div>
          {chosenPacks.length > 0 && (
            <p className="text-xs text-muted-foreground">折扣只套在沒促銷的品項，促銷的口照每口售價</p>
          )}
          {needsApproval && (
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="申請理由：客戶的進貨金額、競品開的條件"
              aria-label="申請理由"
              maxLength={REASON_MAX_LENGTH}
              rows={2}
              className="bg-card"
            />
          )}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              合計 {chosen.length + chosenPacks.length} 項{route.valid && discount > 0 && `，折扣 ${discount}%`}
            </span>
            <span className="flex items-baseline gap-2">
              {total !== listTotal && (
                <span className="text-xs text-muted-foreground tabular-nums line-through">{formatMoney(listTotal)}</span>
              )}
              <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
            </span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="h-12 text-base" disabled={sending || blocked !== null} onClick={submit}>
            {sending ? "開立中…" : (blocked ?? (needsApproval ? "開報價並送簽核" : "開 SAP 報價草稿"))}
          </Button>
        </div>
      )}
    </div>
  )
}

type PromotionSectionProps = {
  promotion: QuotePromotion
  packCounts: Quantities
  quantities: Quantities
  notes: Record<string, string>
  onPackChange: (code: string, value: string) => void
  onQtyChange: (sku: string, value: string) => void
}

/**
 * 這一期的促銷：依品牌、品項列出每一口，填口數就照每口售價列入。促銷品項沒有交易、不在常進品項裡，
 * 每個品項另外有一列「不走促銷」照供貨價填數量
 */
function PromotionSection({ promotion, packCounts, quantities, notes, onPackChange, onQtyChange }: PromotionSectionProps) {
  return (
    <section className="flex flex-col gap-2 pt-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">這一期的促銷</h2>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{promotion.name}</span>
      </div>
      {promotion.pm_note && (
        <details className="rounded-xl border-2 bg-card px-4 py-1 text-xs shadow-lip">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">整張訂單的活動</summary>
          <p className="whitespace-pre-line text-muted-foreground">{promotion.pm_note}</p>
          <p className="mt-2 mb-2 text-muted-foreground">系統不算滿額贈與禮券，給你跟客戶談的時候參考。</p>
        </details>
      )}
      {groupBy(promotion.products, (p) => p.group_name).map(([group, products]) => (
        <div key={group} className="flex flex-col gap-2">
          <h3 className="pt-1 text-xs font-medium text-muted-foreground">{group}</h3>
          {products.map((product) => {
            const qty = parseQty(quantities[product.sku])
            return (
              <ul key={product.sku} className="flex flex-col gap-2">
                {product.packs.map((pack) => {
                  const count = parseQty(packCounts[pack.code])
                  return (
                    <li
                      key={pack.code}
                      className={cn("rounded-xl border-2 bg-card px-4 py-3 shadow-lip", count === 0 && "bg-muted/60")}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={cn("min-w-0 text-sm font-medium", count === 0 && "text-muted-foreground")}>{pack.name}</p>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatMoney(pack.deal_price)} / 口
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {packDeal(pack)}・{pack.deal}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={packCounts[pack.code] ?? ""}
                          onChange={(event) => onPackChange(pack.code, event.target.value)}
                          aria-label={`${pack.name} 口數`}
                          className="h-11 w-24 bg-card tabular-nums"
                        />
                        <span className="text-sm text-muted-foreground">口</span>
                        <span className={cn("ml-auto text-sm tabular-nums", count === 0 ? "text-muted-foreground" : "font-medium")}>
                          {count === 0 ? "不列入" : formatMoney(count * pack.deal_price)}
                        </span>
                      </div>
                      {notes[pack.code] && <ChangeNote text={notes[pack.code]} className="mt-1" />}
                    </li>
                  )
                })}
                {!product.usual && (
                  <li className={cn("rounded-xl border-2 bg-card px-4 py-3 shadow-lip", qty === 0 && "bg-muted/60")}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={cn("min-w-0 text-sm font-medium", qty === 0 && "text-muted-foreground")}>
                        {product.name} 不走促銷
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatMoney(product.supply_price)} / {product.unit}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={quantities[product.sku] ?? ""}
                        onChange={(event) => onQtyChange(product.sku, event.target.value)}
                        aria-label={`${product.name} 不走促銷的數量`}
                        className="h-11 w-24 bg-card tabular-nums"
                      />
                      <span className="text-sm text-muted-foreground">{product.unit}</span>
                      <span className={cn("ml-auto text-sm tabular-nums", qty === 0 ? "text-muted-foreground" : "font-medium")}>
                        {qty === 0 ? "不列入" : formatMoney(qty * product.supply_price)}
                      </span>
                    </div>
                    {notes[product.sku] && <ChangeNote text={notes[product.sku]} className="mt-1" />}
                  </li>
                )}
              </ul>
            )
          })}
        </div>
      ))}
    </section>
  )
}

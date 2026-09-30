import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { createQuote, getCustomer, getQuoteItems, type Customer, type QuoteItem } from "@/api/customers"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { approvalFlash, DISCOUNT_MAX, DISCOUNT_STEP, discountSteps, parseDiscount, REASON_MAX_LENGTH } from "@/lib/approval"
import { useAuth } from "@/lib/auth"
import { formatMoney } from "@/lib/format"
import { customerNotFoundText } from "@/lib/scope"
import { cn } from "@/lib/utils"
import type { CustomerLocationState } from "@/pages/customer"

type LoadState =
  | { status: "loading" }
  // missing：後端回 404（沒有這家，或不是登入者看得到的客戶）
  | { status: "error"; missing: boolean }
  | { status: "ready"; customer: Customer; items: QuoteItem[] }

// 數量輸入框的內容；打字途中可能是空字串，算金額時當 0
type Quantities = Record<string, string>

function parseQty(text: string | undefined) {
  const value = Math.floor(Number(text))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 折扣後的單價到分、整張報價到元，算法跟後端一樣（api/customers.py），畫面上的金額才跟開出來的報價對得上 */
function discountedTotal(lines: { qty: number; unitPrice: number }[], pct: number) {
  const keep = 200 - Math.round(pct * 2)
  return Math.round(lines.reduce((sum, line) => sum + (Math.round((line.unitPrice * keep) / 2) / 100) * line.qty, 0))
}

/**
 * 開報價（原型客戶檔案的「開報價」）：列這家近半年常進的品項，改數量後開 SAP 報價草稿；數量 0 的品項不送。
 * 折扣在業務的權限（3%）內直接開；超過的會開優惠申請單送簽，模型有把握就由系統核准
 */
export function QuotePage() {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  const user = useAuth()?.user
  const profilePath = `/customers/${customerId}`
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [quantities, setQuantities] = useState<Quantities>({})
  const [discountText, setDiscountText] = useState("")
  const [reason, setReason] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getCustomer(customerId, controller.signal), getQuoteItems(customerId, controller.signal)])
      .then(([customer, items]) => {
        // 預設都不列入：報價通常只有一兩項，全部預填常進數量的話，直接按送出就是一張十幾項的報價單寫進 SAP。
        // 每一列的「常進 N」點一下就填入
        setQuantities(Object.fromEntries(items.map((item) => [item.sku, "0"])))
        setState({ status: "ready", customer, items })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: err instanceof ApiError && err.status === 404 })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  const items = state.status === "ready" ? state.items : []
  const lines = items.map((item) => ({ item, qty: parseQty(quantities[item.sku]) }))
  const chosen = lines.filter((line) => line.qty > 0)
  const listTotal = chosen.reduce((sum, line) => sum + line.qty * line.item.unit_price, 0)
  const discount = parseDiscount(discountText)
  const route = discountSteps(discount)
  const needsApproval = route.steps.length > 0
  const total = route.valid
    ? discountedTotal(chosen.map((line) => ({ qty: line.qty, unitPrice: line.item.unit_price })), discount)
    : listTotal
  // 送不出去的原因，寫在按鈕上
  const blocked =
    chosen.length === 0
      ? "至少要有一項數量大於 0"
      : !route.valid
        ? route.text
        : needsApproval && !reason.trim()
          ? "要送簽核，請寫申請理由"
          : null

  async function submit() {
    setSending(true)
    setError(null)
    try {
      const quote = await createQuote(
        customerId,
        chosen.map((line) => ({ sku: line.item.sku, qty: line.qty })),
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
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-44">
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
        {state.status === "ready" && items.length === 0 && (
          <Notice
            text="這家近半年沒有進貨紀錄，沒有可以帶入的品項。"
            action={{ label: "回客戶檔案", onClick: () => navigate(profilePath) }}
          />
        )}
        {items.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">這家近半年常進的品項，單價是給這家的供貨價。填了數量的才會列進報價。</p>
            <ul className="flex flex-col gap-2">
              {lines.map(({ item, qty }) => (
                <li key={item.sku} className={cn("rounded-xl border bg-card px-4 py-3", qty === 0 && "bg-muted/60")}>
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
                  <button
                    type="button"
                    onClick={() => setQuantities((current) => ({ ...current, [item.sku]: String(item.usual_qty) }))}
                    className="mt-1 -ml-2 flex min-h-11 items-center rounded-lg px-2 text-xs text-primary active:bg-muted"
                  >
                    填入常進數量 {item.usual_qty} {item.unit}
                  </button>
                </li>
              ))}
            </ul>
            <section className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3">
              <div className="flex items-center gap-2">
                <label htmlFor="quote-discount" className="text-sm font-medium">
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
                  className="ml-auto h-11 w-24 bg-card tabular-nums"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              {/* 填的時候就知道這個折扣要誰簽（《報價權限與折扣審核》） */}
              <p className={cn("text-xs", route.valid ? "text-muted-foreground" : "text-destructive")}>
                {route.valid && discount === 0 ? "整張報價一個折扣，套在供貨價上；3% 以內不用簽核。" : route.text}
              </p>
              {needsApproval && (
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="申請理由：客戶的進貨金額、競品開的條件"
                  aria-label="申請理由"
                  maxLength={REASON_MAX_LENGTH}
                  rows={2}
                />
              )}
            </section>
          </>
        )}
      </main>

      {items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md flex-col gap-2 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              合計 {chosen.length} 項{route.valid && discount > 0 && `，折扣 ${discount}%`}
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

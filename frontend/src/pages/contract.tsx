import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { createContractRequest, getContract, getCustomer, type Contract, type Customer } from "@/api/customers"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { approvalFlash, contractRoute, formatRate, REASON_MAX_LENGTH } from "@/lib/approval"
import { useAuth } from "@/lib/auth"
import { customerNotFoundText } from "@/lib/scope"
import { cn } from "@/lib/utils"
import type { CustomerLocationState } from "@/pages/customer"

type LoadState =
  | { status: "loading" }
  // missing：後端回 404（沒有這家，或不是登入者看得到的客戶）；notChain：409，只有連鎖客戶有通路合約
  | { status: "error"; reason: "missing" | "notChain" | "offline" }
  | { status: "ready"; customer: Customer; contract: Contract }

const TERMS = [12, 24] as const
// 費率的上限（後端同一個數字）：擋掉把 8 打成 80 這種誤填
const RATE_MAX_PERCENT = 20

/** 費率輸入框的內容（百分比）→ 費率，到 0.1 個百分點。沒填或亂打是 null */
function parseRate(text: string) {
  const value = Number(text)
  if (text.trim() === "" || !Number.isFinite(value) || value < 0 || value > RATE_MAX_PERCENT) return null
  return Math.round(value * 10) / 1000
}

const percentText = (rate: number) => String(Math.round(rate * 1000) / 10)

/**
 * 連鎖續約：顯示目前的合約條件，填續約月數與新的兩個費率（預設是原值）。
 * 照原費率由區處主管核准（模型有把握就由系統核准），費率一改就要再送業務處長
 */
export function ContractPage() {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  const user = useAuth()?.user
  const profilePath = `/customers/${customerId}`
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [term, setTerm] = useState<(typeof TERMS)[number]>(12)
  const [listingText, setListingText] = useState("")
  const [rewardText, setRewardText] = useState("")
  const [reason, setReason] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getCustomer(customerId, controller.signal), getContract(customerId, controller.signal)])
      .then(([customer, contract]) => {
        // 新費率預設是原值：大多數的續約照原費率
        setListingText(percentText(contract.listing_fee_rate))
        setRewardText(percentText(contract.channel_reward_rate))
        setState({ status: "ready", customer, contract })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        const status = err instanceof ApiError ? err.status : 0
        setState({ status: "error", reason: status === 404 ? "missing" : status === 409 ? "notChain" : "offline" })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  const contract = state.status === "ready" ? state.contract : null
  const listing = parseRate(listingText)
  const reward = parseRate(rewardText)
  const route =
    contract && listing !== null && reward !== null
      ? contractRoute(contract.listing_fee_rate, listing, contract.channel_reward_rate, reward)
      : null
  // 送不出去的原因，寫在按鈕上
  const blocked = !route ? `費率要在 0～${RATE_MAX_PERCENT}% 之間` : route.changed && !reason.trim() ? "費率有調整，請寫申請理由" : null

  async function submit() {
    if (listing === null || reward === null) return
    setSending(true)
    setError(null)
    try {
      const approval = await createContractRequest(customerId, {
        term_months: term,
        listing_fee_rate: listing,
        channel_reward_rate: reward,
        reason: reason.trim(),
      })
      // 回客戶檔案：合約那一列會變成「續約申請簽核中」，或是新的到期日
      navigate(profilePath, {
        replace: true,
        state: { flash: approvalFlash(`續約申請 ${approval.form_no}`, approval) } satisfies CustomerLocationState,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "送出失敗，請再試一次")
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="申請續約" subtitle={state.status === "ready" ? state.customer.name : undefined} backTo={profilePath} />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入合約條件中…</p>}
        {state.status === "error" && state.reason === "missing" && (
          <Notice text={customerNotFoundText(user)} action={{ label: "回客戶清單", onClick: () => navigate("/customers") }} />
        )}
        {state.status === "error" && state.reason === "notChain" && (
          <Notice text="只有連鎖客戶有通路合約。" action={{ label: "回客戶檔案", onClick: () => navigate(profilePath) }} />
        )}
        {state.status === "error" && state.reason === "offline" && (
          <Notice
            text="連不上伺服器，合約條件沒有載入。"
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
        {contract && (
          <>
            <section className="rounded-2xl border-2 bg-card px-4 py-3 shadow-lip">
              <p className="text-sm font-semibold">目前的條件</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Term label="到期日" value={contract.contract_end_date?.replaceAll("-", "/") ?? "—"} warn={contract.ending_soon} />
                <Term label="上架費率" value={formatRate(contract.listing_fee_rate)} />
                <Term label="通路獎勵" value={formatRate(contract.channel_reward_rate)} />
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground">費率是近 90 天交易的上架費、通路獎勵除以進貨金額，跟談判卡的毛利結構同一個算法。</p>
            </section>

            {contract.pending_form_id ? (
              <Notice
                text="這家客戶已經有一張續約申請在簽核中，簽完才能再送。"
                action={{ label: "看申請單", onClick: () => navigate(`/oa/forms/${contract.pending_form_id}`) }}
                secondary={{ label: "回客戶檔案", onClick: () => navigate(profilePath) }}
              />
            ) : !contract.can_request ? (
              // 直接打網址進來、而合約離到期還久：說明原因，不給表單
              <Notice
                text={contract.blocked_reason ?? "這家客戶現在還不能申請續約。"}
                action={{ label: "回客戶檔案", onClick: () => navigate(profilePath) }}
              />
            ) : (
              <>
                <section className="flex flex-col gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lip">
                  <div>
                    <p className="text-sm font-medium">續約多久</p>
                    <div className="mt-2 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm" role="radiogroup" aria-label="續約月數">
                      {TERMS.map((months) => (
                        <button
                          key={months}
                          type="button"
                          role="radio"
                          aria-checked={term === months}
                          onClick={() => setTerm(months)}
                          className={cn("h-9 rounded-md", term === months ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}
                        >
                          {months} 個月
                        </button>
                      ))}
                    </div>
                  </div>
                  <RateInput id="contract-listing" label="新的上架費率" value={listingText} onChange={setListingText} invalid={listing === null} />
                  <RateInput id="contract-reward" label="新的通路獎勵比率" value={rewardText} onChange={setRewardText} invalid={reward === null} />
                  {/* 填的時候就知道要誰簽（《連鎖通路合約條件》） */}
                  <p className={cn("text-xs", route ? (route.changed ? "text-warning" : "text-muted-foreground") : "text-destructive")}>
                    {route ? route.text : `費率要在 0～${RATE_MAX_PERCENT}% 之間`}
                  </p>
                  <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={route?.changed ? "申請理由：通路要求的條件、這家的進貨金額" : "申請理由（照原費率可以不寫）"}
                    aria-label="申請理由"
                    maxLength={REASON_MAX_LENGTH}
                    rows={2}
                  />
                </section>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="h-12 text-base" disabled={sending || blocked !== null} onClick={submit}>
                  {sending ? "送出中…" : (blocked ?? "送出續約申請")}
                </Button>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function Term({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-semibold tabular-nums", warn && "text-warning")}>{value}</dd>
    </div>
  )
}

function RateInput({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  invalid: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={RATE_MAX_PERCENT}
        step={0.5}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        className="ml-auto h-11 w-24 bg-card tabular-nums"
      />
      <span className="text-sm text-muted-foreground">%</span>
    </div>
  )
}

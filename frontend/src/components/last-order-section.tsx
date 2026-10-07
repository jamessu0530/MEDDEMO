import { useEffect, useState } from "react"

import { getLastOrder, type LastOrder } from "@/api/customers"
import { ChangeNote } from "@/components/change-note"
import { lastOrderLine, lastOrderSources, splitLastOrder } from "@/lib/last-order"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; last: LastOrder | null }

/**
 * 客戶檔案「上次訂的」：上一次進貨與上一張報價合起來，促銷變了的列在前、底下寫變了什麼（services/last_order.py）。
 * 載不到只有這一區顯示失敗，客戶檔案其他區照常
 */
export function LastOrderSection({ customerId }: { customerId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getLastOrder(customerId, controller.signal)
      .then((last) => setState({ status: "ready", last }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  const last = state.status === "ready" ? state.last : null
  const { visible, hidden } = last ? splitLastOrder(last.lines) : { visible: [], hidden: [] }
  const rows = expanded ? [...visible, ...hidden] : visible

  return (
    <section className="rounded-2xl border-2 bg-card px-4 pb-3 shadow-lip">
      <div className="flex items-baseline justify-between gap-3 py-3">
        <p className="text-sm font-semibold">上次訂的</p>
        {last && <span className="text-xs text-muted-foreground">{lastOrderSources(last)}</span>}
      </div>
      {state.status === "loading" && <p className="pb-1 text-sm text-muted-foreground">載入上次訂的中…</p>}
      {state.status === "error" && (
        <p className="pb-1 text-sm text-muted-foreground">
          上次訂的沒有載入。
          <button type="button" className="ml-1 min-h-11 text-primary" onClick={() => setAttempt((n) => n + 1)}>
            重新載入
          </button>
        </p>
      )}
      {state.status === "ready" && !last && <p className="pb-1 text-sm text-muted-foreground">這家還沒有訂過。</p>}
      {last && (
        <>
          <ul className="flex flex-col">
            {rows.map((line, index) => (
              <li key={`${line.source}-${line.sku}-${line.pack?.code ?? "plain"}-${index}`} className="flex flex-col gap-1 border-t py-2 first:border-t-0">
                <span className="text-sm">{lastOrderLine(line)}</span>
                {line.change && <ChangeNote text={line.change.text} />}
              </li>
            ))}
          </ul>
          {hidden.length > 0 && !expanded && (
            <button type="button" onClick={() => setExpanded(true)} className="flex min-h-11 items-center text-sm text-primary">
              再看 {hidden.length} 項
            </button>
          )}
          <p className="pt-1 text-xs text-muted-foreground">錄音時講「跟上次一樣」，就照這份開報價；促銷變了的那幾項會照上面寫的改。</p>
        </>
      )}
    </section>
  )
}

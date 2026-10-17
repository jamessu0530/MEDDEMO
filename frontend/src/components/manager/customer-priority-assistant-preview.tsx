import { useSyncExternalStore } from "react"
import { customerPriorityAssistant } from "@/ask/customer-priority-assistant"
import { Button } from "@/components/ui/button"
import { strategyChanges } from "@/lib/customer-priority"

export function CustomerPriorityAssistantPreview() {
  const { proposal, busy, disabled } = useSyncExternalStore(
    customerPriorityAssistant.subscribe,
    customerPriorityAssistant.getSnapshot,
    customerPriorityAssistant.getSnapshot
  )
  if (!proposal?.answer.strategy) return null
  const { answer, base } = proposal
  const changes = strategyChanges(base, proposal.answer.strategy)
  return (
    <section
      aria-label="客戶策略調整建議"
      className="space-y-3 rounded-xl border bg-muted/40 p-3"
    >
      <p className="text-sm font-semibold">
        {answer.source === "guide" ? "情境起點" : "AI 建議的客戶策略"}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {answer.context.date} · 團隊 {answer.context.customers} 家 · 近{" "}
        {answer.context.days} 天
        {answer.context.growth_available > 0
          ? `，${answer.context.growth_available} 家可比較成長，其中 ${answer.context.declining_customers} 家營收下滑。`
          : "，目前缺少可比較的成長資料。"}
      </p>
      {changes.length ? (
        <table className="w-full table-fixed text-left text-xs">
          <caption className="sr-only">設定調整前後比較</caption>
          <thead>
            <tr className="border-b">
              <th className="w-[28%] pb-2 font-medium">調整項目</th>
              <th className="pb-2 font-medium">目前</th>
              <th className="pb-2 font-medium">建議</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.label} className="border-b last:border-0">
                <th className="py-2 pr-2 font-normal">{change.label}</th>
                <td className="py-2 pr-2 break-words text-muted-foreground">
                  {change.before}
                </td>
                <td className="py-2 break-words">{change.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm">建議與目前設定相同，可預覽排名再判斷。</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || disabled}
          onClick={customerPriorityAssistant.apply}
        >
          帶入設定並預覽
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={customerPriorityAssistant.dismiss}
        >
          保留目前設定
        </Button>
      </div>
    </section>
  )
}

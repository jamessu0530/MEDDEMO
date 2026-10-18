import { useSyncExternalStore } from "react"
import { askSessionFor } from "@/ask/ask-session"
import { AssistantTasks } from "@/components/ask/assistant-tasks"
import { Button } from "@/components/ui/button"

export function RouteOrderTasks({ userId, canStart }: { userId: string; canStart: boolean }) {
  const asking = askSessionFor(userId)
  useSyncExternalStore(asking.threads.subscribe, asking.threads.getSnapshot, asking.threads.getSnapshot)
  const session = asking.tasks
  const state = useSyncExternalStore(session.queue.subscribe, session.queue.getSnapshot, session.queue.getSnapshot)
  const existing = state.tasks.find((task) => task.capability === "order.route_repeat" && !["completed", "cancelled"].includes(task.status))
  return <section aria-label="路線開單" className="mb-4 space-y-3 rounded-2xl border bg-card p-3">
    <div>
      <h2 className="text-sm font-semibold">今日路線，照上次開單</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">逐店沿用最近成交單的商品與數量，以目前供貨價建草稿。價差與促銷會列出供你確認。</p>
    </div>
    <Button size="sm" variant="outline" disabled={!canStart || existing?.status === "active" || existing?.status === "pending"}
      onClick={() => {
        const target = { conversation: asking.conversation, source: "typed" as const }
        if (existing) session.resume(existing.id, target)
        else session.startRoute(target)
      }}>{existing ? existing.status === "active" ? "正在逐店建立草稿" : "繼續路線開單" : "依今日路線建立草稿"}</Button>
    <AssistantTasks session={session} conversation={asking.conversation} />
  </section>
}

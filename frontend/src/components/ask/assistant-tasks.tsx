import { useEffect, useSyncExternalStore } from "react"
import { Link, useNavigate } from "react-router"
import type { Conversation } from "@/ask/conversation"
import type { TaskSession } from "@/ask/task-session"
import type { TaskStatus } from "@/ask/task-queue"
import { Button } from "@/components/ui/button"

const labels: Record<TaskStatus, string> = {
  pending: "等待處理", active: "處理中", paused: "已暫停", waiting: "等待補充",
  completed: "已完成", cancelled: "已取消", error: "需要重試",
}

export function AssistantTasks({ session, conversation }: { session: TaskSession; conversation: Conversation }) {
  const state = useSyncExternalStore(session.queue.subscribe, session.queue.getSnapshot, session.queue.getSnapshot)
  const navigation = useSyncExternalStore(session.subscribe, session.getNavigation, session.getNavigation)
  const navigate = useNavigate()
  useEffect(() => {
    if (!navigation) return
    session.acknowledgeNavigation(navigation.key)
    void navigate(navigation.path)
  }, [navigation, navigate, session])
  if (!state.tasks.length) return null
  const remaining = state.tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length
  return (
    <details open className="min-w-0 rounded-xl border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">工作清單 · {remaining} 項待處理／共 {state.tasks.length} 項</summary>
      <ol aria-label="助理工作清單" className="mt-3 max-h-64 space-y-3 overflow-y-auto">
        {state.tasks.map((task) => {
          const blocked = task.dependsOn.some((id) => state.tasks.find((item) => item.id === id)?.status !== "completed")
          const cancelledDependency = task.dependsOn.some((id) => state.tasks.find((item) => item.id === id)?.status === "cancelled")
          return (
            <li key={task.id} className="min-w-0 rounded-lg border bg-background p-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{task.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{labels[task.status]}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground" role="status">{cancelledDependency ? "前置工作已取消，請重新交辦這項工作並指定新的順序。" : blocked ? "等待前面的工作完成；可先補充前面工作的資料。" : task.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {task.status !== "cancelled" && (
                  <Button size="sm" variant="outline" disabled={task.status === "active" || blocked}
                    onClick={() => session.resume(task.id, { conversation, source: "typed" })}>
                    {task.status === "completed" ? task.batch ? "更新進度" : "返回工作" : task.status === "error" ? "重試" : "繼續"}
                  </Button>
                )}
                {task.capability === "order.route_repeat" && task.status === "active" && <Button size="sm" variant="outline" onClick={() => void session.pause(task.id)}>暫停</Button>}
                {!["completed", "cancelled"].includes(task.status) && (
                  <Button size="sm" variant="ghost" onClick={() => void session.cancel(task.id)}>{task.status === "active" ? "停止後續" : "取消"}</Button>
                )}
                {task.status === "cancelled" && task.resource && <Button size="sm" variant="outline" onClick={() => session.openResource(task.id)}>查看已儲存內容</Button>}
              </div>
              {task.batch && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">{task.batch.rep_name} · {task.batch.route_date} · 依啟動時路線順序（第 {task.batch.route_version} 版）</p>
                  <progress className="h-2 w-full accent-primary" aria-label={`${task.title}店家進度`} max={task.batch.stores.length}
                    value={task.batch.stores.filter((store) => store.status !== "pending").length} />
                  <ol aria-label="逐店開單進度" className="space-y-2">
                    {task.batch.stores.map((store, index) => {
                      const processing = task.status === "active" && store === task.batch!.stores.find((item) => item.status === "pending")
                      return <li key={store.customer_id} className="rounded-md border p-2 text-xs">
                        <div className="flex justify-between gap-2 font-medium"><span>{index + 1}. {store.customer_name}</span>
                          <span className="shrink-0">{processing ? "處理中" : { pending: "等待", completed: "草稿已建立", needs_attention: "待確認", skipped: "已跳過" }[store.status]}</span></div>
                        <p className="mt-1 text-muted-foreground">{store.source_order_no ? `參考 ${store.source_order_no}（${store.source_date}）` : "尚無歷史成交單"}</p>
                        <p className="mt-1 break-words">{store.message}</p>
                        {!!store.warnings.length && <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">{store.warnings.map((warning, n) => <li key={n}>{warning}</li>)}</ul>}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {store.resource && <Button asChild size="sm" variant="outline"><Link to={store.resource.path}>檢查草稿</Link></Button>}
                          {task.status !== "cancelled" && ["pending", "needs_attention"].includes(store.status) && <Button size="sm" variant="ghost" disabled={processing}
                            onClick={() => void session.controlStore(task.id, "skip", store.customer_id, { conversation, source: "typed" })}>跳過這家</Button>}
                          {task.status !== "cancelled" && ["needs_attention", "skipped"].includes(store.status) && <Button size="sm" variant="outline"
                            onClick={() => void session.controlStore(task.id, "retry", store.customer_id, { conversation, source: "typed" })}>重試這家</Button>}
                        </div>
                      </li>
                    })}
                  </ol>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

import { useSyncExternalStore } from "react"
import { Link } from "react-router"
import type { Conversation } from "@/ask/conversation"
import type { TaskSession } from "@/ask/task-session"
import type {
  AssistantTask,
  RouteOrderBatch,
  TaskStatus,
} from "@/ask/task-queue"
import { Button } from "@/components/ui/button"

const labels: Record<TaskStatus, string> = {
  pending: "等待處理",
  active: "處理中",
  paused: "已暫停",
  waiting: "等待補充",
  completed: "已完成",
  cancelled: "已取消",
  error: "需要重試",
}

export function AssistantTasks({
  session,
  conversation,
}: {
  session: TaskSession
  conversation: Conversation
}) {
  const state = useSyncExternalStore(
    session.queue.subscribe,
    session.queue.getSnapshot,
    session.queue.getSnapshot
  )
  if (!state.tasks.length) return null
  const remaining = state.tasks.filter(
    (task) => !["completed", "cancelled"].includes(task.status)
  ).length
  return (
    <details open className="min-w-0 rounded-xl border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        工作清單 · {remaining ? `${remaining} 項待處理` : "已結束"}
      </summary>
      <ol
        aria-label="助理工作清單"
        className="mt-3 max-h-64 space-y-3 overflow-y-auto"
      >
        {state.tasks.map((task) => {
          return (
            <li
              key={task.id}
              className="min-w-0 rounded-lg border bg-background p-2.5"
            >
              <AssistantTaskCard
                task={task}
                session={session}
                conversation={conversation}
              />
            </li>
          )
        })}
      </ol>
    </details>
  )
}

type TaskCardProps = {
  task: AssistantTask
  session: TaskSession
  conversation: Conversation
  embedded?: boolean
}

/** The route page supplies its own heading; both entry points share the same controls. */
export function AssistantTaskCard({
  task,
  session,
  conversation,
  embedded = false,
}: TaskCardProps) {
  const state = useSyncExternalStore(
    session.queue.subscribe,
    session.queue.getSnapshot,
    session.queue.getSnapshot
  )
  const blocked = task.dependsOn.some(
    (id) => state.tasks.find((item) => item.id === id)?.status !== "completed"
  )
  const cancelledDependency = task.dependsOn.some(
    (id) => state.tasks.find((item) => item.id === id)?.status === "cancelled"
  )
  const batch = task.batch
  const completed =
    batch?.stores.filter((store) => store.status === "completed").length ?? 0
  const message = cancelledDependency
    ? "前置工作已取消，請重新交辦。"
    : blocked
      ? "等待前面的工作完成。"
      : task.message
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {embedded && batch ? (
          <p className="text-sm">
            已建草稿{" "}
            <span className="font-semibold tabular-nums">
              {completed} / {batch.stores.length}
            </span>{" "}
            家
          </p>
        ) : (
          <span className="min-w-0 text-sm font-medium">
            {embedded ? "路線開單" : task.title}
          </span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {batch && task.status === "waiting" ? "待確認" : labels[task.status]}
        </span>
      </div>
      {!batch || blocked || task.status === "error" ? (
        <p
          className="text-xs leading-relaxed text-muted-foreground"
          role="status"
        >
          {message}
        </p>
      ) : (
        !embedded && (
          <p className="text-xs text-muted-foreground">
            已建草稿 {completed} / {batch.stores.length} 家
          </p>
        )
      )}
      {batch && (
        <progress
          className="block h-1.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
          aria-label="草稿建立進度"
          max={batch.stores.length}
          value={completed}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {task.status !== "cancelled" && task.status !== "active" && (
          <Button
            size="sm"
            variant="outline"
            disabled={blocked}
            onClick={() =>
              session.resume(task.id, { conversation, source: "typed" })
            }
          >
            {task.status === "completed"
              ? batch
                ? "更新進度"
                : "返回工作"
              : task.status === "error"
                ? "重試"
                : "繼續"}
          </Button>
        )}
        {task.capability === "order.route_repeat" &&
          task.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void session.pause(task.id)}
            >
              暫停
            </Button>
          )}
        {!["completed", "cancelled"].includes(task.status) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void session.cancel(task.id)}
          >
            {task.status === "active" ? "停止後續" : "取消"}
          </Button>
        )}
        {task.status === "cancelled" && task.resource && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => session.openResource(task.id)}
          >
            查看已儲存內容
          </Button>
        )}
      </div>
      {batch && (
        <RouteStores
          task={task}
          batch={batch}
          session={session}
          conversation={conversation}
        />
      )}
    </div>
  )
}

function RouteStores({
  task,
  batch,
  session,
  conversation,
}: TaskCardProps & { batch: RouteOrderBatch }) {
  const attention = batch.stores.filter(
    (store) => store.status === "needs_attention"
  ).length
  const warnings = batch.stores.reduce(
    (count, store) => count + store.warnings.length,
    0
  )
  const current =
    task.status === "active"
      ? batch.stores.find((store) => store.status === "pending")
      : null
  return (
    <details className="border-t pt-2">
      <summary className="cursor-pointer text-xs font-medium">
        {attention
          ? `${attention} 家待確認`
          : `查看 ${batch.stores.length} 家店`}
        {!!warnings && (
          <span className="ml-2 text-muted-foreground">{warnings} 項提醒</span>
        )}
      </summary>
      <ol aria-label="逐店開單進度" className="mt-2 divide-y">
        {batch.stores.map((store, index) => (
          <li key={store.customer_id} className="space-y-2 py-3 text-xs">
            <div className="flex items-start justify-between gap-2 font-medium">
              <span className="min-w-0">
                {index + 1}. {store.customer_name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {store === current
                  ? "處理中"
                  : {
                      pending: "等待",
                      completed: "草稿已建立",
                      needs_attention: "待確認",
                      skipped: "已跳過",
                    }[store.status]}
              </span>
            </div>
            {store.status === "needs_attention" && (
              <p className="leading-relaxed break-words text-muted-foreground">
                {store.message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {store.resource && (
                <Button asChild size="sm" variant="outline">
                  <Link to={store.resource.path}>檢查草稿</Link>
                </Button>
              )}
              {task.status !== "cancelled" &&
                ["needs_attention", "skipped"].includes(store.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void session.controlStore(
                        task.id,
                        "retry",
                        store.customer_id,
                        { conversation, source: "typed" }
                      )
                    }
                  >
                    重試
                  </Button>
                )}
              {task.status !== "cancelled" &&
                ["pending", "needs_attention"].includes(store.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={store === current}
                    onClick={() =>
                      void session.controlStore(
                        task.id,
                        "skip",
                        store.customer_id,
                        { conversation, source: "typed" }
                      )
                    }
                  >
                    跳過
                  </Button>
                )}
            </div>
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                明細
                {store.warnings.length
                  ? ` · ${store.warnings.length} 項提醒`
                  : ""}
              </summary>
              <div className="mt-2 space-y-1.5 leading-relaxed break-words text-muted-foreground">
                <p>
                  {store.source_order_no
                    ? `參考 ${store.source_order_no}（${store.source_date}）`
                    : "尚無歷史成交單"}
                </p>
                {store.status !== "needs_attention" && <p>{store.message}</p>}
                {!!store.warnings.length && (
                  <ul className="list-disc space-y-1 pl-4">
                    {store.warnings.map((warning, n) => (
                      <li key={n}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </li>
        ))}
      </ol>
      <p className="border-t pt-2 text-xs text-muted-foreground">
        {batch.rep_name} · {batch.route_date} · 草稿需檢查後送出
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {task.message}
      </p>
    </details>
  )
}

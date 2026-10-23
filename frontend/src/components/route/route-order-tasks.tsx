import { useSyncExternalStore } from "react"
import { askSessionFor } from "@/ask/ask-session"
import { AssistantTaskCard } from "@/components/ask/assistant-tasks"
import { Button } from "@/components/ui/button"

export function RouteOrderTasks({
  userId,
  canStart,
}: {
  userId: string
  canStart: boolean
}) {
  const asking = askSessionFor(userId)
  useSyncExternalStore(
    asking.threads.subscribe,
    asking.threads.getSnapshot,
    asking.threads.getSnapshot
  )
  const session = asking.tasks
  const state = useSyncExternalStore(
    session.queue.subscribe,
    session.queue.getSnapshot,
    session.queue.getSnapshot
  )
  const existing = state.tasks.find(
    (task) =>
      task.capability === "order.route_repeat" &&
      !["completed", "cancelled"].includes(task.status)
  )
  const latest =
    existing ??
    state.tasks.findLast((task) => task.capability === "order.route_repeat")
  return (
    <section
      aria-label="路線開單"
      className="mb-4 space-y-3 rounded-2xl border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">照上次開單</h2>
        {!existing && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canStart}
            onClick={() =>
              session.startRoute({
                conversation: asking.conversation,
                source: "typed",
              })
            }
          >
            建立草稿
          </Button>
        )}
      </div>
      {latest ? (
        <AssistantTaskCard
          task={latest}
          session={session}
          conversation={asking.conversation}
          embedded
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          依今日路線，沿用上次品項與數量。
        </p>
      )}
    </section>
  )
}

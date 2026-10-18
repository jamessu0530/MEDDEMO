import { useSyncExternalStore } from "react"
import type { syncAccountMemory } from "@/ask/memory-sync"

const idle = () => "saved" as const
const noopSubscribe = () => () => {}

export function AccountMemoryStatus({
  memory,
}: {
  memory?: ReturnType<typeof syncAccountMemory> | null
}) {
  const status = useSyncExternalStore(
    memory?.subscribe ?? noopSubscribe,
    memory?.getSnapshot ?? idle,
    memory?.getSnapshot ?? idle
  )
  if (!memory || status === "saved") return null
  return (
    <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
      {status === "loading"
        ? "正在讀取帳號記憶…"
        : status === "saving"
          ? "正在保存記憶…"
          : "帳號記憶尚未同步，請檢查連線。"}
      {status === "error" && (
        <button
          type="button"
          className="ml-2 underline"
          onClick={() => void memory.retry().catch(() => {})}
        >
          重試
        </button>
      )}
    </p>
  )
}

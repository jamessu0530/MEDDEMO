import { startTransition, useEffect, useRef, useState } from "react"
import { createBackgroundPool } from "@/lib/background-pool"
import { scheduleWork } from "@/lib/background-work"
import {
  pageWork,
  type PageWorkInput,
  type PageWorkResult,
} from "@/lib/page-work"

// All catalog, map and matrix consumers share this two-worker budget.
const pool = createBackgroundPool<PageWorkInput, PageWorkResult>(
  () =>
    new Worker(new URL("./page-work.worker.ts", import.meta.url), {
      type: "module",
      name: "page-compute",
    }),
  (input, cancelled) => scheduleWork(pageWork(input), cancelled)
)
export function usePageWork(input: PageWorkInput, enabled = true) {
  const [snapshot, setSnapshot] = useState<{
    input: PageWorkInput
    result?: PageWorkResult
    error?: string
  } | null>(null)
  const client = useRef<ReturnType<typeof pool.connect> | null>(null)
  useEffect(() => {
    if (!enabled) return
    const task = pool.connect(
      (result, source) =>
        startTransition(() => setSnapshot({ input: source, result })),
      (_error, source) =>
        setSnapshot({
          input: source,
          error: "資料整理暫時無法完成，請重新整理。",
        })
    )
    client.current = task
    return () => {
      task.dispose()
      client.current = null
    }
  }, [enabled])
  useEffect(() => {
    if (enabled) client.current?.update(input)
  }, [input, enabled])
  return {
    input: snapshot?.input,
    result: snapshot?.result,
    pending: enabled && snapshot?.input !== input,
    error: snapshot?.input === input ? snapshot.error : undefined,
  }
}

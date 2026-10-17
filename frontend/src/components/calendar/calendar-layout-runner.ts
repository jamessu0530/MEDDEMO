import {
  layoutCalendarAsync,
  type CalendarLayout,
  type CalendarLayoutInput,
} from "./calendar-layout"

export type CalendarLayoutRequest = { id: number; input: CalendarLayoutInput }
export type CalendarLayoutResponse = { id: number; layout: CalendarLayout }
export type CalendarLayoutWorker = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror"
>

/** Reuse one worker per calendar; coalesce navigation to the latest request. */
export function createCalendarLayoutRunner<Input extends CalendarLayoutInput>(
  onResult: (layout: CalendarLayout, input: Input) => void,
  onError: (error: unknown, input: Input) => void,
  createWorker: () => CalendarLayoutWorker = () =>
    new Worker(new URL("./calendar-layout.worker.ts", import.meta.url), {
      type: "module",
      name: "calendar-layout",
    })
) {
  let worker: CalendarLayoutWorker | null = null
  let unavailable = false
  let disposed = false
  let revision = 0
  type Job = { id: number; input: Input }
  let running: Job | null = null
  let queued: Job | null = null

  function releaseWorker() {
    if (!worker) return
    worker.onmessage = worker.onerror = worker.onmessageerror = null
    worker.terminate()
    worker = null
  }
  function fallback() {
    releaseWorker()
    unavailable = true
    const latest = queued ?? running
    queued = running = null
    if (latest) start(latest)
  }
  function complete(job: Job, layout: CalendarLayout | null, error?: unknown) {
    if (disposed || running?.id !== job.id) return
    running = null
    if (job.id === revision) {
      if (layout) onResult(layout, job.input)
      else if (error) onError(error, job.input)
    }
    const next = queued
    queued = null
    if (next) start(next)
  }
  function start(job: Job) {
    if (disposed) return
    running = job
    if (!worker && !unavailable) {
      try {
        worker = createWorker()
        worker.onmessage = ({ data }: MessageEvent<CalendarLayoutResponse>) => {
          if (running?.id === data.id) complete(running, data.layout)
        }
        worker.onerror = (event) => {
          event.preventDefault()
          fallback()
        }
        worker.onmessageerror = fallback
      } catch {
        unavailable = true
      }
    }
    if (worker) {
      try {
        // Copy only timing data; descriptions, invitees and notes stay on the page.
        worker.postMessage({
          id: job.id,
          input: {
            days: job.input.days,
            events: job.input.events.map(
              ({ id, starts_at, ends_at, timezone, all_day }) => ({
                id,
                starts_at,
                ends_at,
                timezone,
                all_day,
              })
            ),
          },
        } satisfies CalendarLayoutRequest)
      } catch {
        fallback()
      }
    } else {
      void layoutCalendarAsync(
        job.input,
        () => disposed || job.id !== revision
      ).then(
        (layout) => complete(job, layout),
        (error: unknown) => complete(job, null, error)
      )
    }
  }
  return {
    update(input: Input) {
      if (disposed) return
      const job = { id: ++revision, input }
      if (running) queued = job
      else start(job)
    },
    dispose() {
      disposed = true
      revision++
      queued = running = null
      releaseWorker()
    },
  }
}

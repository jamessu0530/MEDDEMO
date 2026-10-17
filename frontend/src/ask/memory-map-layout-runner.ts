import {
  layoutMemoryMapAsync,
  type MapLayoutInput,
  type MapPositions,
} from "./memory-map-layout"

export type MapLayoutRequest = { id: number; graph: MapLayoutInput }
export type MapLayoutResponse = { id: number; positions: MapPositions }
export type LayoutWorker = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror"
>

/** One worker per open map. Keep only the newest waiting job while one runs. */
export function createMemoryMapLayoutRunner(
  onResult: (positions: MapPositions) => void,
  createWorker: () => LayoutWorker = () =>
    new Worker(new URL("./memory-map-layout.worker.ts", import.meta.url), {
      type: "module",
      name: "memory-map-layout",
    })
) {
  let worker: LayoutWorker | null = null
  let unavailable = false
  let disposed = false
  let revision = 0
  let running: MapLayoutRequest | null = null
  let queued: MapLayoutRequest | null = null

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
    queued = null
    running = null
    if (latest) start(latest)
  }
  function complete(id: number, positions: MapPositions | null) {
    if (disposed || running?.id !== id) return
    running = null
    if (id === revision && positions) onResult(positions)
    const next = queued
    queued = null
    if (next) start(next)
  }
  function start(job: MapLayoutRequest) {
    if (disposed) return
    running = job
    if (!worker && !unavailable) {
      try {
        worker = createWorker()
        worker.onmessage = ({ data }: MessageEvent<MapLayoutResponse>) => {
          complete(data.id, data.positions)
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
        worker.postMessage(job)
      } catch {
        fallback()
      }
    } else {
      void layoutMemoryMapAsync(
        job.graph,
        () => disposed || job.id !== revision
      ).then((positions) => complete(job.id, positions))
    }
  }
  return {
    update(graph: MapLayoutInput) {
      if (disposed) return
      // Only topology is copied; answers, evidence text and notes stay out of worker messages.
      const job = {
        id: ++revision,
        graph: {
          nodes: graph.nodes.map(({ id, kind }) => ({ id, kind })),
          links: graph.links.map(({ source, target }) => ({ source, target })),
        },
      }
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

export type BackgroundWorker = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror"
>
export type PoolRequest<Input extends { source: unknown }> =
  | {
      type: "run"
      id: number
      owner: number
      params: Omit<Input, "source">
      source?: Input["source"]
    }
  | { type: "clear"; owner: number }
export type PoolResponse<Result> = { id: number } & (
  { result: Result } | { error: string }
)

/** Shared, bounded queue: at most one waiting job per consumer, with reusable datasets. */
export function createBackgroundPool<Input extends { source: unknown }, Result>(
  createWorker: () => BackgroundWorker,
  fallback: (input: Input, cancelled: () => boolean) => Promise<Result | null>,
  limit = 2
) {
  type Job = { id: number; owner: number; input: Input }
  type Client = {
    latest: Job | null
    onResult: (result: Result, input: Input) => void
    onError: (error: Error, input: Input) => void
  }
  type Slot = {
    worker: BackgroundWorker | null
    job: Job | null
    source: unknown
    owner: number | null
  }
  const clients = new Map<number, Client>()
  const waiting = new Map<number, Job>()
  const slots: Slot[] = []
  const capacity = Math.max(1, Math.min(2, Math.floor(limit) || 1))
  let nextOwner = 0,
    nextJob = 0,
    unavailable = false,
    pumping = false

  function release(slot: Slot) {
    if (slot.worker) {
      slot.worker.onmessage =
        slot.worker.onerror =
        slot.worker.onmessageerror =
          null
      slot.worker.terminate()
    }
    slot.worker = null
    slot.owner = null
    slot.source = undefined
  }
  function disableWorkers() {
    unavailable = true
    for (const slot of slots) {
      const job = slot.job
      if (
        job &&
        clients.get(job.owner)?.latest === job &&
        !waiting.has(job.owner)
      )
        waiting.set(job.owner, job)
      release(slot)
    }
    slots.length = 0
  }
  function complete(
    slot: Slot,
    job: Job,
    result: Result | null,
    error?: Error
  ) {
    if (!slots.includes(slot) || slot.job !== job) return
    slot.job = null
    const client = clients.get(job.owner)
    try {
      if (client?.latest === job) {
        if (error) client.onError(error, job.input)
        else if (result !== null) client.onResult(result, job.input)
      }
    } finally {
      pump()
    }
  }
  function makeSlot(): Slot {
    const slot: Slot = {
      worker: null,
      job: null,
      source: undefined,
      owner: null,
    }
    if (!unavailable) {
      try {
        slot.worker = createWorker()
        slot.worker.onmessage = ({
          data,
        }: MessageEvent<PoolResponse<Result>>) => {
          const job = slot.job
          if (!job || job.id !== data.id) return
          if ("error" in data) complete(slot, job, null, new Error(data.error))
          else complete(slot, job, data.result)
        }
        slot.worker.onerror = (event) => {
          event.preventDefault()
          disableWorkers()
          pump()
        }
        slot.worker.onmessageerror = () => {
          disableWorkers()
          pump()
        }
      } catch {
        disableWorkers()
      }
    }
    slots.push(slot)
    return slot
  }
  function start(slot: Slot, job: Job) {
    slot.job = job
    if (slot.worker) {
      const { source, ...params } = job.input
      const replace = slot.owner !== job.owner || slot.source !== source
      try {
        slot.worker.postMessage({
          type: "run",
          id: job.id,
          owner: job.owner,
          params,
          ...(replace ? { source } : {}),
        } satisfies PoolRequest<Input>)
        slot.owner = job.owner
        slot.source = source
      } catch {
        disableWorkers()
      }
    } else {
      void Promise.resolve()
        .then(() =>
          fallback(job.input, () => clients.get(job.owner)?.latest !== job)
        )
        .then(
          (result) => complete(slot, job, result),
          (error: unknown) =>
            complete(
              slot,
              job,
              null,
              error instanceof Error ? error : new Error(String(error))
            )
        )
    }
  }
  function pump() {
    if (pumping) return
    pumping = true
    try {
      while (waiting.size) {
        // A consumer already calculating keeps its newest request queued; leave
        // the other slot available to a different visible panel.
        const entry = [...waiting.entries()].find(
          ([owner]) =>
            !slots.some((candidate) => candidate.job?.owner === owner)
        )
        if (!entry) break
        const [owner, job] = entry
        const slot =
          slots.find(
            (candidate) =>
              !candidate.job &&
              candidate.owner === owner &&
              candidate.source === job.input.source
          ) ??
          slots.find((candidate) => !candidate.job) ??
          (slots.length < capacity ? makeSlot() : null)
        if (!slot) break
        waiting.delete(owner)
        if (clients.get(owner)?.latest === job) start(slot, job)
      }
    } finally {
      pumping = false
    }
  }
  return {
    connect(onResult: Client["onResult"], onError: Client["onError"]) {
      const owner = ++nextOwner
      const client: Client = { latest: null, onResult, onError }
      clients.set(owner, client)
      return {
        update(input: Input) {
          if (!clients.has(owner)) return
          const job = { id: ++nextJob, owner, input }
          client.latest = job
          waiting.set(owner, job)
          pump()
        },
        dispose() {
          clients.delete(owner)
          waiting.delete(owner)
          for (const slot of slots) {
            if (slot.owner !== owner) continue
            try {
              slot.worker?.postMessage({ type: "clear", owner })
            } catch {
              /* Cleared when released. */
            }
            slot.source = undefined
            slot.owner = null
          }
          if (!clients.size) {
            slots.forEach(release)
            slots.length = 0
            waiting.clear()
            unavailable = false
          }
        },
      }
    },
  }
}

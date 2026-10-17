import type { ReportConfig } from "@/lib/reports"

/** Serialize writes and drain edits made while a previous revision is saving. */
export function createReportSaveQueue<
  T extends { config: ReportConfig; revision: number },
>(
  initial: { config: ReportConfig; revision: number },
  persist: (config: ReportConfig, revision: number) => Promise<T>,
  onSaved: (stored: T, submitted: ReportConfig) => void
) {
  let latest = initial.config
  let revision = initial.revision
  let savedKey = JSON.stringify(initial.config)
  let pending: Promise<void> | null = null

  async function drain() {
    while (JSON.stringify(latest) !== savedKey) {
      const submitted = latest
      const stored = await persist(submitted, revision)
      revision = stored.revision
      savedKey = JSON.stringify(stored.config)
      if (latest === submitted) latest = stored.config
      onSaved(stored, submitted)
    }
  }

  return {
    update(config: ReportConfig) {
      latest = config
    },
    flush() {
      if (!pending)
        pending = drain().finally(() => {
          pending = null
        })
      return pending
    },
  }
}

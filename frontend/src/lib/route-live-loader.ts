type Reload = "full" | "locations"

type Actions<T, L> = {
  full: (signal: AbortSignal) => Promise<T>
  locations: (signal: AbortSignal) => Promise<L>
  onFull: (data: T) => void
  onLocations: (data: L) => void
  onError: (error: unknown) => void
}

/** 同一個行程畫面只跑一個請求；通知合併成下一次更新，避免慢的舊回應蓋過新的資料。 */
export class RouteLiveLoader<T, L> {
  private readonly controller = new AbortController()
  private running = false
  private pending: Reload | undefined
  private readonly actions: Actions<T, L>

  constructor(actions: Actions<T, L>) {
    this.actions = actions
  }

  reload(kind: Reload) {
    if (this.controller.signal.aborted) return
    this.pending =
      this.pending === "full" || kind === "full" ? "full" : "locations"
    if (!this.running) void this.run()
  }

  dispose() {
    this.pending = undefined
    this.controller.abort()
  }

  private async run() {
    this.running = true
    while (this.pending && !this.controller.signal.aborted) {
      const kind = this.pending
      this.pending = undefined
      try {
        if (kind === "full") {
          const data = await this.actions.full(this.controller.signal)
          if (!this.controller.signal.aborted) this.actions.onFull(data)
        } else {
          const data = await this.actions.locations(this.controller.signal)
          if (!this.controller.signal.aborted) this.actions.onLocations(data)
        }
      } catch (error) {
        // 位置失敗等下次通知；整份失敗由畫面保留舊資料或顯示錯誤。
        if (kind === "full" && !this.controller.signal.aborted)
          this.actions.onError(error)
      }
    }
    this.running = false
  }
}

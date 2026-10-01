// 紅點數字不像聊天，晚一分鐘看到沒關係；一分鐘問一次，一台手機一天最多 1,440 個很小的請求
const POLL_MS = 60_000
// 收到即時通知後等這麼久才問：很多人同時發言時，一陣通知併成一次，不會每則通知都問
const SOON_MS = 2_000

/** 有畫面在看的時候，每分鐘問一次某個數字（主管回覆、頻道未讀）。手機從背景切回來、恢復連線時先問一次 */
export class CountPoller {
  private count = 0
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly fetchCount: () => Promise<{ count: number }>
  // 正在問的那一次；問的時候又有人要問，記下來，問完再補問一次（只補一次）
  private inFlight: Promise<void> | null = null
  private again = false
  private soonTimer: ReturnType<typeof setTimeout> | null = null

  constructor(fetchCount: () => Promise<{ count: number }>) {
    this.fetchCount = fetchCount
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  getSnapshot = () => this.count

  /** 看過之後馬上重問一次，紅點不必等下一分鐘才消失。一次只問一個：正在問的時候又呼叫，
   * 等這次問完再補問一次，同時呼叫幾次都只補一次。回傳的 Promise 連補問的那次一起等 */
  refresh = (): Promise<void> => {
    if (this.inFlight) {
      this.again = true
      return this.inFlight
    }
    const run = async () => {
      try {
        do {
          this.again = false
          await this.fetchOnce()
        } while (this.again)
      } finally {
        // 跟上面最後一次檢查 again 在同一步清掉：中間插進來的呼叫不會被漏掉
        this.inFlight = null
      }
    }
    this.inFlight = run()
    return this.inFlight
  }

  /** 收到即時通知時呼叫：等 2 秒再問，這 2 秒內的通知併成一次。
   * 不會因為通知一直進來就一直往後延，最晚 2 秒一定問一次 */
  refreshSoon = () => {
    if (this.soonTimer) return
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null
      void this.refresh()
    }, SOON_MS)
  }

  private async fetchOnce() {
    if (document.visibilityState === "hidden" || !navigator.onLine) return
    try {
      const { count } = await this.fetchCount()
      if (count === this.count) return
      this.count = count
      this.listeners.forEach((listener) => listener())
    } catch {
      // 連不上就等下一輪
    }
  }

  private readonly onWake = () => void this.refresh()

  private start() {
    void this.refresh()
    this.timer = setInterval(this.onWake, POLL_MS)
    document.addEventListener("visibilitychange", this.onWake)
    window.addEventListener("online", this.onWake)
  }

  private stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    document.removeEventListener("visibilitychange", this.onWake)
    window.removeEventListener("online", this.onWake)
  }
}

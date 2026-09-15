import { useSyncExternalStore } from "react"

import { getUnseenCount } from "@/api/escalations"

// 主管回覆不像聊天，晚一分鐘看到沒關係；一分鐘問一次，一台手機一天最多 1,440 個很小的請求
const POLL_MS = 60_000

/** 業務還沒看過的主管回覆有幾則（FR-8.4「有回覆會通知你」）。有畫面在看的時候，每分鐘問一次 */
class ManagerReplies {
  private count = 0
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  getSnapshot = () => this.count

  /** 看過回覆之後馬上重問一次，首頁的提醒不必等下一分鐘才消失 */
  refresh = async () => {
    if (document.visibilityState === "hidden" || !navigator.onLine) return
    try {
      const { count } = await getUnseenCount()
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
    // 手機從背景切回來、或恢復連線時先問一次
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

export const managerReplies = new ManagerReplies()

export function useUnseenReplies() {
  return useSyncExternalStore(managerReplies.subscribe, managerReplies.getSnapshot)
}

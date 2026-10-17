import { useSyncExternalStore } from "react"

// 電腦版的收合狀態留在這個瀏覽器；換頁、重新整理後都沿用。
const STORAGE_KEY = "meddemo:sidebar-collapsed"
const listeners = new Set<() => void>()

function read() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

let collapsed = read()

function apply() {
  if (typeof document === "undefined") return
  document.documentElement.dataset.sidebarCollapsed = String(collapsed)
}

// 固定元件與換頁動畫也使用同一個寬度，包含掛在 AppShell 外面的元件。
apply()

export function setSidebarCollapsed(next: boolean) {
  if (next === collapsed) return
  collapsed = next
  apply()
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
  } catch {
    // 網站資料被擋住時，這次打開仍能收合、展開。
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, () => collapsed, () => false)
}

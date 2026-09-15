import { useSyncExternalStore } from "react"

// FR-11：第一次打開 App 時說明三個主要操作；看過就記在手機裡，之後從首頁的「使用說明」再打開
const STORAGE_KEY = "meddemo:onboarded"
const listeners = new Set<() => void>()
let open = !hasSeen()

function hasSeen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false // 無痕模式這類讀不到手機儲存空間的情況：照樣顯示，不影響使用
  }
}

function emit() {
  listeners.forEach((listener) => listener())
}

export function openGuide() {
  open = true
  emit()
}

export function closeGuide() {
  open = false
  try {
    localStorage.setItem(STORAGE_KEY, "1")
  } catch {
    // 存不進去，下次打開會再顯示一次
  }
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useGuideOpen() {
  return useSyncExternalStore(subscribe, () => open)
}

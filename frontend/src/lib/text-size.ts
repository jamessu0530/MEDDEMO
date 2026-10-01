import { useSyncExternalStore } from "react"

// 字體大小（docs/superpowers/specs/2026-10-01-avatars-text-size-design.md）：記在這支手機裡，跟配色一樣、跟帳號無關。
// 掛在 <html data-text-size>，index.css 依它放大根字級；Tailwind 的字級、間距都是 rem，整頁一起等比例放大
export type TextSize = "standard" | "large" | "xlarge"

const STORAGE_KEY = "meddemo:text-size"
const SIZES: TextSize[] = ["standard", "large", "xlarge"]
const listeners = new Set<() => void>()

function read(): TextSize {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return SIZES.includes(stored as TextSize) ? (stored as TextSize) : "standard"
  } catch {
    return "standard" // 讀不到（無痕模式）就用標準
  }
}

let current = read()

/** 標準是預設，不掛 */
function apply() {
  if (typeof document === "undefined") return
  if (current === "standard") delete document.documentElement.dataset.textSize
  else document.documentElement.dataset.textSize = current
}

// 一載入就掛。index.html 裡另有一小段更早就掛，免得先閃一下標準大小
apply()

export function readTextSize() {
  return current
}

export function setTextSize(size: TextSize) {
  if (size === current) return
  current = size
  apply()
  try {
    localStorage.setItem(STORAGE_KEY, size)
  } catch {
    // 存不進去：這次打開照樣換，下次打開回到標準
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTextSize() {
  return useSyncExternalStore(subscribe, () => current)
}

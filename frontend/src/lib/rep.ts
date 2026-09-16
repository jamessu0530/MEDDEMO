import { useSyncExternalStore } from "react"

import type { Rep } from "@/api/route"

// 這次專案不做登入：第一次打開時業務自己選是誰，選完記在這支手機裡，之後每次要路線都帶這個身分
const STORAGE_KEY = "meddemo:rep"
const listeners = new Set<() => void>()

function read(): Rep | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Rep) : null
  } catch {
    return null // 讀不到（無痕模式、存的格式壞了）就當作還沒選，今日路線會再問一次
  }
}

let current = read()

function emit() {
  listeners.forEach((listener) => listener())
}

/** 選好身分（或在今日路線的標頭換人） */
export function setRep(rep: Rep) {
  current = rep
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rep))
  } catch {
    // 存不進去，下次打開會再問一次，這次還是照選的身分排
  }
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 畫面外（例如回寫完成頁）要用的身分 */
export function readRep() {
  return current
}

export function useRep() {
  return useSyncExternalStore(subscribe, () => current)
}

import { useSyncExternalStore } from "react"

import { getMyPresence, setMyPresence, type MyPresence, type PresenceStatus } from "@/api/presence"

// 成員清單的分組與頭像群組的順序：有空的在最前面，離線的在最後
export const STATUS_ORDER: PresenceStatus[] = ["available", "busy", "dnd", "brb", "away", "offline"]

export const STATUS_LABEL: Record<PresenceStatus, string> = {
  available: "有空",
  busy: "忙碌",
  dnd: "請勿打擾",
  brb: "馬上回來",
  away: "離開",
  offline: "離線",
}

// 自己選的時候，離開與離線是「顯示為」：人其實還在用，只是別人看到的是這樣（跟 Teams 一樣的說法）
export const CHOICE_LABEL: Record<PresenceStatus, string> = {
  ...STATUS_LABEL,
  away: "顯示為離開",
  offline: "顯示為離線",
}

const CJK = /[㐀-鿿豈-﫿]/

/** 頭像上的縮寫：中文取最後兩個字（林昱辰 → 昱辰），英文取前兩個字母（James → JA，James Su → JS） */
export function initials(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  const han = Array.from(trimmed).filter((char) => CJK.test(char))
  if (han.length) return han.slice(-2).join("")
  const words = trimmed.split(/\s+/)
  if (words.length >= 2) return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase()
  return Array.from(trimmed).slice(0, 2).join("").toUpperCase()
}

/** 頭像底色：依帳號固定挑一個，同一個人在哪裡都是同一個顏色 */
export function avatarTone(id: string, tones: number) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003
  return hash % tones
}

/**
 * 大家的狀態，由 WebSocket 推來（lib/realtime.ts）。只存不是離線的人，不在裡面的就是離線。
 * 每次更新換一個新的 Map，useSyncExternalStore 才看得出變了
 */
export class PresenceStore {
  private statuses: ReadonlyMap<string, PresenceStatus> = new Map()
  // 收過完整的一份沒：還沒收到之前，畫面先用 API 回的狀態（例如成員清單），不要把每個人都當成離線
  private loaded = false
  private readonly listeners = new Set<() => void>()

  /** full 是完整的一份（剛連上、HTTP 心跳回來的），取代原本的；不然只是有變的那幾個人 */
  apply(full: boolean, changes: Record<string, PresenceStatus>) {
    const next = new Map(full ? [] : this.statuses)
    for (const [id, status] of Object.entries(changes)) {
      if (status === "offline") next.delete(id)
      else next.set(id, status)
    }
    if (full) this.loaded = true
    this.set(next)
  }

  /** 登出、換人時清空，回到還沒收過的狀態 */
  clear() {
    this.loaded = false
    this.set(new Map())
  }

  isLoaded = () => this.loaded

  statusOf = (id: string): PresenceStatus => this.statuses.get(id) ?? "offline"

  /** 收過完整的一份就用即時的，不然用 API 一起回的 */
  statusOr = (id: string, fallback: PresenceStatus): PresenceStatus => (this.loaded ? this.statusOf(id) : fallback)

  private set(next: ReadonlyMap<string, PresenceStatus>) {
    this.statuses = next
    this.listeners.forEach((listener) => listener())
  }

  getSnapshot = () => this.statuses

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const presence = new PresenceStore()

/** 某個人現在的狀態 */
export function usePresence(id: string) {
  const read = () => presence.statusOf(id)
  // 第三個參數給伺服器端 render（元件測試）用，同一份
  return useSyncExternalStore(presence.subscribe, read, read)
}

/** 整份狀態：成員清單、頭像群組要一起排序時用 */
export function usePresenceMap() {
  return useSyncExternalStore(presence.subscribe, presence.getSnapshot, presence.getSnapshot)
}

// 自己選的狀態。登入後問一次，之後只有自己改
let mine: MyPresence | null = null
const mineListeners = new Set<() => void>()

function setMine(next: MyPresence | null) {
  mine = next
  mineListeners.forEach((listener) => listener())
}

function subscribeMine(listener: () => void) {
  mineListeners.add(listener)
  return () => {
    mineListeners.delete(listener)
  }
}

export function useMyPresence() {
  return useSyncExternalStore(subscribeMine, () => mine)
}

export async function loadMyPresence() {
  try {
    setMine(await getMyPresence())
  } catch {
    // 連不上就先顯示自動，選單打開時會再問一次
  }
}

/** 手動選狀態；null 是重設回自動。失敗就丟出去，選單顯示錯誤 */
export async function chooseStatus(choice: PresenceStatus | null) {
  setMine(await setMyPresence(choice))
}

export function clearMyPresence() {
  setMine(null)
}

/** 自己頭像上的狀態點：選了就是選的那個（顯示為離線也照實顯示），沒選就是別人看到的 */
export function ownStatus(choice: PresenceStatus | null | undefined, live: PresenceStatus): PresenceStatus {
  return choice ?? live
}

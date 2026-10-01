import { useSyncExternalStore } from "react"

import { getShareState, type ShareHours, type ShareState } from "@/api/location"
import type { HeartbeatLocation } from "@/api/presence"
import { onAuthChange, readUser } from "@/lib/auth"

/*
 * 即時位置（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈即時位置〉〈位置分享〉）：
 * 業務上班時間打開 App，在線狀態的心跳（lib/realtime.ts，每 20 秒）多帶最新的位置。只有業務、上班時間（台北時間）、
 * 沒暫停、同意過、瀏覽器給了權限才追蹤與帶；拒絕定位時改帶 location_denied。後端（services/locations.py）會再檢查一次。
 * 評審（第三方登入、代理示範業務）分享的是自己手機真的位置。
 */

// 同意過了沒，記在這支手機、分帳號
const CONSENT_KEY = "meddemo:location-consent"
// 多久重問一次後端的分享狀態：好幾位評審代理同一位示範業務時，別人按了暫停，這裡最慢 5 分鐘後跟上
const RELOAD_MS = 5 * 60_000

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
const TAIPEI_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

function minutesOf(clock: string) {
  const [hours, minutes] = clock.split(":").map(Number)
  return hours * 60 + minutes
}

/** 這個時刻在不在上班時間，看台北時間（後端 services/locations.within 同一個規則） */
export function withinHours(at: Date, hours: ShareHours) {
  const parts = Object.fromEntries(TAIPEI_CLOCK.formatToParts(at).map((part) => [part.type, part.value]))
  const minute = Number(parts.hour) * 60 + Number(parts.minute)
  return hours.weekdays.includes(WEEKDAY[parts.weekday]) && minutesOf(hours.start) <= minute && minute < minutesOf(hours.end)
}

export type Position = { lat: number; lng: number; accuracy: number | null }

export type ShareSnapshot = {
  // 後端說的分享狀態；還沒問到是 null
  share: ShareState | null
  consented: boolean
  // 這支手機的瀏覽器拒絕定位
  denied: boolean
  position: Position | null
}

// hidden：不顯示（不是業務、下班時間、還沒問到）；consent：第一次要先說明；其他三種是分享列的三種樣子
export type BarState = "hidden" | "consent" | "sharing" | "paused" | "denied"

// 第一次在上班時間打開首頁時的說明（設計文件〈位置分享〉）；放在這裡而不是 share-bar.tsx，
// 是因為那個檔案只匯出元件給 react-refresh 用，混進一個字串常數 lint 會過不了
export const CONSENT_TEXT = "上班時間主管看得到你的位置，只存最新的一筆，不留軌跡；可以隨時暫停。"

export function barState(snapshot: ShareSnapshot, now: Date): BarState {
  const { share } = snapshot
  if (!share || !share.applies || !withinHours(now, share.hours)) return "hidden"
  if (!snapshot.consented) return "consent"
  if (share.paused) return "paused"
  if (snapshot.denied) return "denied"
  return "sharing"
}

/** 心跳要多帶的：分享中帶最新的位置，沒有權限帶 location_denied，其他什麼都不帶 */
export function heartbeatPayload(snapshot: ShareSnapshot, now: Date): HeartbeatLocation {
  const state = barState(snapshot, now)
  if (state === "denied") return { location_denied: true }
  if (state === "sharing" && snapshot.position) return { location: snapshot.position }
  return {}
}

/** 分享列的句子（設計文件〈位置分享〉的表） */
export function barText(state: BarState, managerName: string | null, hours: ShareHours) {
  const manager = managerName ?? "主管"
  if (state === "sharing") return `位置分享中，${manager}看得到你在哪（到 ${hours.end}）`
  if (state === "paused") return `已暫停分享，${manager}會看到「暫停分享」`
  if (state === "denied") return `沒有開定位權限，${manager}看不到你在哪`
  return null
}

/** 追蹤位置用到的瀏覽器功能，測試換成假的 */
export type GeoEnv = {
  now(): Date
  readConsent(): boolean
  writeConsent(): void
  fetchState(): Promise<ShareState>
  /** 瀏覽器的定位權限；查不到（沒有 Permissions API）當作 prompt */
  permission(): Promise<PermissionState>
  /** 開始追蹤，回傳停止的函式；使用者拒絕時呼叫 onDenied */
  watch(onPosition: (position: Position) => void, onDenied: () => void): () => void
}

const EMPTY: ShareSnapshot = { share: null, consented: false, denied: false, position: null }

export class LocationShare {
  private snapshot: ShareSnapshot = EMPTY
  private stopWatch: (() => void) | null = null
  private loading: Promise<void> | null = null
  private loadedAt = 0
  private readonly listeners = new Set<() => void>()
  private readonly env: GeoEnv

  constructor(env: GeoEnv) {
    this.env = env
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 問後端這個帳號要不要分享、暫停了沒；同時只問一次。問不到就等下一次心跳再問 */
  load(): Promise<void> {
    this.loading ??= this.env
      .fetchState()
      .then((share) => {
        this.loadedAt = this.env.now().getTime()
        this.set({ share, consented: this.env.readConsent() })
        return this.sync()
      })
      .catch(() => {})
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }

  /** 第一次的說明按了「知道了」：這時才向瀏覽器要權限、開始追蹤 */
  consent() {
    this.env.writeConsent()
    this.set({ consented: true })
    void this.sync()
  }

  /** 暫停、繼續之後換成後端回的狀態 */
  setShare(share: ShareState) {
    this.set({ share })
    void this.sync()
  }

  /** 登出、換人：停止追蹤，全部清掉 */
  reset() {
    this.stopWatching()
    this.loadedAt = 0
    this.snapshot = EMPTY
    this.emit()
  }

  /** 心跳要多帶的（lib/realtime.ts 每次送心跳時呼叫）。順便確認問過後端、追蹤該開還是該關 */
  heartbeat(): HeartbeatLocation {
    if (!this.snapshot.share || this.env.now().getTime() - this.loadedAt > RELOAD_MS) void this.load()
    else void this.sync()
    return heartbeatPayload(this.snapshot, this.env.now())
  }

  /** 分享中（或沒有權限、等使用者去開）才追蹤；下班、暫停、還沒同意就停掉，不在背景一直拿 GPS */
  private async sync() {
    const state = barState(this.snapshot, this.env.now())
    if (state !== "sharing" && state !== "denied") {
      this.stopWatching()
      return
    }
    if (this.stopWatch) return
    // 已經被拒絕就不再呼叫 watch：有的瀏覽器（沒有 Permissions API 的）每呼叫一次就跳一次詢問，每 20 秒跳一次會很煩。
    // 使用者去設定打開之後，查得到 granted，下一次心跳這裡就會開始追蹤
    const permission = await this.env.permission()
    if (permission === "denied" || (this.snapshot.denied && permission !== "granted")) {
      this.set({ denied: true })
      return
    }
    // 等權限的時候，另一次 sync 可能已經開了
    if (this.stopWatch) return
    this.stopWatch = this.env.watch(
      (position) => this.set({ position, denied: false }),
      () => {
        this.stopWatching()
        this.set({ denied: true })
      }
    )
  }

  private stopWatching() {
    this.stopWatch?.()
    this.stopWatch = null
  }

  private set(patch: Partial<ShareSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }
}

function consentKey() {
  return `${CONSENT_KEY}:${readUser()?.id ?? ""}`
}

const browserEnv: GeoEnv = {
  now: () => new Date(),
  readConsent: () => {
    try {
      return localStorage.getItem(consentKey()) === "1"
    } catch {
      return false
    }
  },
  writeConsent: () => {
    try {
      localStorage.setItem(consentKey(), "1")
    } catch {
      // 存不進去：下次打開會再問一次，不影響這次分享
    }
  },
  fetchState: () => getShareState(),
  permission: async () => {
    try {
      return (await navigator.permissions.query({ name: "geolocation" })).state
    } catch {
      return "prompt"
    }
  },
  watch: (onPosition, onDenied) => {
    if (!("geolocation" in navigator)) {
      onDenied()
      return () => {}
    }
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => onPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy ?? null }),
      (error) => {
        // 拿不到位置（室內、逾時）不算拒絕，等下一筆
        if (error.code === error.PERMISSION_DENIED) onDenied()
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  },
}

export const locationShare = new LocationShare(browserEnv)

// 登出、換人就停止追蹤；只是改了名字（同一個人）不必
let signedInAs = readUser()?.id ?? null
onAuthChange(() => {
  const next = readUser()?.id ?? null
  if (next === signedInAs) return
  signedInAs = next
  locationShare.reset()
})

export function useLocationShare() {
  // 第三個參數給伺服器端 render（元件測試）用，同一份
  return useSyncExternalStore(locationShare.subscribe, locationShare.getSnapshot, locationShare.getSnapshot)
}

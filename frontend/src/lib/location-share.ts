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
// GPS 定位多久算「還新鮮」：手機鎖屏、切到背景時瀏覽器會停止拿新位置，但 WebSocket 心跳還是每 20 秒照送。
// 超過這個時間的舊位置不能再當作「現在在哪」送出去，不然主管會一直看到一個其實已經停住不動的位置當作剛更新的
export const MAX_FIX_AGE_MS = 2 * 60_000

// 站著不動時有的瀏覽器不會再回報位置，超過一分鐘就主動要一次，免得主管看到灰掉
export const REFRESH_AFTER_MS = 60_000

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

// at：拿到這個定位的時間（ms, epoch），來自 GeolocationPosition.timestamp；心跳要不要帶看這個夠不夠新
export type Position = { lat: number; lng: number; accuracy: number | null; at: number }

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

/**
 * 心跳要多帶的：分享中帶最新的位置，沒有權限帶 location_denied，其他什麼都不帶。
 * 位置太舊（超過 MAX_FIX_AGE_MS，通常是手機鎖屏、切到背景）就當作沒有，不然後端會一直把舊位置當剛更新的寫進去。
 * 帶出去的只有 lat/lng/accuracy：at 只是這支手機自己拿來判斷新不新鮮，後端的 schema 沒有這個欄位。
 */
export function heartbeatPayload(snapshot: ShareSnapshot, now: Date): HeartbeatLocation {
  const state = barState(snapshot, now)
  if (state === "denied") return { location_denied: true }
  if (state === "sharing" && snapshot.position && now.getTime() - snapshot.position.at <= MAX_FIX_AGE_MS) {
    const { lat, lng, accuracy } = snapshot.position
    return { location: { lat, lng, accuracy } }
  }
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
  /** 要一次性的最新位置（watchPosition 在有的瀏覽器站著不動就不會再回報）；使用者拒絕時呼叫 onDenied */
  refresh(onPosition: (position: Position) => void, onDenied: () => void): void
}

const EMPTY: ShareSnapshot = { share: null, consented: false, denied: false, position: null }

export class LocationShare {
  private snapshot: ShareSnapshot = EMPTY
  private stopWatch: (() => void) | null = null
  private loading: Promise<void> | null = null
  private loadedAt = 0
  // reset() 換一代：還沒回來的 load() 結果回來時，如果已經是上一代的就作廢，不要蓋掉清空的狀態
  private generation = 0
  // 被拒絕當下查到的權限；跟現在查到的一樣（通常是查不到 Permissions API 時一直是 "prompt"，
  // 或是權限明明是 granted 但系統層級擋掉）就不要再開一次 watch，免得一直跳詢問或白白重試
  private deniedWith: PermissionState | null = null
  // 已經發出一次 env.refresh() 還沒回來：避免站著不動時每次心跳都再要一次
  private refreshing = false
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
    if (this.loading) return this.loading
    const generation = this.generation
    this.loading = this.env
      .fetchState()
      .then((share) => {
        // 問的時候換人了（reset）：這筆結果是上一代的，不要蓋掉已經清空的狀態
        if (generation !== this.generation) return
        this.loadedAt = this.env.now().getTime()
        this.set({ share, consented: this.env.readConsent() })
        return this.sync()
      })
      .catch(() => {})
      .finally(() => {
        if (generation === this.generation) this.loading = null
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

  /** 登出、換人：停止追蹤，全部清掉；還沒回來的 load() 結果回來時會被當成上一代作廢掉 */
  reset() {
    this.generation += 1
    this.stopWatching()
    this.loading = null
    this.loadedAt = 0
    this.deniedWith = null
    this.snapshot = EMPTY
    this.emit()
  }

  /** 心跳要多帶的（lib/realtime.ts 每次送心跳時呼叫）。順便確認問過後端、追蹤該開還是該關 */
  heartbeat(): HeartbeatLocation {
    if (!this.snapshot.share || this.env.now().getTime() - this.loadedAt > RELOAD_MS) void this.load()
    else void this.sync()
    this.maybeRefresh()
    return heartbeatPayload(this.snapshot, this.env.now())
  }

  /** 分享中、watch 開著，但位置太舊（有的瀏覽器站著不動就不會再回報）就主動要一次；已經在等就不要重複要 */
  private maybeRefresh() {
    if (this.refreshing || !this.stopWatch) return
    if (barState(this.snapshot, this.env.now()) !== "sharing") return
    const { position } = this.snapshot
    if (position && this.env.now().getTime() - position.at <= REFRESH_AFTER_MS) return
    this.refreshing = true
    this.env.refresh(
      (position) => {
        this.refreshing = false
        this.deniedWith = null
        this.set({ position, denied: false })
      },
      () => {
        this.refreshing = false
        this.stopWatching()
        this.set({ denied: true })
      }
    )
  }

  /** 分享中（或沒有權限、等使用者去開）才追蹤；下班、暫停、還沒同意就停掉，不在背景一直拿 GPS */
  private async sync() {
    const state = barState(this.snapshot, this.env.now())
    if (state !== "sharing" && state !== "denied") {
      this.stopWatching()
      return
    }
    if (this.stopWatch) return
    // 已經被拒絕就不再呼叫 watch：有的瀏覽器（沒有 Permissions API 的）每呼叫一次就跳一次詢問，每 20 秒跳一次會很煩；
    // 權限明明是 granted 但系統層級擋掉定位的話，也不要每次心跳都重開一次。記住拒絕當下查到的權限（deniedWith），
    // 跟現在查到的不一樣才重試——使用者去設定打開之後，查得到的權限變了，下一次心跳這裡就會開始追蹤
    const permission = await this.env.permission()
    // 等權限回來的這段時間狀態可能變了（暫停、下班、換人）：不要在不該追蹤的時候還開始 watch
    if (barState(this.snapshot, this.env.now()) !== state) return
    if (permission === "denied") {
      this.deniedWith = permission
      if (!this.snapshot.denied) this.set({ denied: true })
      return
    }
    if (this.snapshot.denied && permission === this.deniedWith) return
    // 等權限的時候，另一次 sync 可能已經開了
    if (this.stopWatch) return
    this.stopWatch = this.env.watch(
      (position) => {
        this.deniedWith = null
        this.set({ position, denied: false })
      },
      () => {
        this.stopWatching()
        this.deniedWith = permission
        this.set({ denied: true })
      }
    )
  }

  private stopWatching() {
    this.stopWatch?.()
    this.stopWatch = null
    this.refreshing = false
    // 停止追蹤（暫停、下班、拒絕）就把位置清掉：繼續分享之後要等拿到新的一筆才再送，不留著舊的當作現在在哪
    if (this.snapshot.position) this.set({ position: null })
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
      ({ coords, timestamp }) =>
        onPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy ?? null, at: timestamp ?? Date.now() }),
      (error) => {
        // 拿不到位置（室內、逾時）不算拒絕，等下一筆
        if (error.code === error.PERMISSION_DENIED) onDenied()
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  },
  refresh: (onPosition, onDenied) => {
    if (!("geolocation" in navigator)) return
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) =>
        onPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy ?? null, at: timestamp ?? Date.now() }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) onDenied()
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    )
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

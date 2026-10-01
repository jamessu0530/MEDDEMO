import { useSyncExternalStore } from "react"

import { pingPresence, type HeartbeatLocation, type PresenceStatus } from "@/api/presence"
import { readToken } from "@/lib/auth"
import { locationShare } from "@/lib/location-share"
import { presence, type PresenceStore } from "@/lib/presence"

/*
 * 一條 WebSocket（/api/ws）同時收兩件事：有人的狀態變了、看得到的頻道有新訊息
 * （docs/superpowers/specs/2026-10-01-presence-design.md）。
 * 業務的心跳順便帶位置（lib/location-share.ts）；主管與 IT 另外會收到看得到的業務位置變了、行程變了的通知。
 * 新訊息只是通知，內容照舊用 API 拿（pages/channel.tsx）；斷線漏掉的通知，重連時發一個 resync 讓畫面自己補。
 * 連不上的期間改用 HTTP 心跳，別人才不會以為你離線了。
 */

// 心跳間隔。Cloudflare 閒置 100 秒會斷線；後端 45 秒內沒有「正在用」的心跳就算離開
export const PING_MS = 20_000
// 5 分鐘沒碰螢幕就算閒置，跟 Teams 一樣
export const IDLE_MS = 5 * 60_000
// 斷線後隔多久重連，超過就一直用最後一個
export const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
// 後端的關閉碼（api/presence.py）
const CLOSE_UNAUTHORIZED = 4401
const CLOSE_TOO_MANY = 4429

// avatars：有人換了或移除大頭貼（lib/avatars.ts 重拿一次網址）；location、itinerary：這位業務的位置或今天的行程變了（主管頁）
export type RealtimeEvent =
  | { type: "message"; channel_id: number }
  | { type: "resync" }
  | { type: "avatars" }
  | { type: "location"; user_id: string }
  | { type: "itinerary"; user_id: string }

type ServerEvent =
  | { type: "ready"; user_id: string }
  | {
      type: "presence"
      full: boolean
      statuses: Record<string, PresenceStatus>
    }
  | { type: "message"; channel_id: number }
  | { type: "avatars" }
  | { type: "location"; user_id: string }
  | { type: "itinerary"; user_id: string }

export type SocketLike = {
  send(data: string): void
  close(code?: number): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number }) => void) | null
}

/** 連線用到的瀏覽器功能，測試換成假的 */
export type RealtimeEnv = {
  url(): string
  token(): string | null
  createSocket(url: string): SocketLike
  visible(): boolean
  online(): boolean
  ping(active: boolean, extra: HeartbeatLocation): Promise<{ statuses: Record<string, PresenceStatus> }>
  /** 畫面切到前景或背景、恢復網路、碰螢幕時呼叫 callback；回傳取消監聽的函式 */
  listen(kind: "visibility" | "online" | "activity", callback: () => void): () => void
  /** 心跳要多帶的（業務的位置），沒有就是空的 */
  heartbeat(): HeartbeatLocation
}

export class RealtimeClient {
  private running = false
  private socket: SocketLike | null = null
  // 這條連線用的是哪一張 token：4401 時看 token 換了沒（改過密碼）
  private socketToken: string | null = null
  private connected = false
  private retries = 0
  private lastInteraction = 0
  private lastSentActive: boolean | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private fallbackTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private unlisten: Array<() => void> = []
  private readonly listeners = new Set<(event: RealtimeEvent) => void>()
  private readonly connectedListeners = new Set<() => void>()
  private readonly env: RealtimeEnv
  private readonly store: PresenceStore

  constructor(env: RealtimeEnv, store: PresenceStore = presence) {
    this.env = env
    this.store = store
  }

  /** 登入後呼叫；已經在跑就不動 */
  start() {
    if (this.running) return
    this.running = true
    this.lastInteraction = Date.now()
    this.unlisten = [
      this.env.listen("visibility", this.onVisibility),
      this.env.listen("online", this.wake),
      this.env.listen("activity", this.onActivity),
    ]
    this.connect()
  }

  /** 登出、換人時呼叫：關掉連線，別人的狀態也清掉 */
  stop() {
    if (!this.running) return
    this.running = false
    this.unlisten.forEach((off) => off())
    this.unlisten = []
    this.clearTimers()
    const socket = this.socket
    this.socket = null
    socket?.close(1000)
    this.setConnected(false)
    this.store.clear()
  }

  isConnected = () => this.connected

  subscribe = (listener: (event: RealtimeEvent) => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeConnected = (listener: () => void) => {
    this.connectedListeners.add(listener)
    return () => {
      this.connectedListeners.delete(listener)
    }
  }

  /** 畫面在前景，而且 5 分鐘內碰過螢幕 */
  private active() {
    return this.env.visible() && Date.now() - this.lastInteraction < IDLE_MS
  }

  private connect() {
    const token = this.env.token()
    if (!this.running || this.socket || !token) return
    const socket = this.env.createSocket(this.env.url())
    this.socket = socket
    this.socketToken = token
    socket.onopen = () => {
      // token 不放網址：網址會進 Nginx 與 Cloudflare 的紀錄。auth 也算一次心跳，記下送了什麼 active
      const active = this.active()
      socket.send(JSON.stringify({ type: "auth", token, active }))
      this.lastSentActive = active
    }
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== "string") return
      this.receive(JSON.parse(event.data) as ServerEvent)
    }
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.closed(event.code)
    }
  }

  private receive(event: ServerEvent) {
    if (event.type === "ready") {
      this.retries = 0
      this.stopFallback()
      this.pingTimer = setInterval(this.sendPing, PING_MS)
      this.setConnected(true)
      this.emit({ type: "resync" })
    } else if (event.type === "presence") {
      this.store.apply(event.full, event.statuses)
    } else if (event.type === "message" || event.type === "avatars" || event.type === "location" || event.type === "itinerary") {
      this.emit(event)
    }
  }

  private closed(code: number) {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    this.setConnected(false)
    if (!this.running) return
    this.startFallback()
    if (code === CLOSE_UNAUTHORIZED) {
      // 改過密碼：token 換新的了，用新的馬上重連。沒換就是登入失效，
      // 不重連，等 HTTP 心跳收到 401 時由 api/client.ts 導回登入頁
      if (this.env.token() !== this.socketToken) this.connect()
      return
    }
    const delay = code === CLOSE_TOO_MANY ? RETRY_MS.at(-1)! : RETRY_MS[Math.min(this.retries, RETRY_MS.length - 1)]
    this.retries += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      // 畫面在背景就先不重連，省電；切回前景時 wake 會馬上連
      if (this.env.visible()) this.connect()
    }, delay)
  }

  private readonly sendPing = () => {
    if (!this.socket || !this.connected) return
    const active = this.active()
    this.socket.send(JSON.stringify({ type: "ping", active, ...this.heartbeatExtra() }))
    this.lastSentActive = active
  }

  // 位置的程式出錯也不能讓在線狀態的心跳停掉：壞掉就當作沒有位置可帶，照常送 active
  private heartbeatExtra(): HeartbeatLocation {
    try {
      return this.env.heartbeat()
    } catch {
      return {}
    }
  }

  private readonly onActivity = () => {
    this.lastInteraction = Date.now()
    // 閒置之後回來：馬上讓別人看到有空，不等下一次心跳
    if (this.connected && this.lastSentActive === false) this.sendPing()
  }

  private readonly onVisibility = () => {
    if (this.env.visible()) this.lastInteraction = Date.now()
    if (this.connected) this.sendPing()
    else this.wake()
  }

  /** 切回前景、恢復網路：斷線中的話不等重連的時間，馬上連 */
  private readonly wake = () => {
    if (!this.running || this.socket || !this.env.visible()) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.connect()
    this.fallbackPing()
  }

  private startFallback() {
    if (this.fallbackTimer) return
    this.fallbackPing()
    this.fallbackTimer = setInterval(this.fallbackPing, PING_MS)
  }

  private stopFallback() {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer)
    this.fallbackTimer = null
  }

  private readonly fallbackPing = () => {
    // 畫面在背景就不送：人不在了，5 分鐘後讓別人看到離線
    if (this.connected || !this.running || !this.env.visible() || !this.env.online()) return
    this.env
      .ping(this.active(), this.heartbeatExtra())
      .then(({ statuses }) => {
        if (this.running && !this.connected) this.store.apply(true, statuses)
      })
      .catch(() => {
        // 連不上就等下一輪
      })
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.pingTimer = null
    this.retryTimer = null
    this.stopFallback()
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return
    this.connected = connected
    this.connectedListeners.forEach((listener) => listener())
  }

  private emit(event: RealtimeEvent) {
    this.listeners.forEach((listener) => listener(event))
  }
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const

const browserEnv: RealtimeEnv = {
  url: () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`,
  token: readToken,
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  visible: () => document.visibilityState === "visible",
  online: () => navigator.onLine,
  ping: pingPresence,
  heartbeat: () => locationShare.heartbeat(),
  listen(kind, callback) {
    if (kind === "visibility") {
      document.addEventListener("visibilitychange", callback)
      return () => document.removeEventListener("visibilitychange", callback)
    }
    if (kind === "online") {
      window.addEventListener("online", callback)
      return () => window.removeEventListener("online", callback)
    }
    // capture：捲動的是頁面裡的區塊（例如頻道的訊息列表）也算
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, callback, { capture: true, passive: true }))
    return () => ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, callback, { capture: true }))
  },
}

export const realtime = new RealtimeClient(browserEnv)

/** WebSocket 現在連著沒：連著的時候頻道頁不必每 3 秒輪詢 */
export function useRealtimeConnected() {
  return useSyncExternalStore(realtime.subscribeConnected, realtime.isConnected)
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PresenceStore } from "@/lib/presence"
import { IDLE_MS, PING_MS, RealtimeClient, RETRY_MS, type RealtimeEnv, type SocketLike } from "@/lib/realtime"

class FakeSocket implements SocketLike {
  sent: unknown[] = []
  closedWith: number | undefined
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  close(code?: number) {
    this.closedWith = code
  }

  // 以下模擬伺服器
  open() {
    this.onopen?.()
  }

  push(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }

  drop(code = 1006) {
    this.onclose?.({ code })
  }
}

function setup() {
  const sockets: FakeSocket[] = []
  const handlers: Record<string, () => void> = {}
  const state = { token: "token-1" as string | null, visible: true, online: true }
  const env: RealtimeEnv = {
    url: () => "ws://test/api/ws",
    token: () => state.token,
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    visible: () => state.visible,
    online: () => state.online,
    ping: vi.fn().mockResolvedValue({ statuses: { M01: "busy" } }),
    listen: (kind, callback) => {
      handlers[kind] = callback
      return () => delete handlers[kind]
    },
  }
  const store = new PresenceStore()
  const client = new RealtimeClient(env, store)
  const events: unknown[] = []
  client.subscribe((event) => events.push(event))
  const latest = () => sockets.at(-1)!
  // 連上並通過驗證
  const ready = () => {
    latest().open()
    latest().push({ type: "ready", user_id: "U01" })
  }
  return { client, env, state, sockets, handlers, store, events, latest, ready }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("RealtimeClient", () => {
  it("連上後先送 token，ready 之後才算連著，並請畫面補漏掉的訊息", () => {
    const { client, latest, ready, events } = setup()
    client.start()
    latest().open()
    expect(latest().sent).toEqual([{ type: "auth", token: "token-1", active: true }])
    expect(client.isConnected()).toBe(false)
    ready()
    expect(client.isConnected()).toBe(true)
    expect(events).toEqual([{ type: "resync" }])
  })

  it("狀態推來就更新 store，新訊息通知轉給訂閱的畫面", () => {
    const { client, latest, ready, store, events } = setup()
    client.start()
    ready()
    latest().push({ type: "presence", full: true, statuses: { U01: "available", M01: "busy" } })
    latest().push({ type: "presence", full: false, statuses: { M01: "offline" } })
    latest().push({ type: "message", channel_id: 12 })
    expect(Object.fromEntries(store.getSnapshot())).toEqual({ U01: "available" })
    expect(events.at(-1)).toEqual({ type: "message", channel_id: 12 })
  })

  it("每 20 秒心跳；5 分鐘沒碰螢幕就是閒置，一碰馬上再送一次", () => {
    const { client, latest, ready, handlers } = setup()
    client.start()
    ready()
    vi.advanceTimersByTime(PING_MS)
    expect(latest().sent.at(-1)).toEqual({ type: "ping", active: true })
    vi.advanceTimersByTime(IDLE_MS)
    expect(latest().sent.at(-1)).toEqual({ type: "ping", active: false })
    const count = latest().sent.length
    handlers.activity()
    expect(latest().sent.length).toBe(count + 1)
    expect(latest().sent.at(-1)).toEqual({ type: "ping", active: true })
    // 已經是 active 的時候碰螢幕不必多送
    handlers.activity()
    expect(latest().sent.length).toBe(count + 1)
  })

  it("連上時正在閒置，之後一碰螢幕就馬上送 active: true", () => {
    const { client, latest, ready, handlers } = setup()
    client.start()
    vi.advanceTimersByTime(IDLE_MS)
    ready()
    expect(latest().sent).toEqual([{ type: "auth", token: "token-1", active: false }])
    handlers.activity()
    expect(latest().sent.at(-1)).toEqual({ type: "ping", active: true })
  })

  it("切到背景馬上送 active: false，切回前景送 active: true", () => {
    const { client, latest, ready, handlers, state } = setup()
    client.start()
    ready()
    state.visible = false
    handlers.visibility()
    expect(latest().sent.at(-1)).toEqual({ type: "ping", active: false })
    state.visible = true
    handlers.visibility()
    expect(latest().sent.at(-1)).toEqual({ type: "ping", active: true })
  })

  it("斷線就改用 HTTP 心跳，照 1、2、5 秒重連，連上後停掉 HTTP 心跳", async () => {
    const { client, env, sockets, latest, ready, store } = setup()
    client.start()
    ready()
    latest().drop()
    expect(client.isConnected()).toBe(false)
    expect(env.ping).toHaveBeenCalledWith(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.statusOf("M01")).toBe("busy")

    vi.advanceTimersByTime(RETRY_MS[0])
    expect(sockets).toHaveLength(2)
    latest().drop()
    vi.advanceTimersByTime(RETRY_MS[1] - 1)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)

    ready()
    const pings = vi.mocked(env.ping).mock.calls.length
    vi.advanceTimersByTime(PING_MS * 3)
    expect(env.ping).toHaveBeenCalledTimes(pings)
  })

  it("畫面在背景不重連，切回前景馬上連", () => {
    const { client, sockets, latest, ready, handlers, state } = setup()
    client.start()
    ready()
    state.visible = false
    latest().drop()
    vi.advanceTimersByTime(RETRY_MS.at(-1)!)
    expect(sockets).toHaveLength(1)
    state.visible = true
    handlers.visibility()
    expect(sockets).toHaveLength(2)
  })

  it("4401：token 換了（改過密碼）就用新的重連，沒換就不重連", () => {
    const { client, sockets, latest, ready, state } = setup()
    client.start()
    ready()
    state.token = "token-2"
    latest().drop(4401)
    expect(sockets).toHaveLength(2)
    latest().open()
    expect(latest().sent[0]).toMatchObject({ token: "token-2" })
    latest().drop(4401)
    vi.advanceTimersByTime(RETRY_MS.at(-1)! * 2)
    expect(sockets).toHaveLength(2)
  })

  it("停下來就關掉連線、清掉狀態，之後的事件不再處理", () => {
    const { client, latest, ready, store } = setup()
    client.start()
    ready()
    latest().push({ type: "presence", full: true, statuses: { M01: "busy" } })
    const socket = latest()
    client.stop()
    expect(socket.closedWith).toBe(1000)
    expect(client.isConnected()).toBe(false)
    expect(store.getSnapshot().size).toBe(0)
    socket.push({ type: "presence", full: true, statuses: { M01: "busy" } })
    expect(store.getSnapshot().size).toBe(0)
  })
})

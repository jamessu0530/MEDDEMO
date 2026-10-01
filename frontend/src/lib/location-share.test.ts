import { describe, expect, it, vi } from "vitest"

import type { ShareState } from "@/api/location"
import {
  barState,
  barText,
  heartbeatPayload,
  LocationShare,
  MAX_FIX_AGE_MS,
  REFRESH_AFTER_MS,
  withinHours,
  type GeoEnv,
  type Position,
  type ShareSnapshot,
} from "@/lib/location-share"

const HOURS = { weekdays: [1, 2, 3, 4, 5], start: "08:30", end: "18:30" }
const SHARE: ShareState = { applies: true, paused: false, denied: false, manager_name: "陳建宏", hours: HOURS }
// 2026-10-01 是星期四
const WORKING = new Date("2026-10-01T10:00:00+08:00")
const HERE: Position = { lat: 25.034, lng: 121.5645, accuracy: 12, at: WORKING.getTime() }
// 心跳的 location 不帶 at（後端 schema 沒有這個欄位）
const LOCATION_PAYLOAD = { lat: HERE.lat, lng: HERE.lng, accuracy: HERE.accuracy }

const snapshot = (extra: Partial<ShareSnapshot> = {}): ShareSnapshot => ({
  share: SHARE,
  consented: true,
  denied: false,
  position: HERE,
  ...extra,
})

describe("上班時間", () => {
  it.each([
    ["2026-10-01T08:29:00+08:00", false],
    ["2026-10-01T08:30:00+08:00", true],
    ["2026-10-01T18:29:00+08:00", true],
    ["2026-10-01T18:30:00+08:00", false],
    // 星期六
    ["2026-10-03T10:00:00+08:00", false],
    // 看的是台北時間，不是手機的時區
    ["2026-10-01T00:30:00Z", true],
  ])("%s → %s", (iso, inside) => {
    expect(withinHours(new Date(iso), HOURS)).toBe(inside)
  })
})

describe("分享列與心跳", () => {
  it("不是業務、下班時間、還沒載入：不顯示也不帶", () => {
    for (const s of [snapshot({ share: { ...SHARE, applies: false } }), snapshot({ share: null })]) {
      expect(barState(s, WORKING)).toBe("hidden")
      expect(heartbeatPayload(s, WORKING)).toEqual({})
    }
    expect(barState(snapshot(), new Date("2026-10-01T19:00:00+08:00"))).toBe("hidden")
  })

  it("還沒同意：先說明，什麼都不帶", () => {
    expect(barState(snapshot({ consented: false }), WORKING)).toBe("consent")
    expect(heartbeatPayload(snapshot({ consented: false }), WORKING)).toEqual({})
  })

  it("分享中帶最新的位置；還沒拿到位置就先不帶", () => {
    expect(barState(snapshot(), WORKING)).toBe("sharing")
    expect(heartbeatPayload(snapshot(), WORKING)).toEqual({ location: LOCATION_PAYLOAD })
    expect(heartbeatPayload(snapshot({ position: null }), WORKING)).toEqual({})
  })

  it("定位太舊（手機鎖屏、切到背景時瀏覽器停止拿新位置）就不送，剛好 2 分鐘內還送", () => {
    const stale: Position = { ...HERE, at: WORKING.getTime() - MAX_FIX_AGE_MS - 1 }
    expect(heartbeatPayload(snapshot({ position: stale }), WORKING)).toEqual({})
    const fresh: Position = { ...HERE, at: WORKING.getTime() - MAX_FIX_AGE_MS }
    expect(heartbeatPayload(snapshot({ position: fresh }), WORKING)).toEqual({ location: LOCATION_PAYLOAD })
  })

  it("暫停中不帶；暫停比沒有權限優先", () => {
    const paused = snapshot({ share: { ...SHARE, paused: true }, denied: true })
    expect(barState(paused, WORKING)).toBe("paused")
    expect(heartbeatPayload(paused, WORKING)).toEqual({})
  })

  it("沒有權限：帶 location_denied", () => {
    expect(barState(snapshot({ denied: true }), WORKING)).toBe("denied")
    expect(heartbeatPayload(snapshot({ denied: true }), WORKING)).toEqual({ location_denied: true })
  })

  it("分享列的句子", () => {
    expect(barText("sharing", "陳建宏", HOURS)).toBe("位置分享中，陳建宏看得到你在哪（到 18:30）")
    expect(barText("paused", "陳建宏", HOURS)).toBe("已暫停分享，陳建宏會看到「暫停分享」")
    expect(barText("denied", "陳建宏", HOURS)).toBe("沒有開定位權限，陳建宏看不到你在哪")
    expect(barText("denied", null, HOURS)).toBe("沒有開定位權限，主管看不到你在哪")
    expect(barText("hidden", "陳建宏", HOURS)).toBeNull()
  })
})

function setup() {
  const state = { now: WORKING, consent: false, permission: "prompt" as PermissionState, share: SHARE }
  const watchers: Array<{ onPosition: (p: Position) => void; onDenied: () => void; stopped: boolean }> = []
  const refreshes: Array<{ onPosition: (p: Position) => void; onDenied: () => void; onFailed: () => void }> = []
  const env: GeoEnv = {
    now: () => state.now,
    readConsent: () => state.consent,
    writeConsent: () => {
      state.consent = true
    },
    fetchState: vi.fn(async () => state.share),
    permission: async () => state.permission,
    watch: (onPosition, onDenied) => {
      const watcher = { onPosition, onDenied, stopped: false }
      watchers.push(watcher)
      return () => {
        watcher.stopped = true
      }
    },
    refresh: (onPosition, onDenied, onFailed) => {
      refreshes.push({ onPosition, onDenied, onFailed })
    },
  }
  return { env, state, watchers, refreshes, store: new LocationShare(env) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("LocationShare", () => {
  it("第一次心跳去問後端；還沒同意就不追蹤", async () => {
    const { store, watchers, env } = setup()
    expect(store.heartbeat()).toEqual({})
    await settle()
    expect(env.fetchState).toHaveBeenCalledTimes(1)
    expect(barState(store.getSnapshot(), WORKING)).toBe("consent")
    expect(watchers).toHaveLength(0)
  })

  it("同意之後才開始追蹤，拿到位置就帶在心跳裡", async () => {
    const { store, watchers } = setup()
    await store.load()
    store.consent()
    await settle()
    expect(watchers).toHaveLength(1)
    watchers[0].onPosition(HERE)
    expect(store.heartbeat()).toEqual({ location: LOCATION_PAYLOAD })
  })

  it("瀏覽器拒絕：停止追蹤，心跳改帶 location_denied，不再一直跳詢問；設定裡打開之後再開始", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    await store.load()
    watchers[0].onDenied()
    expect(watchers[0].stopped).toBe(true)
    expect(store.heartbeat()).toEqual({ location_denied: true })
    await settle()
    expect(watchers).toHaveLength(1)
    state.permission = "granted"
    store.heartbeat()
    await settle()
    expect(watchers).toHaveLength(2)
  })

  it("權限早就被拒：不呼叫 watch，免得一直跳要權限", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    state.permission = "denied"
    await store.load()
    expect(watchers).toHaveLength(0)
    expect(store.heartbeat()).toEqual({ location_denied: true })
  })

  it("權限其實是 granted，但實際被系統擋掉：重試不會一直開新的 watch", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    state.permission = "granted"
    await store.load()
    expect(watchers).toHaveLength(1)
    watchers[0].onDenied()
    expect(watchers[0].stopped).toBe(true)
    expect(store.heartbeat()).toEqual({ location_denied: true })
    await settle()
    // 權限還是 granted（跟拒絕當下查到的一樣）：不要每次心跳都再跳一次 watch
    store.heartbeat()
    await settle()
    store.heartbeat()
    await settle()
    expect(watchers).toHaveLength(1)
  })

  it("暫停就停止追蹤、清掉位置；繼續之後要等新的一筆才送", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    await store.load()
    watchers[0].onPosition(HERE)
    expect(store.heartbeat()).toEqual({ location: LOCATION_PAYLOAD })
    store.setShare({ ...SHARE, paused: true })
    await settle()
    expect(watchers[0].stopped).toBe(true)
    expect(store.getSnapshot().position).toBeNull()
    expect(store.heartbeat()).toEqual({})
    store.setShare(SHARE)
    await settle()
    expect(watchers).toHaveLength(2)
    expect(watchers[1].stopped).toBe(false)
    // 繼續之後舊位置已經清掉了，要等新的一筆才會帶
    expect(store.heartbeat()).toEqual({})
    watchers[1].onPosition(HERE)
    expect(store.heartbeat()).toEqual({ location: LOCATION_PAYLOAD })
  })

  it("位置超過一分鐘沒更新（有的瀏覽器站著不動就不再回報）：主動要一次，還沒回來之前不會再要", async () => {
    const { store, watchers, refreshes, state } = setup()
    state.consent = true
    await store.load()
    watchers[0].onPosition(HERE)
    expect(store.heartbeat()).toEqual({ location: LOCATION_PAYLOAD })
    // 61 秒後：心跳還是帶著舊的位置（還沒超過 MAX_FIX_AGE_MS），但主動要了一次新的
    state.now = new Date(WORKING.getTime() + REFRESH_AFTER_MS + 1_000)
    expect(store.heartbeat()).toEqual({ location: LOCATION_PAYLOAD })
    expect(refreshes).toHaveLength(1)
    // 還沒回來之前再心跳一次：不會再要一次
    store.heartbeat()
    expect(refreshes).toHaveLength(1)
    // 回來了：心跳帶出新的位置
    const fresh: Position = { ...HERE, at: state.now.getTime() }
    refreshes[0].onPosition(fresh)
    expect(store.heartbeat()).toEqual({ location: LOCATION_PAYLOAD })
    // 又過了一分鐘沒更新：再主動要一次
    state.now = new Date(state.now.getTime() + REFRESH_AFTER_MS + 1_000)
    store.heartbeat()
    expect(refreshes).toHaveLength(2)
  })

  it("主動要位置被拒絕：跟 watch 的拒絕一樣處理", async () => {
    const { store, watchers, refreshes, state } = setup()
    state.consent = true
    await store.load()
    watchers[0].onPosition(HERE)
    state.now = new Date(WORKING.getTime() + REFRESH_AFTER_MS + 1_000)
    store.heartbeat()
    expect(refreshes).toHaveLength(1)
    refreshes[0].onDenied()
    expect(watchers[0].stopped).toBe(true)
    expect(store.heartbeat()).toEqual({ location_denied: true })
  })

  it("主動要位置失敗（逾時、拿不到位置，不是拒絕）：清掉正在等的旗標，位置還是舊的就下次心跳再要一次", async () => {
    const { store, watchers, refreshes, state } = setup()
    state.consent = true
    await store.load()
    watchers[0].onPosition(HERE)
    state.now = new Date(WORKING.getTime() + REFRESH_AFTER_MS + 1_000)
    store.heartbeat()
    expect(refreshes).toHaveLength(1)
    refreshes[0].onFailed()
    // 不是拒絕：watch 繼續開著，沒有改成 location_denied
    expect(watchers[0].stopped).toBe(false)
    expect(store.heartbeat()).toEqual({ location: LOCATION_PAYLOAD })
    // 卡住的旗標已經清掉，位置還是一樣舊：這次心跳要再要一次，不會因為上一次失敗就永遠不再嘗試
    expect(refreshes).toHaveLength(2)
  })

  it("暫停中或還沒同意：不會主動要位置", async () => {
    const { store, refreshes, state } = setup()
    // 還沒同意：連 watch 都沒開始，不會主動要
    state.now = new Date(WORKING.getTime() + REFRESH_AFTER_MS + 1_000)
    store.heartbeat()
    await settle()
    expect(refreshes).toHaveLength(0)
    // 暫停：watch 已經停了，不會主動要
    state.consent = true
    state.now = WORKING
    await store.load()
    store.setShare({ ...SHARE, paused: true })
    await settle()
    state.now = new Date(WORKING.getTime() + REFRESH_AFTER_MS + 1_000)
    store.heartbeat()
    expect(refreshes).toHaveLength(0)
  })

  it("下班時間停止追蹤", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    await store.load()
    state.now = new Date("2026-10-01T18:31:00+08:00")
    expect(store.heartbeat()).toEqual({})
    await settle()
    expect(watchers[0].stopped).toBe(true)
  })

  it("換人就全部清掉", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    await store.load()
    store.reset()
    expect(watchers[0].stopped).toBe(true)
    expect(store.getSnapshot().share).toBeNull()
  })

  it("等權限回來的時候狀態已經變了（暫停）：不要還去開 watch", async () => {
    const watchers: Array<{ onPosition: (p: Position) => void; onDenied: () => void; stopped: boolean }> = []
    // 用物件裝著讓 Promise 執行器裡的指派逃過 TS 把閉包變數的型別收窄成 never 的問題
    const gate: { resolvePermission: ((permission: PermissionState) => void) | null } = { resolvePermission: null }
    const env: GeoEnv = {
      now: () => WORKING,
      readConsent: () => true,
      writeConsent: () => {},
      fetchState: async () => SHARE,
      permission: () =>
        new Promise<PermissionState>((resolve) => {
          gate.resolvePermission = resolve
        }),
      watch: (onPosition, onDenied) => {
        const watcher = { onPosition, onDenied, stopped: false }
        watchers.push(watcher)
        return () => {
          watcher.stopped = true
        }
      },
      refresh: () => {},
    }
    const store = new LocationShare(env)
    void store.load()
    await settle() // fetchState 回來了，sync() 卡在等 permission()
    store.setShare({ ...SHARE, paused: true })
    gate.resolvePermission?.("granted")
    await settle()
    expect(watchers).toHaveLength(0)
  })

  it("load 還沒回來就換人（reset）：舊的結果不能蓋掉清空的狀態", async () => {
    const gate: { resolveFetch: ((share: ShareState) => void) | null } = { resolveFetch: null }
    const env: GeoEnv = {
      now: () => WORKING,
      readConsent: () => true,
      writeConsent: () => {},
      fetchState: () =>
        new Promise<ShareState>((resolve) => {
          gate.resolveFetch = resolve
        }),
      permission: async () => "prompt",
      watch: () => () => {},
      refresh: () => {},
    }
    const store = new LocationShare(env)
    const loading = store.load()
    store.reset()
    gate.resolveFetch?.(SHARE)
    await loading
    await settle()
    expect(store.getSnapshot().share).toBeNull()
  })
})

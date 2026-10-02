import { describe, expect, it, vi } from "vitest"

import type { PreferenceChanges, Preferences } from "@/api/preferences"
import { PreferenceSync } from "@/lib/preferences"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// 等排在後面的 then 都跑完
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 假的伺服器與手機：server 是伺服器上存的，stored 是手機裡記著還沒送的 */
function setup(server: Preferences = { skin: null, text_size: null }) {
  const stored: Record<string, PreferenceChanges> = {}
  const env = {
    fetch: vi.fn(async () => ({ ...server })),
    save: vi.fn(async (changes: PreferenceChanges) => {
      server = { skin: "light", text_size: "standard", ...stripNulls(server), ...changes }
      return server
    }),
    local: vi.fn(() => ({ skin: "dark" as const, text_size: "large" as const })),
    apply: vi.fn(),
    readPending: vi.fn((userId: string) => stored[userId] ?? {}),
    writePending: vi.fn((userId: string, pending: PreferenceChanges) => {
      stored[userId] = pending
    }),
  }
  return { sync: new PreferenceSync(env), env, stored, server: () => server }
}

function stripNulls(values: Preferences): PreferenceChanges {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null))
}

describe("PreferenceSync", () => {
  it("還沒存過的帳號：把這支手機現在的設定存上去，畫面不動", async () => {
    const { sync, env, server } = setup()
    await sync.load("U01")
    await settle()
    expect(env.save).toHaveBeenCalledWith({ skin: "dark", text_size: "large" })
    expect(server()).toEqual({ skin: "dark", text_size: "large" })
    expect(env.apply).not.toHaveBeenCalled()
  })

  it("存過的帳號：一登入就換成伺服器上的，以伺服器為準", async () => {
    const { sync, env } = setup({ skin: "dark", text_size: "xlarge" })
    await sync.load("U01")
    expect(env.apply).toHaveBeenCalledWith({ skin: "dark", text_size: "xlarge" })
    expect(env.save).not.toHaveBeenCalled()
  })

  it("沒登入（登入頁）選的只記在手機裡，不送", () => {
    const { sync, env } = setup()
    sync.choose({ skin: "dark" })
    expect(env.save).not.toHaveBeenCalled()
  })

  it("存不上去就留著：重拿之前先再送一次，送不上去也不讓伺服器的舊值蓋回來", async () => {
    const { sync, env, stored } = setup({ skin: "light", text_size: "standard" })
    await sync.load("U01")
    env.apply.mockClear()
    env.save.mockRejectedValue(new Error("offline"))
    sync.choose({ skin: "dark" })
    await settle()
    expect(stored.U01).toEqual({ skin: "dark" })
    // WebSocket 重連：先再送一次，還是送不上去；伺服器上的舊配色不會蓋回剛選的深色
    await sync.load("U01")
    expect(env.save).toHaveBeenCalledTimes(2)
    expect(env.apply).not.toHaveBeenCalled()
  })

  it("下次打開（換了一個 store）先把上次沒送成功的送出去", async () => {
    const { sync, env, stored, server } = setup({ skin: "light", text_size: "standard" })
    stored.U01 = { text_size: "xlarge" }
    await sync.load("U01")
    expect(env.save).toHaveBeenCalledWith({ text_size: "xlarge" })
    expect(stored.U01).toEqual({})
    expect(server()).toEqual({ skin: "light", text_size: "xlarge" })
    // 伺服器回的跟剛存的一樣，不必再套一次
    expect(env.apply).toHaveBeenCalledWith({ skin: "light" })
  })

  it("還沒回來的那次讀取，遇到剛選的就作廢", async () => {
    const { sync, env } = setup({ skin: "light", text_size: "standard" })
    const slow = deferred<Preferences>()
    env.fetch.mockReturnValueOnce(slow.promise)
    const loading = sync.load("U01")
    await settle()
    sync.choose({ text_size: "large" })
    slow.resolve({ skin: "light", text_size: "standard" })
    await loading
    expect(env.apply).not.toHaveBeenCalled()
  })

  it("自己剛換配色，自己那支收到通知重拿時不再套一次（噴漆還在播）", async () => {
    const { sync, env } = setup({ skin: "light", text_size: "standard" })
    await sync.load("U01")
    env.apply.mockClear()
    sync.choose({ skin: "dark" })
    await settle()
    await sync.load("U01")
    expect(env.apply).not.toHaveBeenCalled()
  })

  it("別的裝置改了，收到通知重拿就跟著換", async () => {
    const { sync, env } = setup({ skin: "light", text_size: "standard" })
    await sync.load("U01")
    env.apply.mockClear()
    env.fetch.mockResolvedValueOnce({ skin: "dark", text_size: "standard" })
    await sync.load("U01")
    expect(env.apply).toHaveBeenCalledWith({ skin: "dark" })
  })

  it("送的期間又選了，送完接著送新的那個，一次只送一個", async () => {
    const { sync, env, server } = setup({ skin: "light", text_size: "standard" })
    await sync.load("U01")
    const first = deferred<Preferences>()
    env.save.mockReturnValueOnce(first.promise)
    sync.choose({ skin: "dark" })
    sync.choose({ skin: "light" })
    expect(env.save).toHaveBeenCalledTimes(1)
    first.resolve({ skin: "dark", text_size: "standard" })
    await settle()
    expect(env.save).toHaveBeenLastCalledWith({ skin: "light" })
    expect(server().skin).toBe("light")
  })

  it("換人登入：上一個人沒送成功的不會送到下一個人身上", async () => {
    const { sync, env, stored } = setup({ skin: "light", text_size: "standard" })
    await sync.load("U01")
    env.save.mockRejectedValueOnce(new Error("offline"))
    sync.choose({ skin: "dark" })
    await settle()
    sync.clear()
    env.save.mockClear()
    await sync.load("U02")
    expect(env.save).not.toHaveBeenCalled()
    expect(stored.U01).toEqual({ skin: "dark" })
  })
})

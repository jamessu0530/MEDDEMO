import { describe, expect, it, vi } from "vitest"

import { createInkController, type InkFrame, type InkRequest } from "@/ink/controller"
import { INK_DURATION, inkColors } from "@/ink/effects"

const FRAME = 16
const HALF = INK_DURATION.brush / 2

/** 假的時鐘、假的 requestAnimationFrame、假的畫布：一格一格推，看 controller 做了什麼 */
function setup({ canAnimate = true, attach = true } = {}) {
  let now = 0
  let frames: (() => void)[] = []
  let timers: { at: number; fn: () => void }[] = []
  const drawn: InkFrame[] = []
  const surface = {
    begin: vi.fn(() => ({ origin: [10, 20] as const })),
    draw: vi.fn((frame: InkFrame) => void drawn.push(frame)),
    clear: vi.fn(),
    degrade: vi.fn(),
  }
  const ink = createInkController({
    now: () => now,
    raf: (callback) => void frames.push(callback),
    canAnimate: () => canAnimate,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      const timer = { at: now + ms, fn }
      timers.push(timer)
      return () => {
        timers = timers.filter((other) => other !== timer)
      }
    },
  })
  if (attach) ink.attach(surface)

  /** 過 ms 毫秒：到期的計時器先跑，再跑排著的那一格；paint 是 false 就當作分頁在背景、畫面沒有更新 */
  async function step(ms = FRAME, paint = true) {
    now += ms
    const due = timers.filter((timer) => timer.at <= now)
    timers = timers.filter((timer) => timer.at > now)
    due.forEach((timer) => timer.fn())
    if (paint) {
      const batch = frames
      frames = []
      batch.forEach((callback) => callback())
    }
    await Promise.resolve() // atSwap 的結果是用 Promise 接的，讓它有機會跑
    await Promise.resolve()
  }
  async function until(done: () => boolean, ms = FRAME) {
    for (let i = 0; i < 500 && !done(); i++) await step(ms)
    expect(done()).toBe(true)
  }
  const request = (extra: Partial<InkRequest> = {}): InkRequest => ({ effect: "brush", colors: inkColors("purple"), ...extra })
  return { ink, surface, drawn, step, until, request }
}

describe("createInkController", () => {
  it("照順序蓋、換、等、露出，最後把畫布清掉", async () => {
    const { ink, surface, drawn, step, until, request } = setup()
    const atSwap = vi.fn()
    const phases: string[] = []
    ink.subscribe(() => phases.push(ink.phase()))

    ink.play(request({ atSwap }))
    expect(ink.phase()).toBe("cover")
    expect(surface.begin).toHaveBeenCalledTimes(1)

    await step()
    expect(drawn.at(-1)).toMatchObject({ effect: "brush", origin: [10, 20], seed: [0.5, 0.5] })
    expect(drawn.at(-1)!.t).toBeCloseTo((FRAME / HALF) * 0.5)
    expect(atSwap).not.toHaveBeenCalled()

    await until(() => ink.phase() !== "cover")
    expect(atSwap).toHaveBeenCalledTimes(1)
    expect(drawn.at(-1)!.t).toBe(0.5)

    await until(() => ink.phase() === "reveal")
    await until(() => ink.phase() === "idle")
    expect(atSwap).toHaveBeenCalledTimes(1)
    expect(phases).toEqual(["cover", "hold", "reveal", "idle"])
    expect(surface.clear).toHaveBeenCalledTimes(1)

    // 進度一路往前，前半不超過 0.5，後半不回頭
    const ts = drawn.map((frame) => frame.t)
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
    expect(Math.max(...ts)).toBeLessThan(1)
  })

  it("換頁後至少停兩格才開始露出，讓新的畫面先畫出來", async () => {
    const { ink, step, until, request } = setup()
    ink.play(request())
    await until(() => ink.phase() === "hold")
    await step()
    expect(ink.phase()).toBe("hold")
    await step()
    expect(ink.phase()).toBe("reveal")
  })

  it("atSwap 回傳 Promise 就等它結束才露出", async () => {
    const { ink, step, until, request } = setup()
    let finish = () => {}
    const pending = new Promise<void>((resolve) => (finish = resolve))
    ink.play(request({ atSwap: () => pending }))
    await until(() => ink.phase() === "hold")
    for (let i = 0; i < 20; i++) await step()
    expect(ink.phase()).toBe("hold")

    finish()
    await Promise.resolve()
    await step()
    expect(ink.phase()).toBe("reveal")
  })

  it("Promise 一直不結束，最多等 1.5 秒就露出", async () => {
    const { ink, step, until, request } = setup()
    ink.play(request({ atSwap: () => new Promise(() => {}) }))
    await until(() => ink.phase() === "hold")
    await step(1400)
    expect(ink.phase()).toBe("hold")
    await step(200)
    expect(ink.phase()).toBe("reveal")
  })

  it("通知訂閱換頁的人，而且在 atSwap 之後", async () => {
    const { ink, until, request } = setup()
    const order: string[] = []
    ink.onSwap(() => order.push("listener"))
    ink.play(request({ atSwap: () => void order.push("atSwap") }))
    await until(() => ink.phase() === "idle")
    expect(order).toEqual(["atSwap", "listener"])
  })

  it("不能播（減少動態效果、分頁在背景）就馬上做，不碰畫布", () => {
    const { ink, surface, request } = setup({ canAnimate: false })
    const atSwap = vi.fn()
    const listener = vi.fn()
    ink.onSwap(listener)

    expect(ink.ready()).toBe(false)
    ink.play(request({ atSwap }))
    expect(atSwap).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(ink.phase()).toBe("idle")
    expect(surface.begin).not.toHaveBeenCalled()
  })

  it("沒有畫布、或畫布說現在畫不了，也是馬上做", () => {
    const none = setup({ attach: false })
    const first = vi.fn()
    expect(none.ink.ready()).toBe(false)
    none.ink.play(none.request({ atSwap: first }))
    expect(first).toHaveBeenCalledTimes(1)

    const broken = setup()
    broken.surface.begin.mockReturnValueOnce(null as never)
    const second = vi.fn()
    broken.ink.play(broken.request({ atSwap: second }))
    expect(second).toHaveBeenCalledTimes(1)
    expect(broken.ink.phase()).toBe("idle")
  })

  it("播到一半再叫一次不疊第二段，後面那件事馬上做", async () => {
    const { ink, surface, step, until, request } = setup()
    const first = vi.fn()
    const second = vi.fn()
    ink.play(request({ atSwap: first }))
    await step()
    expect(ink.ready()).toBe(false)

    ink.play(request({ effect: "splat", atSwap: second }))
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(surface.begin).toHaveBeenCalledTimes(1)

    await until(() => ink.phase() === "idle")
    expect(first).toHaveBeenCalledTimes(1)
    expect(surface.draw.mock.calls.every(([frame]) => frame.effect === "brush")).toBe(true)
  })

  it("畫面停止更新（分頁被切到背景）時，計時器保底把頁面換過去並收掉", async () => {
    const { ink, surface, step, request } = setup()
    const atSwap = vi.fn()
    ink.play(request({ atSwap }))

    await step(HALF + 400, false)
    expect(atSwap).not.toHaveBeenCalled()
    await step(200, false)
    expect(atSwap).toHaveBeenCalledTimes(1)
    expect(ink.phase()).toBe("idle")
    expect(surface.clear).toHaveBeenCalledTimes(1)

    // 之後畫面恢復更新，先前排著的那一格不會再做任何事
    await step()
    expect(atSwap).toHaveBeenCalledTimes(1)
    expect(surface.clear).toHaveBeenCalledTimes(1)
  })

  it("畫布中途被拿掉，該做的事照樣做", async () => {
    const { ink, surface, step, request } = setup()
    const atSwap = vi.fn()
    ink.play(request({ atSwap }))
    await step()

    ink.attach(null)
    expect(atSwap).toHaveBeenCalledTimes(1)
    expect(ink.phase()).toBe("idle")
    expect(surface.clear).toHaveBeenCalledTimes(1)
  })

  it("atSwap 丟錯誤不會讓墨卡在畫面上", async () => {
    const { ink, surface, until, request } = setup()
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const boom = new Error("boom")
    ink.play(
      request({
        atSwap: () => {
          throw boom
        },
      })
    )
    await until(() => ink.phase() === "idle")
    expect(logged).toHaveBeenCalledWith(boom)
    expect(surface.clear).toHaveBeenCalledTimes(1)
    logged.mockRestore()
  })

  it("每格都很慢就請畫布降解析度，順的時候不降", async () => {
    const slow = setup()
    slow.ink.play(slow.request())
    await slow.until(() => slow.ink.phase() === "idle", 40)
    expect(slow.surface.degrade).toHaveBeenCalledTimes(1)

    const smooth = setup()
    smooth.ink.play(smooth.request())
    await smooth.until(() => smooth.ink.phase() === "idle")
    expect(smooth.surface.degrade).not.toHaveBeenCalled()
  })
})

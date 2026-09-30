import { INK_DURATION, type InkColors, type InkEffect } from "@/ink/effects"

/** 一段轉場走到哪裡：蓋（墨蓋上來）、等（蓋滿了，等新的畫面畫出來）、露出（墨退掉） */
export type InkPhase = "idle" | "cover" | "hold" | "reveal"

/** 要畫的一格。t 是進度：0 還沒有墨，0.5 整個畫面都是墨，1 墨都退掉了 */
export type InkFrame = {
  effect: InkEffect
  t: number
  origin: readonly [number, number]
  seed: readonly [number, number]
  colors: InkColors
}

/** 畫墨的那張畫布（components/ink-transition.tsx 接上 WebGL 的那一個） */
export type InkSurface = {
  /** 一段轉場開始前叫一次：調好畫布大小，回傳墨從哪裡出來；現在畫不了（這種效果的著色器壞了、太卡已經停用）就回 null */
  begin(effect: InkEffect): { origin: readonly [number, number] } | null
  draw(frame: InkFrame): void
  clear(): void
  /** 這一段播得很卡，下一段降一級解析度 */
  degrade?(): void
}

export type InkRequest = {
  effect: InkEffect
  colors: InkColors
  /** 墨蓋滿的那一刻要做的事（換頁、換配色、登出）。回傳 Promise 的話會等它結束才露出 */
  atSwap?: () => unknown
}

/** 時間、畫面更新、亂數都從外面給，測試才能一格一格推（ink/controller.test.ts） */
export type InkDeps = {
  now(): number
  raf(callback: () => void): void
  /** 現在適不適合播：系統開了減少動態效果、分頁在背景都不播 */
  canAnimate(): boolean
  random(): number
  /** 回傳取消這個計時器的函式 */
  setTimer(fn: () => void, ms: number): () => void
}

// 換頁後至少停這麼多格才露出，讓新的那一頁先畫出來
const HOLD_FRAMES = 2
// atSwap 回傳的 Promise（登出要等伺服器）最多等這麼久
const HOLD_LIMIT_MS = 1500
// 蓋的那一段超過預定時間這麼久還沒蓋完，就當作畫面停止更新了（分頁被切到背景），直接換頁收掉
const STALL_MS = 500
// 平均每格超過這麼久算卡；中間有停頓超過 PAUSE_MS 的那一段不算（那是被切到背景，不是畫得慢）
const SLOW_FRAME_MS = 30
const PAUSE_MS = 250

type Run = {
  request: InkRequest
  origin: readonly [number, number]
  seed: readonly [number, number]
  half: number
  start: number
  swapAt: number
  revealAt: number
  holdFrames: number
  settled: boolean
  last: number
  frames: number
  activeMs: number
  paused: boolean
  cancelTimer: () => void
}

export function createInkController(deps: InkDeps) {
  let surface: InkSurface | null = null
  let phase: InkPhase = "idle"
  let run: Run | null = null
  const phaseListeners = new Set<() => void>()
  const swapListeners = new Set<() => void>()

  function setPhase(next: InkPhase) {
    phase = next
    phaseListeners.forEach((listener) => listener())
  }

  function draw(current: Run, t: number) {
    surface?.draw({ effect: current.request.effect, t, origin: current.origin, seed: current.seed, colors: current.request.colors })
  }

  /** 做蓋滿時該做的事。它丟錯誤也要把這一段播完，不然墨會卡在畫面上 */
  function swap(current: Run) {
    current.swapAt = deps.now()
    setPhase("hold")
    const done = () => {
      current.settled = true
    }
    try {
      Promise.resolve(current.request.atSwap?.()).then(done, done)
    } catch (error) {
      console.error(error)
      done()
    }
    swapListeners.forEach((listener) => listener())
  }

  function finish(current: Run) {
    current.cancelTimer()
    surface?.clear()
    if (!current.paused && current.frames > 0 && current.activeMs / current.frames > SLOW_FRAME_MS) surface?.degrade?.()
    run = null
    setPhase("idle")
  }

  /** 蓋到一半就要收掉（畫面停止更新、畫布被拿掉）：該做的事照樣做，墨直接清掉 */
  function cut(current: Run) {
    if (phase === "cover") swap(current)
    finish(current)
  }

  function tick(current: Run) {
    if (run !== current) return
    const now = deps.now()
    const gap = now - current.last
    current.last = now
    if (gap > PAUSE_MS) current.paused = true

    if (phase === "cover") {
      current.frames++
      current.activeMs += gap
      const t = Math.min((now - current.start) / current.half, 1) * 0.5
      draw(current, t)
      if (t >= 0.5) swap(current)
    } else if (phase === "hold") {
      draw(current, 0.5)
      current.holdFrames++
      if (current.holdFrames >= HOLD_FRAMES && (current.settled || now - current.swapAt >= HOLD_LIMIT_MS)) {
        current.revealAt = now
        setPhase("reveal")
      }
    } else {
      current.frames++
      current.activeMs += gap
      const t = 0.5 + Math.min((now - current.revealAt) / current.half, 1) * 0.5
      if (t >= 1) return finish(current)
      draw(current, t)
    }
    deps.raf(() => tick(current))
  }

  return {
    /** 接上畫布；null 是拿掉（畫面卸載、WebGL 不能用） */
    attach(next: InkSurface | null) {
      if (run) cut(run)
      surface = next
    },

    /** 現在叫 play 會不會真的播：沒有正在播的、有畫布、也適合播 */
    ready() {
      return phase === "idle" && surface !== null && deps.canAnimate()
    },

    /**
     * 播一段：蓋滿 → atSwap → 等新的畫面 → 露出。不能播、或上一段還沒播完，就不播，atSwap 馬上做。
     * atSwap 回傳的 Promise 被拒絕不會往外丟，要處理錯誤的人自己在 atSwap 裡處理。
     */
    play(request: InkRequest) {
      const begun = phase === "idle" && deps.canAnimate() ? surface?.begin(request.effect) : null
      if (!begun) {
        request.atSwap?.()
        if (phase === "idle") swapListeners.forEach((listener) => listener())
        return
      }
      const now = deps.now()
      const half = INK_DURATION[request.effect] / 2
      const current: Run = {
        request,
        origin: begun.origin,
        seed: [deps.random(), deps.random()],
        half,
        start: now,
        swapAt: 0,
        revealAt: 0,
        holdFrames: 0,
        settled: false,
        last: now,
        frames: 0,
        activeMs: 0,
        paused: false,
        cancelTimer: deps.setTimer(() => {
          if (run === current && phase === "cover") cut(current)
        }, half + STALL_MS),
      }
      run = current
      setPhase("cover")
      deps.raf(() => tick(current))
    },

    phase() {
      return phase
    },

    /** 每次換階段通知一次 */
    subscribe(listener: () => void) {
      phaseListeners.add(listener)
      return () => {
        phaseListeners.delete(listener)
      }
    },

    /** 墨蓋滿、atSwap 做完的那一刻通知（components/ink-transition.tsx 靠它把舊的那一頁放掉） */
    onSwap(listener: () => void) {
      swapListeners.add(listener)
      return () => {
        swapListeners.delete(listener)
      }
    },
  }
}

export type InkController = ReturnType<typeof createInkController>

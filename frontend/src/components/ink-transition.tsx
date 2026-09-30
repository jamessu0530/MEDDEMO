import { useEffect, useRef, useState, type ReactNode } from "react"
import { Routes, useLocation, useNavigationType, type Location } from "react-router"

import { inkColors, pickEffect, type InkEffect } from "@/ink/effects"
import { ink } from "@/ink/ink"
import { createInkRenderer } from "@/ink/renderer"
import { readSkin } from "@/lib/skin"

// 按下去之後這麼久以內發生的換頁才算是這一下按出來的，墨從按的位置出來；
// 超過（登入等伺服器回來才換頁）或根本沒按（鍵盤操作）就從畫面中間偏上出來
const POINTER_FRESH_MS = 1200

/**
 * 畫墨的那張 canvas：固定在最上層、跟 App 同寬。平常隱藏；播的時候蓋住畫面，順便擋掉點擊，
 * 免得按到墨底下看不到的東西。瀏覽器開不了 WebGL 就不接上，所有換頁照原本的樣子直接換。
 */
export function InkOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = canvas && createInkRenderer(canvas)
    if (!canvas || !renderer) return

    const pointer = { x: 0, y: 0, at: -Infinity }
    const onPointerDown = (event: PointerEvent) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.at = performance.now()
    }
    window.addEventListener("pointerdown", onPointerDown, true)
    // 著色器晚一點再編譯，不跟第一個畫面搶時間
    const warming = window.setTimeout(renderer.warm, 800)

    ink.attach({
      begin(effect) {
        if (!renderer.canDraw(effect)) return null
        const rect = renderer.resize()
        if (rect.width === 0 || rect.height === 0) return null
        canvas.style.visibility = "visible"
        const fresh = performance.now() - pointer.at < POINTER_FRESH_MS
        const x = fresh ? pointer.x - rect.left : rect.width / 2
        const y = fresh ? pointer.y - rect.top : rect.height * 0.42
        return { origin: [Math.min(Math.max(x, 0), rect.width), Math.min(Math.max(y, 0), rect.height)] }
      },
      draw: renderer.draw,
      clear() {
        renderer.clear()
        canvas.style.visibility = "hidden"
      },
      degrade: renderer.degrade,
    })

    return () => {
      ink.attach(null)
      window.clearTimeout(warming)
      window.removeEventListener("pointerdown", onPointerDown, true)
      renderer.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-y-0 left-1/2 z-60 h-full w-full max-w-md -translate-x-1/2"
      style={{ visibility: "hidden" }}
    />
  )
}

/**
 * 取代 <Routes>：換頁時先繼續顯示舊的那一頁，墨蓋滿了才換成新的，再露出來。
 * <Link>、navigate()、瀏覽器的上一頁都會經過這裡，各頁不必改。哪種換頁播哪一種看 ink/effects.ts 的 pickEffect。
 *
 * 不播、直接換的情況：同一頁（只換查詢參數或 state）；replace 的導頁，那些是轉址（沒登入被送去登入頁、
 * 主管的首頁轉到主管端）或流程裡換步驟，不是使用者按了要去別頁；現在不能播（上一段還沒播完、減少動態效果）。
 *
 * <Routes> 永遠拿到 location：有時給有時不給的話，React Router 包的那一層會跟著出現又消失，整頁會被重新掛載。
 */
export function InkRoutes({ children }: { children: ReactNode }) {
  const location = useLocation()
  const type = useNavigationType()
  const [seen, setSeen] = useState(location)
  // 墨還沒蓋滿時留著繼續顯示的舊頁面，和這次播哪一種
  const [held, setHeld] = useState<{ location: Location; effect: InkEffect } | null>(null)
  // 已經為哪一次換頁叫過 play：開發模式下 effect 會跑兩次，第二次不能再叫
  const played = useRef<unknown>(null)

  if (location !== seen) {
    setSeen(location)
    // 已經留著舊頁面時又換頁（蓋到一半又按了別的）：不用再做什麼，蓋滿時會直接換到最新的那一頁
    const effect = held || type === "REPLACE" ? null : pickEffect(seen.pathname, location.pathname)
    if (effect && ink.ready()) setHeld({ location: seen, effect })
  }

  useEffect(() => {
    if (!held || played.current === held) return
    played.current = held
    ink.play({ effect: held.effect, colors: inkColors(readSkin()), atSwap: () => setHeld(null) })
  }, [held])

  return <Routes location={held?.location ?? location}>{children}</Routes>
}

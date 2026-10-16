import { useEffect, useRef, useState } from "react"

import { Mascot } from "@/components/mascot"
import type { MascotScene } from "@/components/mascot-3d-scene"
import { mascotPalette, type MascotEncounter, type MascotLook } from "@/lib/mascot-collection"
import { EMPTY_MASCOT_TAPS, MASCOT_TAP_WINDOW_MS, tapMascot } from "@/lib/mascot-play"

import "./mascot-3d.css"

export function Mascot3D({ look, onEncounter }: { look: MascotLook; onEncounter: (eventId: string) => Promise<MascotEncounter> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<MascotScene | null>(null)
  const dragged = useRef(false)
  const eventId = useRef("")
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [taps, setTaps] = useState(EMPTY_MASCOT_TAPS)
  const [found, setFound] = useState<MascotEncounter | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const status = pending ? "看看遇到哪隻熊熊…" : found && found.color_id !== "classic" ? `${found.newly_collected ? "新收藏！" : "又遇到"}${mascotPalette(found.color_id).name}` : taps.split ? "噗！變成兩隻了。" : taps.count >= 4 ? "熊熊滾快忍不住了…" : failed ? "這台裝置目前顯示平面版本。" : !ready ? "準備熊熊的小舞台中…" : ""

  useEffect(() => {
    const canvas = canvasRef.current, host = hostRef.current
    if (!canvas || !host) return
    let cancelled = false
    import("@/components/mascot-3d-scene").then(({ createMascotScene }) => {
      if (cancelled) return
      try {
        sceneRef.current = createMascotScene({ canvas, host, onDragEnd: (moved) => { dragged.current = moved }, onContextLost: () => { setReady(false); setFailed(true) } })
        setReady(true)
      } catch { setFailed(true) }
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true; sceneRef.current?.destroy(); sceneRef.current = null }
  }, [])

  useEffect(() => {
    const svg = sourceRef.current?.querySelector("svg")
    if (svg) sceneRef.current?.sync({ svg, color: look.color, motion: "idle", motionId: 0, split: taps.split, foundColor: found?.color_id ?? null, taps: taps.count })
  }, [ready, look, taps, found])

  useEffect(() => {
    if (!taps.count || taps.split) return
    const timer = window.setTimeout(() => setTaps(EMPTY_MASCOT_TAPS), MASCOT_TAP_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [taps])

  async function discover() {
    setPending(true); setError("")
    try { setFound(await onEncounter(eventId.current)) }
    catch (err) { setError(err instanceof Error ? err.message : "收藏暫時沒有存好，請再試一次") }
    finally { setPending(false) }
  }

  function poke() {
    if (dragged.current) { dragged.current = false; return }
    if (taps.split) return
    const next = tapMascot(taps, Date.now())
    setTaps(next)
    if (next.split) { eventId.current = crypto.randomUUID(); void discover() }
  }

  function reset() { setTaps(EMPTY_MASCOT_TAPS); setFound(null); setError("") }

  return <div className="mascot-3d" data-ready={ready} data-split={taps.split}>
    <div className="mascot-3d-host" ref={hostRef}>
      <button className="mascot-3d-touch" type="button" aria-label={taps.split ? "兩隻立體熊熊滾" : "戳戳立體熊熊滾，連續六下會分裂"} onClick={poke}>
        <span ref={sourceRef} className={`mascot-3d-source ${ready || taps.split ? "hidden-source" : ""}`}><Mascot look={look} size={240} /></span>
        {!ready && taps.split && <span className="mascot-3d-flat-twins"><Mascot look={look} size={130} /><Mascot look={{ ...look, color: found?.color_id ?? look.color }} size={130} /></span>}
        <canvas ref={canvasRef} className={ready ? "ready" : ""} aria-hidden />
      </button>
    </div>
    {status && <p className="mascot-3d-status" role="status">{status}</p>}
    {error && <><p className="mascot-3d-status" role="alert">{error}</p><button className="mascot-play-reset" type="button" disabled={pending} onClick={() => void discover()}>重新確認收藏</button></>}
    {taps.split && <button className="mascot-play-reset" type="button" disabled={pending} onClick={reset}>合回一隻</button>}
  </div>
}

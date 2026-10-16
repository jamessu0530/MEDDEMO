import { useEffect, useRef, useState } from "react"

import { MascotFigure } from "@/components/mascot"
import type { MascotState } from "@/lib/mascot"
import { DEFAULT_MASCOT_LOOK, mascotPalette, type MascotEncounter, type MascotLook } from "@/lib/mascot-collection"
import { EMPTY_MASCOT_TAPS, MASCOT_TAP_WINDOW_MS, tapMascot } from "@/lib/mascot-play"
import { cn } from "@/lib/utils"

import "./mascot-play.css"

/** 戳太多次會噗地分裂的熊熊滾；裝飾、AI 狀態等用途仍用 Mascot。 */
export function MascotPlay({ state = "idle", size = 96, bust = false, className, look = DEFAULT_MASCOT_LOOK, onEncounter }: { state?: MascotState; size?: number; bust?: boolean; className?: string; look?: MascotLook; onEncounter?: (eventId: string) => Promise<MascotEncounter> }) {
  const [taps, setTaps] = useState(EMPTY_MASCOT_TAPS)
  const [found, setFound] = useState<MascotEncounter | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventId = useRef("")

  async function discover() {
    if (!onEncounter) return
    setPending(true)
    setError(null)
    try {
      setFound(await onEncounter(eventId.current))
    } catch (err) {
      setError(err instanceof Error ? err.message : "收藏暫時沒有存好，請再試一次")
    } finally {
      setPending(false)
    }
  }

  function poke() {
    const next = tapMascot(taps, Date.now())
    setTaps(next)
    if (next.split && !taps.split) {
      eventId.current = crypto.randomUUID()
      void discover()
    }
  }

  useEffect(() => {
    if (!taps.count || taps.split) return
    const timer = window.setTimeout(() => setTaps(EMPTY_MASCOT_TAPS), MASCOT_TAP_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [taps])

  return (
    <div className={cn("mascot-play", className)} data-taps={taps.count} data-split={taps.split}>
      <button
        className="mascot-play-button"
        type="button"
        aria-label={taps.split ? "已變成兩隻熊熊滾" : "戳戳熊熊滾，連續戳六下會變成兩隻"}
        disabled={taps.split}
        onClick={poke}
      >
        <svg className="mascot mascot-play-figure" width={size} height={size} viewBox={bust && !taps.split ? "24 16 192 192" : "0 0 240 240"} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <g className="mascot-play-single">
            <g className="mascot-play-nudge" key={taps.count}>
              <g className={`mascot mascot-${state}`}>
                {!bust && <Shadow />}
                <MascotFigure state={state} props={!bust} look={look} />
              </g>
            </g>
          </g>
          {taps.split && (
            <>
              <g className="mascot-play-particles" fill="#EADBFD">
                {Array.from({ length: 8 }, (_, index) => <circle key={index} className="mascot-play-puff" data-n={index} cx="120" cy="136" r={index % 2 ? 10 : 15} />)}
              </g>
              <g className="mascot-play-twin mascot-play-twin-l">
                <g transform="translate(8 94) scale(.56)" className="mascot mascot-hi"><Shadow /><MascotFigure state="hi" props={false} look={look} /></g>
              </g>
              <g className="mascot-play-twin mascot-play-twin-r">
                <g transform="translate(98 94) scale(.56)" className="mascot mascot-idle"><Shadow /><MascotFigure state="idle" props={false} look={{ ...look, color: found?.color_id ?? look.color }} /></g>
                {found && found.color_id !== "classic" && <g fill="#FFC93C"><path d="M207 112 L211 122 L221 126 L211 130 L207 140 L203 130 L193 126 L203 122 Z" /><circle cx="178" cy="106" r="4" /></g>}
              </g>
            </>
          )}
        </svg>
      </button>
      {(pending || found || taps.count >= 4 || taps.split) && <span className="mascot-play-message" role="status">
        {pending ? "看看遇到哪隻熊熊…" : found && found.color_id !== "classic" ? `${found.newly_collected ? "新收藏！" : "又遇到"}${mascotPalette(found.color_id).name}` : taps.split ? "噗！變成兩隻了。" : "熊熊滾快忍不住了…"}
      </span>}
      {error && <><span role="alert" className="mascot-play-message">{error}</span><button className="mascot-play-reset" type="button" disabled={pending} onClick={() => void discover()}>重新確認收藏</button></>}
      {taps.split && <button className="mascot-play-reset" type="button" disabled={pending} onClick={() => { setTaps(EMPTY_MASCOT_TAPS); setFound(null); setError(null) }}>合回一隻</button>}
    </div>
  )
}

function Shadow() {
  return <ellipse className="mascot-shadow" cx="120" cy="222" rx="60" ry="7" fill="#2B1B47" opacity=".13" />
}

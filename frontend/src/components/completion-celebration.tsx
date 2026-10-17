import { useEffect, useSyncExternalStore, type CSSProperties } from "react"
import { createPortal } from "react-dom"

import { MascotFigure } from "@/components/mascot"
import type { MascotLook } from "@/lib/mascot-collection"
import {
  COMPLETION_CELEBRATION_MS,
  completionCelebration,
  dismissCompletion,
} from "@/lib/completion-celebration"

import "./completion-celebration.css"

const SPARKS = [
  [-100, -108, -24, 0], [104, -118, 18, 60], [-126, -52, 12, 100],
  [124, -50, -16, 20], [-48, -156, 32, 140], [58, -158, -24, 180],
  [-102, 8, 20, 80], [108, 6, -12, 120],
]

/** Mounted above the routes so navigation never interrupts or blocks the celebration. */
export function CompletionCelebrationHost({ look }: { look?: MascotLook }) {
  const event = useSyncExternalStore(completionCelebration.subscribe, completionCelebration.getSnapshot)

  useEffect(() => {
    if (!event) return
    const timer = window.setTimeout(() => dismissCompletion(event.id), COMPLETION_CELEBRATION_MS)
    return () => window.clearTimeout(timer)
  }, [event])

  // Also clear on sign-out, when the authenticated host unmounts.
  useEffect(() => () => {
    const pending = completionCelebration.getSnapshot()
    if (pending) dismissCompletion(pending.id)
  }, [])

  return createPortal(
    <div className="completion-celebration-host" role="status" aria-live="polite" aria-atomic="true">
      {event && <CompletionCelebration key={event.id} message={event.message} look={look} />}
    </div>,
    document.body,
  )
}

export function CompletionCelebration({ message, look, duration = COMPLETION_CELEBRATION_MS, pausedAt }: { message: string; look?: MascotLook; duration?: number; pausedAt?: number }) {
  return <div className="completion-celebration" data-paused={pausedAt !== undefined} style={{
    "--celebration-duration": `${duration}ms`,
    "--celebration-delay": `${-(pausedAt ?? 0) * duration}ms`,
    "--celebration-speed": duration / COMPLETION_CELEBRATION_MS,
  } as CSSProperties}>
    <div className="completion-flight-stage" aria-hidden="true">
      <span className="completion-flight-halo" />
      <span className="completion-flight-shadow" />
      <span className="completion-flight-ring" />
      {SPARKS.map(([x, y, turn, delay], index) => <span key={index} className="completion-flight-spark" style={{
        "--spark-x": `${x}px`, "--spark-y": `${y}px`, "--spark-turn": `${turn}deg`, "--spark-delay": `${delay}ms`,
      } as CSSProperties}>✦</span>)}
      <div className="completion-flight-lift">
        <span className="completion-flight-heart" data-side="left">♥</span>
        <span className="completion-flight-heart" data-side="right">♥</span>
        <svg className="completion-flight-streaks" viewBox="0 0 160 180" fill="none">
          <path d="M55 140 L48 166 M80 148 L75 178 M105 138 L100 159" />
        </svg>
        <svg className="completion-flight-bear mascot" viewBox="0 0 240 240" width="160" height="160">
          <MascotFigure state="yay" props={false} look={look} />
          <g className="completion-flight-blush" fill="#ff8fb3" opacity=".68">
            <ellipse cx="82" cy="133" rx="9" ry="5" />
            <ellipse cx="158" cy="133" rx="9" ry="5" />
          </g>
        </svg>
      </div>
    </div>
    <div className="completion-flight-message">
      <span className="completion-flight-check" aria-hidden="true">✓</span>
      <span><strong>{message}</strong><span>熊熊滾為你開心到飛起來！</span></span>
    </div>
  </div>
}

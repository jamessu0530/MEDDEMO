import type { CSSProperties } from "react"

import { ASSISTANT_TRANSITION_MS, type AssistantTransitionAction } from "@/ask/use-assistant-transition"
import { MascotFigure } from "@/components/mascot"
import type { AssistantAchievementUnlock, MascotLook } from "@/lib/mascot-collection"

import "./assistant-mode-transition.css"

type Props = {
  action: AssistantTransitionAction
  unlock?: AssistantAchievementUnlock
  failed?: boolean
  look?: MascotLook
  duration?: number
  pausedAt?: number
  compact?: boolean
  heading?: string
}

/** Plays above the card or within its header, without capturing input or covering history. */
export function AssistantModeTransition({ action, unlock, failed, look, duration = ASSISTANT_TRANSITION_MS, pausedAt, compact = false, heading }: Props) {
  const ghost = action === "ghost"
  const earned = unlock?.newly_unlocked
  return <div className="assistant-mode-transition" data-action={action} data-layout={compact ? "compact" : "full"} data-paused={pausedAt !== undefined} style={{
    "--mode-duration": `${duration}ms`,
    "--mode-delay": `${-(pausedAt ?? 0) * duration}ms`,
  } as CSSProperties}>
    {compact && !earned && !failed && <span className="assistant-mode-compact-heading">{heading}</span>}
    {(earned || failed) && <div className="assistant-mode-announcement" role="status" aria-live="polite" aria-atomic="true">
      <span className="assistant-mode-emblem" aria-hidden="true">{earned ? "✦" : ghost ? "◌" : "✧"}</span>
      <span><span className="assistant-mode-eyebrow">{earned ? "新成就解鎖" : "成就尚未保存"}</span><strong>{earned ? unlock.achievement.title : "下次滑動會再試。"}</strong></span>
      {earned && <span className="assistant-mode-medal" aria-hidden="true">★</span>}
    </div>}
    <div className="assistant-mode-stage" aria-hidden="true">
      <span className="assistant-mode-floor" />
      <div className="assistant-mode-runner assistant-mode-single">
        <div className="assistant-mode-actor"><span className="assistant-mode-shadow" /><div className="assistant-mode-roll"><ModeBear ghost={ghost} look={look} /></div></div>
      </div>
      {!ghost && <>
        <div className="assistant-mode-smoke">
          {Array.from({ length: 7 }, (_, index) => <span key={index} style={{ "--puff": index, "--puff-x": `${Math.cos(index * Math.PI * 2 / 7) * 76}px`, "--puff-y": `${Math.sin(index * Math.PI * 2 / 7) * 46}px` } as CSSProperties} />)}
          <b>噗！</b>
        </div>
        <div className="assistant-mode-runner assistant-mode-twin" data-side="left"><div className="assistant-mode-actor"><span className="assistant-mode-shadow" /><ModeBear look={look} /></div></div>
        <div className="assistant-mode-runner assistant-mode-twin" data-side="right"><div className="assistant-mode-actor"><span className="assistant-mode-shadow" /><ModeBear look={look} /></div></div>
      </>}
      <div className="assistant-mode-dust">{[0, 1, 2].map((index) => <span key={index} style={{ "--dust": index } as CSSProperties} />)}</div>
      <span className="assistant-mode-spark" data-side="left">✦</span><span className="assistant-mode-spark" data-side="right">✧</span>
    </div>
  </div>
}

function ModeBear({ ghost = false, look }: { ghost?: boolean; look?: MascotLook }) {
  return <svg className="mascot assistant-mode-bear" viewBox="0 0 240 240" width="132" height="132" xmlns="http://www.w3.org/2000/svg">
    <g className="assistant-mode-stride">
      <MascotFigure state="hi" props={false} look={look} />
      {ghost && <g className="assistant-mode-mask">
        <path d="M70 112 Q120 93 170 112" fill="none" stroke="#6b3ba5" strokeWidth="5" />
        <path d="M77 118 V110 C77 82 95 73 120 73 C145 73 163 82 163 110 V150 Q153 142 145 154 Q132 143 120 155 Q108 143 95 154 Q86 143 77 150 Z" fill="#fffaf3" stroke="#d8c5f1" strokeWidth="2.5" strokeLinejoin="round" />
        <ellipse cx="102" cy="111" rx="7" ry="10" fill="#38214f" transform="rotate(10 102 111)" />
        <ellipse cx="138" cy="111" rx="7" ry="10" fill="#38214f" transform="rotate(-10 138 111)" />
        <ellipse cx="120" cy="133" rx="5" ry="7" fill="#38214f" />
        <ellipse cx="89" cy="128" rx="6" ry="3" fill="#f5b6cf" /><ellipse cx="151" cy="128" rx="6" ry="3" fill="#f5b6cf" />
        <path d="M112 84 Q120 80 128 84" fill="none" stroke="#e8dafa" strokeWidth="3" strokeLinecap="round" />
      </g>}
    </g>
  </svg>
}

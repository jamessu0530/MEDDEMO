import "./mascot.css"

import type { MascotState } from "@/lib/mascot"
import { cn } from "@/lib/utils"

/**
 * 吉祥物「熊熊滾」（docs/superpowers/specs/2026-09-30-mascot-design.md）。
 * 一隻紫色、站著的小熊，AI 在聽、在想、在回答、在處理的時候，用牠的動作告訴使用者。
 * 形狀只有七個、顏色三個，不描邊也沒有漸層；沒有手，每個狀態靠身體、耳朵、眼睛和嘴表現。
 * 動畫在 mascot.css，每個狀態一組；狀態的清單在 lib/mascot.ts。
 */
type Eyes = "open" | "up" | "happy"
type Mouth = "smile" | "hmm" | "open"

const BASE = "#9B51E0"
const LIGHT = "#EADBFD"
const INK = "#2B1B47"
const TONGUE = "#FF8FB3"
// 泡泡、聲波、等待的三顆點
const PROP = "#C9A2F5"
// 整隻熊唯一用到紫色以外的顏色：完成時彈出來的星星
const STAR = "#FFC93C"

const FACE: Record<MascotState, [Eyes, Mouth]> = {
  idle: ["open", "smile"],
  hi: ["happy", "open"],
  listen: ["open", "smile"],
  think: ["up", "hmm"],
  talk: ["open", "open"],
  wait: ["open", "smile"],
  yay: ["happy", "open"],
  ride: ["happy", "open"],
}

type MascotProps = {
  state?: MascotState
  /** 邊長（px） */
  size?: number
  /** 半身特寫：頭到肩膀，給頭像用，不畫影子和道具 */
  bust?: boolean
  /** 旁邊沒有文字說明狀態時才給：有給就讓讀屏唸，沒給就是裝飾 */
  label?: string
  className?: string
}

export function Mascot({ state = "idle", size = 96, bust = false, label, className }: MascotProps) {
  return (
    <svg
      className={cn("mascot", `mascot-${state}`, className)}
      viewBox={bust ? "24 16 192 192" : "0 0 240 240"}
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {!bust && <ellipse className="mascot-shadow" cx="120" cy="222" rx="60" ry="7" fill={INK} opacity=".13" />}
      <MascotFigure state={state} props={!bust} />
    </svg>
  )
}

/**
 * 熊熊滾本身：身體、耳朵、臉，加上這個狀態的道具（props），畫布座標 0 0 240 240，不含影子。
 * 座騎（components/rides/ride.tsx）把它疊進自己的 svg。狀態的動畫掛在外層的 .mascot-<state> 上，
 * 疊到別處時外面要包一層 <g className={`mascot mascot-${state}`}>。
 */
export function MascotFigure({ state = "idle", props = true }: { state?: MascotState; props?: boolean }) {
  const [eyes, mouth] = FACE[state]
  return (
    <g className="mascot-all">
      <g className="mascot-body">
        <Ear side="l" x={80} />
        <Ear side="r" x={160} />
        {/* 頭和身體是同一個形狀，底下分出兩條短腿 */}
        <path
          d="M56 118 C56 80 84 56 120 56 C156 56 184 80 184 118 V188 C184 204 173 215 159 215 C147 215 139 209 135 200 H105 C101 209 93 215 81 215 C67 215 56 204 56 188 Z"
          fill={BASE}
        />
        <g transform="translate(120 120)">
          <g className="mascot-face">
            <g className="mascot-eyes" data-eyes={eyes}>
              <EyesShape kind={eyes} />
            </g>
            <ellipse cx="0" cy="9" rx="24" ry="17" fill={LIGHT} />
            <path d="M-9 0 Q0 -4 9 0 Q10.5 5 0 10 Q-10.5 5 -9 0 Z" fill={INK} />
            <g data-mouth={mouth}>
              <MouthShape kind={mouth} />
            </g>
          </g>
        </g>
      </g>
      {props && <Props state={state} />}
    </g>
  )
}

function Ear({ side, x }: { side: "l" | "r"; x: number }) {
  return (
    <g className={`mascot-ear-${side}`}>
      <circle cx={x} cy="62" r="22" fill={BASE} />
      <circle cx={x} cy="62" r="10.5" fill={LIGHT} />
    </g>
  )
}

// 每隻眼睛：[眼睛中心 x, y, 反光 x, y]。往右上看時整顆連反光一起移
const EYE_AT: Record<"open" | "up", [number, number, number, number][]> = {
  open: [
    [-29, -12, -26.4, -15.6],
    [29, -12, 31.6, -15.6],
  ],
  up: [
    [-26, -16, -22.6, -20.4],
    [32, -16, 35.4, -20.4],
  ],
}

function EyesShape({ kind }: { kind: Eyes }) {
  if (kind === "happy") {
    // 笑到瞇起來
    return (
      <>
        <path d="M-38 -8 Q-29 -22 -20 -8" fill="none" stroke={INK} strokeWidth="4.8" strokeLinecap="round" />
        <path d="M20 -8 Q29 -22 38 -8" fill="none" stroke={INK} strokeWidth="4.8" strokeLinecap="round" />
      </>
    )
  }
  return (
    <>
      {EYE_AT[kind].map(([x, y]) => (
        <ellipse key={x} cx={x} cy={y} rx="7.6" ry="9.6" fill={INK} />
      ))}
      {EYE_AT[kind].map(([, , x, y]) => (
        <circle key={x} cx={x} cy={y} r="2.7" fill="#fff" />
      ))}
    </>
  )
}

function MouthShape({ kind }: { kind: Mouth }) {
  if (kind === "open") {
    // 開合的動畫掛在這一組上（回答的時候）
    return (
      <g className="mascot-mouth">
        <path d="M-8.5 12 Q0 9.5 8.5 12 Q8 24 0 24 Q-8 24 -8.5 12 Z" fill={INK} />
        <path d="M-4.6 20 Q0 16.4 4.6 20 Q2.6 24 0 24 Q-2.6 24 -4.6 20 Z" fill={TONGUE} />
      </g>
    )
  }
  if (kind === "hmm") {
    return (
      <>
        <path d="M0 9 V12" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
        <ellipse cx="3.5" cy="17" rx="3.4" ry="3" fill={INK} />
      </>
    )
  }
  return (
    <path
      d="M0 9 V12.5 M-7 13.5 Q-3.5 18.5 0 13.5 Q3.5 18.5 7 13.5"
      fill="none"
      stroke={INK}
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

/** 圓角的四角星：中心 (x, y)，半徑 r */
function starPath(x: number, y: number, r: number) {
  return `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`
}

/** 各狀態的道具：聲波、想法泡泡、等待的點、星星。data-n 是第幾個，動畫照順序錯開 */
function Props({ state }: { state: MascotState }) {
  if (state === "listen") {
    return (
      <>
        <path className="mascot-wave" data-n="1" d="M206 46 q9 12 0 24" fill="none" stroke={PROP} strokeWidth="5" strokeLinecap="round" />
        <path className="mascot-wave" data-n="2" d="M218 38 q14 20 0 40" fill="none" stroke={PROP} strokeWidth="5" strokeLinecap="round" />
      </>
    )
  }
  if (state === "think") {
    return (
      <>
        <circle className="mascot-dot" data-n="1" cx="186" cy="44" r="6" fill={PROP} />
        <circle className="mascot-dot" data-n="2" cx="203" cy="28" r="8" fill={PROP} />
        <circle className="mascot-dot" data-n="3" cx="223" cy="14" r="10" fill={PROP} />
      </>
    )
  }
  if (state === "wait") {
    return (
      <>
        <circle className="mascot-load" data-n="1" cx="94" cy="20" r="9" fill={PROP} />
        <circle className="mascot-load" data-n="2" cx="120" cy="20" r="9" fill={PROP} />
        <circle className="mascot-load" data-n="3" cx="146" cy="20" r="9" fill={PROP} />
      </>
    )
  }
  if (state === "yay") {
    return (
      <>
        <path className="mascot-star" data-n="1" d={starPath(28, 50, 20)} fill={STAR} />
        <path className="mascot-star" data-n="2" d={starPath(214, 36, 16)} fill={STAR} />
        <path className="mascot-star" data-n="3" d={starPath(222, 110, 11)} fill={STAR} />
        <path className="mascot-star" data-n="4" d={starPath(20, 122, 10)} fill={STAR} />
      </>
    )
  }
  return null
}

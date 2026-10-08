import "./ride-on-route.css"

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties } from "react"

import { Ride } from "@/components/rides/ride"
import { PROP } from "@/components/rides/vehicles/colors"
import { ink } from "@/ink/ink"
import {
  GROUND,
  legPoints,
  PARK_GAP,
  parkFlipped,
  parkHeight,
  parkSide,
  parkTop,
  parkWidth,
  rideKeyframes,
  shouldFlip,
  timeline,
  type LegPoints,
} from "@/lib/ride-on-route"
import { HALF_NODE } from "@/lib/route-path"
import { crossesCity, legKey, rideCity, SPECIALTY, type Leg } from "@/lib/rides"
import { TRAVEL_MODE_LABEL } from "@/lib/travel-mode"
import { cn } from "@/lib/utils"

// 下一站捲進畫面之後，等這麼久才開始騎（平滑捲動差不多停了）
const SETTLE_MS = 400

// 跨縣市的那團煙：幾個圓，中心離座騎框中心多遠、直徑多大（都是座騎寬的幾倍）；最濃時蓋住整台座騎，換車才看不出來
const PUFFS = [
  { x: 0, y: -0.12, size: 0.5 },
  { x: -0.26, y: 0.02, size: 0.42 },
  { x: 0.26, y: 0.02, size: 0.42 },
  { x: -0.13, y: 0.16, size: 0.38 },
  { x: 0.14, y: 0.17, size: 0.36 },
  { x: 0, y: 0.04, size: 0.48 },
]

// 煙：很快冒大、正中間最濃（換車的那一刻），再慢慢散開淡掉。緩動寫在每一格上，整段的時間不變形，最濃的那一刻才不會偏掉
const PUFF_FRAMES: Keyframe[] = [
  { transform: "scale(0.2)", opacity: 0, easing: "ease-out" },
  { transform: "scale(1)", opacity: 1, offset: 0.5, easing: "ease-in" },
  { transform: "scale(1.35)", opacity: 0 },
]

// 頭上的縣市名：彈出來、停一下、往上淡掉
const TAG_FRAMES: Keyframe[] = [
  { transform: "translateY(6px) scale(0.7)", opacity: 0 },
  { transform: "translateY(0) scale(1.08)", opacity: 1, offset: 0.15 },
  { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.25 },
  { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.8 },
  { transform: "translateY(-4px) scale(1)", opacity: 0 },
]

/** 正在騎的這一段：怎麼走、半路要不要轉頭（往行進方向看，跟停著時面向圓鈕的方向不一樣）、跨不跨縣市 */
type Riding = LegPoints & { turn: boolean; cross: boolean }

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * 量這一段在畫面上怎麼走。靠 components/route-path.tsx 的結構：按鈕放在這一站那一列（relative）裡，
 * 那一列的前一個是放膠囊的那一列，上一站的圓鈕在前一個 <li>。量不到（ref 還沒掛上、還沒排版、被藏起來）回 null，不播。
 */
function measure(button: HTMLElement, offset: number, fromOffset: number | null, containerWidth: number): LegPoints | null {
  const row = button.parentElement
  const legRow = row?.previousElementSibling
  const node = row?.querySelector("[data-stop-node]")
  if (!row || !legRow || !node) return null
  let prev: { node: DOMRect; offset: number } | null = null
  if (fromOffset !== null) {
    const prevNode = row.parentElement?.previousElementSibling?.querySelector("[data-stop-node]")
    if (!prevNode) return null
    prev = { node: prevNode.getBoundingClientRect(), offset: fromOffset }
  }
  const box = button.getBoundingClientRect()
  const nodeBox = node.getBoundingClientRect()
  const legBox = legRow.getBoundingClientRect()
  if ([box, nodeBox, legBox, prev?.node].some((rect) => rect && (rect.width === 0 || rect.height === 0))) return null
  return legPoints({
    end: { x: box.left + box.width / 2, y: box.top + box.height * GROUND },
    node: nodeBox,
    legRow: legBox,
    prev,
    offset,
    containerWidth,
  })
}

/**
 * 熊熊滾騎著「到下一站那一段」的座騎（目的地縣市 × 那一段的交通方式），停在下一站圓鈕沒有名字的那一側、
 * 面向圓鈕、離圓鈕 10px，地面線對齊圓鈕底邊，慢慢上下浮。放在下一站那一列（relative）裡，
 * offset 是那顆圓鈕離中線多少 px，fromOffset 是上一站的（從辦公室出發是 null），containerWidth 是整條路線的寬。
 *
 * 騎乘動畫（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈動畫〉）：autoPlay 時（首頁決定）等換頁的墨退掉、
 * 把這一列捲到畫面中間、等一下，再從上一站停的地方沿蛇行的彎度騎過來；點停著的座騎重播。同一時間只播一段，播的時候再點不理。
 * 動的就是停著的這顆按鈕本身（Web Animations API，transform-origin 是著地點），播完回到原位，不會有兩隻熊。
 * 左右翻做在包住座騎的那一層、跨縣市換車是兩台疊著換 opacity，都不碰座騎的 SVG（它的位置與翻面是 SVG 的 transform 屬性）。
 * 一開始騎就呼叫 onRide（記播過、送騎過的座騎）；減少動態效果、量不到位置時不動，直接停在這裡，onRide 照叫。
 */
export function RideOnRoute({
  leg,
  offset,
  fromOffset = null,
  containerWidth,
  autoPlay = false,
  onRide,
}: {
  leg: Leg
  offset: number
  fromOffset?: number | null
  containerWidth: number
  /** 現在自動騎一次這一段（首頁決定：路線分頁、連得上、不在存檔中、今天還沒播過） */
  autoPlay?: boolean
  /** 開始騎這一段（自動播、點了重播；減少動態效果或量不到位置而直接停好也算） */
  onRide?: (leg: Leg) => void
}) {
  const width = parkWidth(offset, containerWidth)
  const flipped = parkFlipped(offset)
  const key = legKey(leg)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const faceRef = useRef<HTMLSpanElement>(null)
  const toRef = useRef<HTMLSpanElement>(null)
  const fromRef = useRef<HTMLSpanElement>(null)
  const puffRef = useRef<HTMLSpanElement>(null)
  const tagRef = useRef<HTMLSpanElement>(null)
  // 正在播（含剛決定要播、還沒畫出來）：再觸發就不理
  const playing = useRef(false)
  const [riding, setRiding] = useState<Riding | null>(null)
  // 這次掛上之後已經開始騎過（或直接停好）的那一段
  const [started, setStarted] = useState<string | null>(null)
  // 要自動騎、還沒開始：先藏起來，等一下從上一站冒出來（減少動態效果時不藏，直接停在這裡）
  const waiting = autoPlay && started !== key && riding === null

  function begin() {
    if (playing.current) return
    onRide?.(leg)
    setStarted(key)
    const button = buttonRef.current
    if (!button || reducedMotion()) return
    const points = measure(button, offset, fromOffset, containerWidth)
    if (!points) return
    playing.current = true
    setRiding({ ...points, turn: shouldFlip(points.from, points.to) !== flipped, cross: crossesCity(leg) })
  }

  // 自動播：等墨退掉、把這一列捲到畫面中間、等捲動停了再騎。條件不成立（切到地圖、開始存檔）或換了一段就不等了
  const autoBegin = useEffectEvent(() => begin())
  useEffect(() => {
    if (!autoPlay) return
    let timer: number | undefined
    let unsubscribe = () => {}
    const go = () => {
      const reduce = reducedMotion()
      buttonRef.current?.parentElement?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" })
      timer = window.setTimeout(() => autoBegin(), reduce ? 0 : SETTLE_MS)
    }
    if (ink.phase() === "idle") go()
    else
      unsubscribe = ink.subscribe(() => {
        if (ink.phase() !== "idle") return
        unsubscribe()
        go()
      })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [autoPlay, key])

  // 開始騎：畫面換成騎的樣子之後、畫出來之前掛上動畫；播完回到停著的樣子。離開首頁、切到地圖（元件拆掉）就取消，不留殘影
  useLayoutEffect(() => {
    const button = buttonRef.current
    if (!riding || !button) return
    // 開發模式的 StrictMode 會先拆再掛一次：拆的時候放掉了，這裡再鎖回來
    playing.current = true
    const t = timeline(riding.cross)
    const timing = { duration: t.total }
    const animations = [button.animate(rideKeyframes(riding, t), timing)]
    // 一路往行進方向看，到站壓扁的那一刻才轉回來面向圓鈕
    if (riding.turn && faceRef.current)
      animations.push(
        faceRef.current.animate(
          [{ transform: "scaleX(-1)", easing: "step-end" }, { transform: "scaleX(1)", offset: t.moveEnd / t.total }, { transform: "scaleX(1)" }],
          timing
        )
      )
    if (t.swap !== null && t.puff && t.tag) {
      // 煙最濃的那一刻換車：出發縣市那台藏起來、目的地縣市那台出來
      const swap = t.swap / t.total
      if (fromRef.current)
        animations.push(fromRef.current.animate([{ opacity: 1, easing: "step-end" }, { opacity: 0, offset: swap }, { opacity: 0 }], timing))
      if (toRef.current)
        animations.push(toRef.current.animate([{ opacity: 0, easing: "step-end" }, { opacity: 1, offset: swap }, { opacity: 1 }], timing))
      for (const puff of Array.from(puffRef.current?.children ?? []))
        animations.push(puff.animate(PUFF_FRAMES, { delay: t.puff.start, duration: t.puff.end - t.puff.start, fill: "both" }))
      if (tagRef.current)
        animations.push(tagRef.current.animate(TAG_FRAMES, { delay: t.tag.start, duration: t.tag.end - t.tag.start, fill: "both" }))
    }
    animations[0].finished.then(
      () => {
        playing.current = false
        setRiding(null)
      },
      // 被取消（拆掉、離開首頁）：不用做什麼
      () => {}
    )
    return () => {
      for (const animation of animations) animation.cancel()
      playing.current = false
    }
  }, [riding])

  // 離中線多遠：圓鈕半寬再加 10px
  const reach = HALF_NODE + PARK_GAP
  const height = parkHeight(width)
  const style: CSSProperties = {
    top: parkTop(width),
    width,
    height,
    transformOrigin: `50% ${GROUND * 100}%`,
    // 停左邊：右緣在圓鈕左緣前 10px；停右邊：左緣在圓鈕右緣後 10px
    ...(parkSide(offset) === "left" ? { right: `calc(50% + ${reach - offset}px)` } : { left: `calc(50% + ${offset + reach}px)` }),
  }
  const city = rideCity(leg.toCity)
  const label = city ? `熊熊滾騎著${SPECIALTY[city]}的${TRAVEL_MODE_LABEL[leg.mode]}` : "熊熊滾正走去下一站"
  return (
    <button
      ref={buttonRef}
      type="button"
      data-ride-park
      aria-label={`${label}，點一下重播這一段`}
      onClick={begin}
      className={cn(
        "absolute rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        waiting && "motion-safe:pointer-events-none motion-safe:opacity-0"
      )}
      style={style}
    >
      {/* 停著時慢慢上下浮；騎的時候不浮（外層在動） */}
      <span className={cn("block", !riding && "ride-park-float")}>
        <span ref={faceRef} className="relative block">
          <span ref={toRef} className="block">
            <Ride city={leg.toCity} mode={leg.mode} size={width} flipped={flipped} still={!riding} />
          </span>
          {riding?.cross && leg.fromCity && (
            <span ref={fromRef} className="absolute inset-0 opacity-0">
              <Ride city={leg.fromCity} mode={leg.mode} size={width} flipped={flipped} />
            </span>
          )}
        </span>
      </span>
      {riding?.cross && (
        <>
          <span ref={puffRef} data-ride-puff aria-hidden className="pointer-events-none absolute inset-0">
            {PUFFS.map((puff, i) => {
              const size = puff.size * width
              return (
                <span
                  key={i}
                  className="absolute rounded-full opacity-0"
                  style={{
                    left: width * (0.5 + puff.x) - size / 2,
                    top: height * 0.55 + puff.y * width - size / 2,
                    width: size,
                    height: size,
                    backgroundColor: PROP,
                  }}
                />
              )
            })}
          </span>
          <span data-ride-tag aria-hidden className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center">
            <span
              ref={tagRef}
              className="origin-bottom rounded-lg border-2 bg-card px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-primary opacity-0"
            >
              {leg.toCity}
            </span>
          </span>
        </>
      )}
    </button>
  )
}

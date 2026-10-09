import "./ride-on-route.css"

import { useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties } from "react"

import { Ride } from "@/components/rides/ride"
import { PROP } from "@/components/rides/vehicles/colors"
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
import { anchorId, crossesCity, rideCity, SPECIALTY, type Leg } from "@/lib/rides"
import { TRAVEL_MODE_LABEL } from "@/lib/travel-mode"
import { cn } from "@/lib/utils"

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
 * 量這一段在畫面上怎麼走。靠 components/route-path.tsx 的結構：按鈕放在熊停的那一列（relative）裡，那一列有一顆
 * data-ride-anchor 的圓鈕；出發的那一站在同一條路線（<ol>）裡用 data-ride-anchor 找，離中線多少寫在它的 data-offset。
 * 出發那一站就在上一個 <li> 裡（相鄰往下）時，經過這一列前面放膠囊的那一列。量不到（還沒排版、被藏起來）回 null，不騎。
 */
function measure(button: HTMLElement, offset: number, leg: Leg, containerWidth: number): LegPoints | null {
  const row = button.parentElement
  const node = row?.querySelector("[data-ride-anchor]")
  const prevNode = button.closest("ol")?.querySelector(`[data-ride-anchor="${anchorId(leg.from)}"]`)
  if (!row || !node || !(prevNode instanceof HTMLElement)) return null
  const adjacent = row.closest("li")?.previousElementSibling?.contains(prevNode) ?? false
  const legRow = adjacent ? row.previousElementSibling : null
  const box = button.getBoundingClientRect()
  const nodeBox = node.getBoundingClientRect()
  const prevBox = prevNode.getBoundingClientRect()
  const legBox = legRow?.getBoundingClientRect() ?? null
  if ([box, nodeBox, prevBox, legBox].some((rect) => rect && (rect.width === 0 || rect.height === 0))) return null
  return legPoints({
    end: { x: box.left + box.width / 2, y: box.top + box.height * GROUND },
    node: nodeBox,
    legRow: legBox,
    prev: { node: prevBox, offset: Number(prevNode.dataset.offset ?? 0) },
    offset,
    containerWidth,
  })
}

/**
 * 熊熊滾騎著座騎（目的地縣市 × 那一段的交通方式）停在熊現在那一站（或辦公室）的圓鈕旁邊：沒有名字的那一側、面向圓鈕、
 * 離圓鈕 10px，地面線對齊圓鈕底邊，慢慢上下浮。放在那一列（relative）裡，offset 是那顆圓鈕離中線多少 px，
 * containerWidth 是整條路線的寬。
 *
 * 點站就騎（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈首頁〉）：首頁點了一站，熊換到那一列、
 * play 換一個新的值，畫出來之前就從原本停的那一站（leg.from）騎過來；點停著的座騎重播這一段（canReplay 時）。
 * 同一時間只播一段，播的時候再點不理。動的就是停著的這顆按鈕本身（Web Animations API，transform-origin 是著地點），
 * 播完回到原位，不會有兩隻熊；騎到一半熊換到別站，這一顆拆掉、動畫取消，新的那一顆從這一站騎出去。
 * 左右翻做在包住座騎的那一層、跨縣市換車是兩台疊著換 opacity，都不碰座騎的 SVG。
 * 一開始騎就呼叫 onRide（送騎過的座騎），騎完（或減少動態效果、量不到位置而直接停好）呼叫 onEnd。
 */
export function RideOnRoute({
  leg,
  offset,
  containerWidth,
  play = null,
  canReplay = true,
  onRide,
  onEnd,
}: {
  leg: Leg
  offset: number
  containerWidth: number
  /** 換一個新的值就騎一次這一段（首頁點站時給；null 是停著） */
  play?: number | null
  /** 停在辦公室時沒有「上一段」可以重播 */
  canReplay?: boolean
  onRide?: (leg: Leg) => void
  onEnd?: () => void
}) {
  const width = parkWidth(offset, containerWidth)
  const flipped = parkFlipped(offset)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const faceRef = useRef<HTMLSpanElement>(null)
  const toRef = useRef<HTMLSpanElement>(null)
  const fromRef = useRef<HTMLSpanElement>(null)
  const puffRef = useRef<HTMLSpanElement>(null)
  const tagRef = useRef<HTMLSpanElement>(null)
  // 正在播（含剛決定要播、還沒畫出來）：再觸發就不理
  const playing = useRef(false)
  const [riding, setRiding] = useState<Riding | null>(null)

  function begin() {
    if (playing.current) return
    onRide?.(leg)
    const button = buttonRef.current
    if (!button || reducedMotion()) return onEnd?.()
    const points = measure(button, offset, leg, containerWidth)
    if (!points) return onEnd?.()
    playing.current = true
    setRiding({ ...points, turn: shouldFlip(points.from, points.to) !== flipped, cross: crossesCity(leg) })
  }

  // 首頁點了站：畫出來之前就開始騎（layout effect），不會先在終點閃一下
  const playNow = useEffectEvent(() => begin())
  useLayoutEffect(() => {
    if (play !== null) playNow()
  }, [play])

  const ended = useEffectEvent(() => onEnd?.())
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
        ended()
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
  const label = city ? `熊熊滾騎著${SPECIALTY[city]}的${TRAVEL_MODE_LABEL[leg.mode]}` : "熊熊滾走過去"
  return (
    <button
      ref={buttonRef}
      type="button"
      data-ride-park
      aria-label={canReplay ? `${label}，點一下重播這一段` : label}
      onClick={canReplay ? begin : undefined}
      className="absolute rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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

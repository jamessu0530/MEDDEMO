import "./ride-on-route.css"

import type { CSSProperties, Ref } from "react"

import { Ride } from "@/components/rides/ride"
import { GROUND, PARK_GAP, parkFlipped, parkHeight, parkSide, parkTop, parkWidth } from "@/lib/ride-on-route"
import { HALF_NODE } from "@/lib/route-path"
import { rideCity, SPECIALTY, type Leg } from "@/lib/rides"
import { TRAVEL_MODE_LABEL } from "@/lib/travel-mode"

/**
 * 熊熊滾騎著「到下一站那一段」的座騎（目的地縣市 × 那一段的交通方式），停在下一站圓鈕沒有名字的那一側、
 * 面向圓鈕、離圓鈕 10px，地面線對齊圓鈕底邊，慢慢上下浮；點了重播這一段（onReplay）。
 * 放在下一站那一列（relative）裡，offset 是那顆圓鈕離中線多少 px，containerWidth 是整條路線的寬。
 *
 * 外層按鈕（data-ride-park，ref 也掛在這裡）留給騎乘動畫用 Web Animations API 移動，transform-origin 是著地點；
 * 上下浮做在裡面那一層，兩個 transform 才不會互相蓋掉。
 */
export function RideOnRoute({
  leg,
  offset,
  containerWidth,
  onReplay,
  ref,
}: {
  leg: Leg
  offset: number
  containerWidth: number
  onReplay?: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  const width = parkWidth(offset, containerWidth)
  // 離中線多遠：圓鈕半寬再加 10px
  const reach = HALF_NODE + PARK_GAP
  const style: CSSProperties = {
    top: parkTop(width),
    width,
    height: parkHeight(width),
    transformOrigin: `50% ${GROUND * 100}%`,
    // 停左邊：右緣在圓鈕左緣前 10px；停右邊：左緣在圓鈕右緣後 10px
    ...(parkSide(offset) === "left" ? { right: `calc(50% + ${reach - offset}px)` } : { left: `calc(50% + ${offset + reach}px)` }),
  }
  const city = rideCity(leg.toCity)
  const riding = city ? `熊熊滾騎著${SPECIALTY[city]}的${TRAVEL_MODE_LABEL[leg.mode]}` : "熊熊滾正走去下一站"
  return (
    <button
      ref={ref}
      type="button"
      data-ride-park
      aria-label={`${riding}，點一下重播這一段`}
      onClick={onReplay}
      className="absolute rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      style={style}
    >
      <span className="ride-park-float block">
        <Ride city={leg.toCity} mode={leg.mode} size={width} flipped={parkFlipped(offset)} still />
      </span>
    </button>
  )
}

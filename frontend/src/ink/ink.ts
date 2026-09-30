import { createInkController } from "@/ink/controller"
import { inkColors, type InkEffect } from "@/ink/effects"
import { readSkin, setSkin, type Skin } from "@/lib/skin"

/** 全 App 共用的那一個：畫布只有一張（components/ink-transition.tsx），同一時間只播一段 */
export const ink = createInkController({
  now: () => performance.now(),
  raf: (callback) => void requestAnimationFrame(callback),
  canAnimate: () => !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  random: Math.random,
  setTimer: (fn, ms) => {
    const id = window.setTimeout(fn, ms)
    return () => window.clearTimeout(id)
  },
})

/**
 * 先讓墨蓋滿畫面，蓋滿的那一刻才做 atSwap，再露出來。
 * 一般的換頁不用叫這個（<InkRoutes> 會自己播）；這是給「做了之後眼前這一頁會馬上不見」的動作用的，
 * 例如登入、登出：先做的話畫面會先空掉，墨蓋上來的是一片空白。不能播的時候 atSwap 馬上做。
 */
export function playInk(effect: InkEffect, atSwap: () => unknown) {
  ink.play({ effect, colors: inkColors(readSkin()), atSwap })
}

/** 換配色：用噴漆把整個畫面從舊配色的顏色染成新的 */
export function changeSkin(next: Skin) {
  const from = readSkin()
  if (from === next) return
  ink.play({ effect: "spray", colors: inkColors(from, next), atSwap: () => setSkin(next) })
}

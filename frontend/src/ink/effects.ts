import type { Skin } from "@/lib/skin"

/** 四種油墨效果：墨暈、噴漆、潑墨、刷痕（著色器在 ink/shaders.ts） */
export type InkEffect = "bleed" | "spray" | "splat" | "brush"

/** 每種效果整段多長（毫秒）：前半蓋滿畫面，後半露出新的畫面。越常發生的換頁越短 */
export const INK_DURATION: Record<InkEffect, number> = {
  bleed: 700,
  brush: 780,
  splat: 950,
  spray: 1400,
}

// 有底部分頁列的那五頁（components/bottom-nav.tsx）
const TABS = new Set(["/", "/customers", "/channels", "/ask", "/promotions"])
// 還沒登入時看得到的頁面；進出這幾頁就是登入、登出
const AUTH = new Set(["/login", "/register", "/auth/github/callback"])

function trim(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
}

/**
 * 從 from 換到 to 要播哪一種：底部分頁之間是墨暈，進出登入那幾頁是潑墨，其餘（進入或返回內頁）是刷痕。
 * 同一頁（只換查詢參數或 state）回 null，不播。噴漆不在這裡，留給設定頁換配色（ink/ink.ts 的 changeSkin）。
 */
export function pickEffect(from: string, to: string): InkEffect | null {
  const a = trim(from)
  const b = trim(to)
  if (a === b) return null
  if (AUTH.has(a) !== AUTH.has(b)) return "splat"
  if (TABS.has(a) && TABS.has(b)) return "bleed"
  return "brush"
}

export type Rgb = readonly [number, number, number]

/** 一段轉場裡墨的顏色：剛落下是 from，久了變成 to；wash 是墨變薄的地方（水痕、刷痕裡的淡筆觸） */
export type InkColors = { from: Rgb; to: Rgb; washFrom: Rgb; washTo: Rgb }

function rgb(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

// 主色跟 index.css 的 --primary 一致；aged 是同一個配色裡墨放久一點的顏色
const INK: Record<Skin, { primary: Rgb; aged: Rgb; wash: Rgb }> = {
  purple: { primary: rgb(0x9b51e0), aged: rgb(0x6a2bbe), wash: rgb(0xc9a2f5) },
  mono: { primary: rgb(0x141414), aged: rgb(0x4a4a48), wash: rgb(0xa8a8a5) },
}

/** 墨的顏色跟著配色；換配色的那一次（to 跟 from 不同）從舊配色的主色染到新配色的主色 */
export function inkColors(from: Skin, to: Skin = from): InkColors {
  return {
    from: INK[from].primary,
    to: from === to ? INK[from].aged : INK[to].primary,
    washFrom: INK[from].wash,
    washTo: INK[to].wash,
  }
}

/*
 * 墨暈的時間表。距離的單位是「起點到最遠角落」＝ 1：前緣在 lead，後緣在 lead - band，中間是墨。
 * 邊緣不是正圓，會被雜訊往前後推；leadWobble、trailWobble 是最多推多遠（起點附近沒有放射的紋路，
 * 後緣只會被推 trailWobbleAtOrigin），thin 是後緣淡成水痕的寬度，dropsAhead 是墨點最多飛在前緣前面多遠。
 * 這幾個數字跟 ink/shaders.ts 墨暈那支裡的係數是一組的，改一邊要改另一邊。
 * start、cover、end 是進度 0、0.5、1 時前緣的位置：0.5 是換頁的那一刻，整個畫面都要蓋得到。
 * band 和 cover 都只比「剛好蓋得滿」多一點點：再大的話，畫面全是墨的時間會變長，看起來像卡住。
 */
export const BLEED = {
  band: 1.5,
  leadWobble: 0.215,
  trailWobble: 0.205,
  trailWobbleAtOrigin: 0.145,
  thin: 0.12,
  dropsAhead: 0.13,
  start: -0.14,
  cover: 1.22,
  end: 2.76,
}

function easeOut(x: number, power: number) {
  return 1 - Math.pow(1 - x, power)
}

/** 進度 t（0～1）時墨暈前緣的位置：滲出去幾乎是等速（蓋滿的那一刻才剛好到 0.5），退掉是先快後慢 */
export function bleedLead(t: number) {
  if (t <= 0.5) return BLEED.start + (BLEED.cover - BLEED.start) * easeOut(t * 2, 1.2)
  return BLEED.cover + (BLEED.end - BLEED.cover) * easeOut(t * 2 - 1, 1.5)
}

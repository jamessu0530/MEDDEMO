import { useSyncExternalStore } from "react"

// 配色：淺色是原本的紫色，深色是黑灰底。首頁的頁首與設定頁都能切換。選了什麼記在這支手機裡，跟帳號無關
export type Skin = "light" | "dark"

const STORAGE_KEY = "meddemo:skin"
const listeners = new Set<() => void>()

function read(): Skin {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    // "mono" 是之前的黑白灰：選過它的人換成深色
    return stored === "dark" || stored === "mono" ? "dark" : "light"
  } catch {
    return "light" // 讀不到（無痕模式）就用原本的淺色
  }
}

let current = read()

/** 掛到 <html data-skin>，index.css 深色那一組顏色靠它生效；淺色是預設，不掛 */
function apply() {
  if (typeof document === "undefined") return
  if (current === "dark") document.documentElement.dataset.skin = "dark"
  else delete document.documentElement.dataset.skin
}

// 一載入就掛：main.tsx 在畫第一個畫面之前就會載到這裡。index.html 裡另有一小段更早就掛，免得先閃一下淺色
apply()

export function readSkin() {
  return current
}

/** 直接換配色。畫面上要帶噴漆動畫的話用 ink/ink.ts 的 changeSkin */
export function setSkin(skin: Skin) {
  if (skin === current) return
  current = skin
  apply()
  try {
    localStorage.setItem(STORAGE_KEY, skin)
  } catch {
    // 存不進去：這次打開照樣換，下次打開回到淺色
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const onSkinChange = subscribe

export function useSkin() {
  return useSyncExternalStore(subscribe, () => current)
}

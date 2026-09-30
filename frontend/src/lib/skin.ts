import { useSyncExternalStore } from "react"

// 配色：紫色是原本的樣子，黑白灰在設定頁切換。選了什麼記在這支手機裡，跟帳號無關
export type Skin = "purple" | "mono"

const STORAGE_KEY = "meddemo:skin"
const listeners = new Set<() => void>()

function read(): Skin {
  try {
    return localStorage.getItem(STORAGE_KEY) === "mono" ? "mono" : "purple"
  } catch {
    return "purple" // 讀不到（無痕模式）就用原本的紫色
  }
}

let current = read()

/** 掛到 <html data-skin>，index.css 黑白灰那一組顏色靠它生效；紫色是預設，不掛 */
function apply() {
  if (typeof document === "undefined") return
  if (current === "mono") document.documentElement.dataset.skin = "mono"
  else delete document.documentElement.dataset.skin
}

// 一載入就掛：main.tsx 在畫第一個畫面之前就會載到這裡，不會先閃一下紫色
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
    // 存不進去：這次打開照樣換，下次打開回到紫色
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

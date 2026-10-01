import { useSyncExternalStore } from "react"

import type { RouteDraft, TodayRoute } from "@/api/route"
import { draftFrom } from "@/lib/itinerary"

/**
 * 調整中的行程：清單頁（/route/edit）、加一站頁（/route/edit/add）與習慣頁來回切換時都在，
 * 按「完成」或「取消」才清掉。只存在這個分頁的記憶體裡，重新整理就沒了（設計：取消就是全部丟掉）。
 */
export type EditState = {
  // 進來時讀到的那一份：存檔時帶它的 version
  base: TodayRoute
  // 最近一次 preview 回來的：時間、車程、規則
  view: TodayRoute
  draft: RouteDraft
  // 每一次改動之前的草稿，由舊到新，「復原」用
  history: RouteDraft[]
  // 最近拖動的那一站：違反的規則寫在它的卡上
  moved: string | null
}

let state: EditState | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const routeDraft = {
  get: () => state,
  start(route: TodayRoute) {
    state = { base: route, view: route, draft: draftFrom(route), history: [], moved: null }
    emit()
  },
  change(draft: RouteDraft, moved: string | null = null) {
    if (!state) return
    state = { ...state, draft, history: [...state.history, state.draft], moved }
    emit()
  },
  // 回到第 index 份草稿；回到最一開始就連畫面也回到進來時讀到的那一份（那一份的車程是正式的，不是 preview 的估計）
  revert(index: number) {
    if (!state || !state.history[index]) return
    const view = index === 0 ? state.base : state.view
    state = { ...state, draft: state.history[index], history: state.history.slice(0, index), view, moved: null }
    emit()
  },
  // preview 回來時草稿已經又改了，那一份就不用：下一次 preview 會算新的
  showView(view: TodayRoute, forDraft: RouteDraft) {
    if (!state || state.draft !== forDraft) return
    state = { ...state, view }
    emit()
  },
  clear() {
    state = null
    emit()
  },
}

export function useRouteDraft() {
  return useSyncExternalStore(subscribe, routeDraft.get, routeDraft.get)
}

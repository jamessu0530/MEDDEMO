export const MASCOT_SPLIT_TAPS = 6
export const MASCOT_TAP_WINDOW_MS = 1400

export type MascotTaps = { count: number; lastTapAt: number | null; split: boolean }
export const EMPTY_MASCOT_TAPS: MascotTaps = { count: 0, lastTapAt: null, split: false }

/** 一段連續戳戳累積六下就分裂；停太久後的點擊從第一下重新算。 */
export function tapMascot(current: MascotTaps, now: number): MascotTaps {
  if (current.split) return current
  const consecutive = current.lastTapAt !== null && now - current.lastTapAt < MASCOT_TAP_WINDOW_MS
  const count = consecutive ? current.count + 1 : 1
  return { count, lastTapAt: now, split: count >= MASCOT_SPLIT_TAPS }
}

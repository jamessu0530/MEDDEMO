import { createContext, useContext, useLayoutEffect, useState } from "react"
import { useMediaQuery } from "@/lib/use-media-query"

// Keep the last displayed number while a card waits for its next query result.
export const ReportNumberCacheContext = createContext<Map<
  string,
  number
> | null>(null)

type Clock = {
  now: () => number
  request: (callback: (time: number) => void) => number
  cancel: (id: number) => void
}

export function animateReportNumber(
  from: number,
  to: number,
  update: (value: number) => void,
  clock: Clock = {
    now: () => performance.now(),
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (id) => window.cancelAnimationFrame(id),
  }
) {
  const started = clock.now()
  let cancelled = false
  let frame = 0
  update(from)
  const tick = (time: number) => {
    if (cancelled) return
    const progress = Math.min(1, Math.max(0, (time - started) / 640))
    update(progress === 1 ? to : from + (to - from) * (1 - (1 - progress) ** 3))
    if (progress < 1) frame = clock.request(tick)
  }
  frame = clock.request(tick)
  return () => {
    cancelled = true
    clock.cancel(frame)
  }
}

export function useReportAnimatedNumber(value: number | null, key: string) {
  const cache = useContext(ReportNumberCacheContext)
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
  const [animation, setAnimation] = useState(() => ({
    key,
    target: value,
    value: cache?.get(key) ?? value,
  }))
  useLayoutEffect(() => {
    if (!cache) return
    if (value == null || !Number.isFinite(value)) {
      cache.delete(key)
      return
    }
    const from = cache.get(key)
    if (from == null || from === value || reducedMotion) {
      cache.set(key, value)
      return
    }
    return animateReportNumber(from, value, (next) => {
      cache.set(key, next)
      setAnimation({ key, target: value, value: next })
    })
  }, [cache, key, value, reducedMotion])
  const current = cache?.get(key)
  if (
    !cache ||
    reducedMotion ||
    value == null ||
    !Number.isFinite(value) ||
    current == null ||
    current === value
  )
    return value
  return animation.key === key && animation.target === value
    ? animation.value
    : current
}

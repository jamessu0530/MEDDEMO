import { useCallback, useEffect, useRef, type RefObject } from "react"
import {
  getBrowseProfile,
  sendBrowseEvents,
  type BrowseEvent,
  type BrowseProfile,
} from "@/api/products"
import { readUser, useAuth } from "@/lib/auth"
import { effectiveBrowseTime } from "@/lib/product-discovery"
import { uiDemo } from "@/lib/ui-demo-browser"

type Recorder = {
  userId: string
  profile: () => BrowseProfile
  open: (sku: string) => void
}

/** 只計算前景中真正可見的商品；切換促銷、閒置、熊熊滾示範時不取樣。 */
export function useProductBrowsing(
  root: RefObject<HTMLUListElement | null>,
  active: boolean,
  revision: string
) {
  const userId = useAuth()?.user.id
  const recorder = useRef<Recorder | null>(null)
  const visible = useRef(new Set<string>())
  useEffect(() => {
    const node = root.current
    if (!node || !active) return
    const visibleSkus = visible.current
    const top =
      node
        .closest("[data-product-panel]")
        ?.querySelector("header")
        ?.getBoundingClientRect().height ?? 0
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const sku = (entry.target as HTMLElement).dataset.productSku!
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6)
            visibleSkus.add(sku)
          else visibleSkus.delete(sku)
        }
      },
      { threshold: [0, 0.6], rootMargin: `-${Math.ceil(top)}px 0px -80px 0px` }
    )
    node
      .querySelectorAll("[data-product-sku]")
      .forEach((element) => observer.observe(element))
    return () => {
      observer.disconnect()
      visibleSkus.clear()
    }
  }, [root, active, revision])

  useEffect(() => {
    if (!userId || !active) return
    let base: BrowseProfile = {}
    const local: BrowseProfile = {}
    const pendingMs = new Map<string, number>()
    const queue: BrowseEvent[] = []
    let lastActivity = performance.now()
    let lastTick = lastActivity
    let flushing = false
    let ended = false
    const controller = new AbortController()
    const mine = () => readUser()?.id === userId
    const profile = () => {
      const merged = { ...base }
      for (const [sku, value] of Object.entries(local))
        merged[sku] = {
          active_ms: (base[sku]?.active_ms ?? 0) + value.active_ms,
          opens: (base[sku]?.opens ?? 0) + value.opens,
          last_seen: value.last_seen,
        }
      return merged
    }
    const signalFor = (sku: string) =>
      (local[sku] ??= {
        active_ms: 0,
        opens: 0,
        last_seen: new Date().toISOString(),
      })
    const collect = () => {
      for (const [sku, ms] of pendingMs)
        if (ms >= 1500) {
          queue.push({
            id: crypto.randomUUID(),
            sku,
            kind: "dwell",
            active_ms: Math.round(ms),
          })
          pendingMs.delete(sku)
        }
    }
    async function flush(keepalive = false) {
      if (!mine()) return
      collect()
      if (flushing || !queue.length) return
      flushing = true
      const batch = queue.slice(0, 40)
      let sent = false
      try {
        await sendBrowseEvents(batch, keepalive)
        queue.splice(0, batch.length)
        sent = true
      } catch {
        /* 保留相同事件 id，下次重送不會重複累計。 */
      } finally {
        flushing = false
      }
      if (ended && sent && queue.length) void flush(true)
    }
    const current: Recorder = {
      userId,
      profile,
      open(sku) {
        if (!mine() || uiDemo.getSnapshot().status === "running") return
        const signal = signalFor(sku)
        signal.opens++
        signal.last_seen = new Date().toISOString()
        queue.push({
          id: crypto.randomUUID(),
          sku,
          kind: "detail",
          active_ms: 0,
        })
        void flush()
      },
    }
    recorder.current = current
    getBrowseProfile(controller.signal)
      .then((found) => {
        base = found
      })
      .catch(() => {})
    const activity = (event: Event) => {
      if (event.isTrusted) lastActivity = performance.now()
    }
    const kinds = ["pointerdown", "touchstart", "wheel", "keydown"]
    kinds.forEach((type) =>
      window.addEventListener(type, activity, { passive: true })
    )
    const timer = window.setInterval(() => {
      const now = performance.now()
      const elapsed = effectiveBrowseTime({
        elapsed: now - lastTick,
        now,
        lastActivity,
        visible: !document.hidden,
        foreground: document.hasFocus(),
        demo: uiDemo.getSnapshot().status === "running",
      })
      lastTick = now
      if (!mine() || !elapsed) return
      for (const sku of visible.current) {
        const signal = signalFor(sku)
        const accepted = Math.min(elapsed, 60_000 - signal.active_ms)
        if (accepted <= 0) continue
        signal.active_ms += accepted
        signal.last_seen = new Date().toISOString()
        pendingMs.set(sku, (pendingMs.get(sku) ?? 0) + accepted)
      }
    }, 1000)
    const sending = window.setInterval(() => void flush(), 15_000)
    const hidden = () => {
      if (document.hidden) void flush(true)
    }
    const pagehide = () => void flush(true)
    document.addEventListener("visibilitychange", hidden)
    window.addEventListener("pagehide", pagehide)
    return () => {
      ended = true
      controller.abort()
      window.clearInterval(timer)
      window.clearInterval(sending)
      kinds.forEach((type) => window.removeEventListener(type, activity))
      document.removeEventListener("visibilitychange", hidden)
      window.removeEventListener("pagehide", pagehide)
      void flush(true)
      if (recorder.current === current) recorder.current = null
    }
  }, [userId, active])
  return {
    profile: useCallback(
      () =>
        recorder.current?.userId === readUser()?.id
          ? (recorder.current?.profile() ?? {})
          : {},
      []
    ),
    open: useCallback((sku: string) => recorder.current?.open(sku), []),
  }
}

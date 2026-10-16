import { useEffect } from "react"

const ICON =
  'svg:is(.lucide, [data-icon-motion="chart"]):not([data-icon-motion="off"]):not([class*="animate-"])'
const CONTROL =
  'button, a, summary, [role="button"], [role="tab"], [data-icon-trigger]'
const running = new Map<SVGSVGElement, ReturnType<typeof setTimeout>>()
let activeControllers = 0
let removeListeners: (() => void) | undefined

function isReduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function stop(icon: SVGSVGElement) {
  clearTimeout(running.get(icon))
  running.delete(icon)
  delete icon.dataset.iconPlaying
}

/** A full, restartable sequence, including after a short tap or pointer exit. */
export function playIconMotions(root: ParentNode = document) {
  if (isReduced() || document.visibilityState === "hidden") return
  const icons =
    root instanceof SVGSVGElement
      ? [root]
      : [...root.querySelectorAll<SVGSVGElement>(ICON)]
  const playable = icons.filter(
    (icon) =>
      icon.matches(ICON) && !icon.closest(':disabled, [aria-disabled="true"]')
  )
  for (const icon of playable) {
    stop(icon)
    icon.dataset.iconPlaying = "reset"
    for (const part of icon.querySelectorAll<SVGGeometryElement>(
      "path, circle, rect, line, polyline, polygon, ellipse"
    )) {
      if (!part.style.getPropertyValue("--stroke-length")) {
        part.style.setProperty(
          "--stroke-length",
          String(Math.max(1, part.getTotalLength()))
        )
      }
    }
  }
  // One layout read restarts the CSS timelines for the whole interaction.
  if (playable.length) void playable[0].getBoundingClientRect()
  for (const icon of playable) {
    icon.dataset.iconPlaying = "true"
    running.set(
      icon,
      setTimeout(() => stop(icon), 1600)
    )
  }
}

/** One delegated listener set covers existing, lazy and newly mounted icons. */
export function useIconMotion() {
  useEffect(() => {
    activeControllers++
    if (activeControllers === 1) {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)")
      const recent = new WeakMap<Element, number>()
      function interact(event: Event) {
        if (!(event.target instanceof Element)) return
        if (event instanceof PointerEvent && event.pointerType === "touch")
          return
        const target =
          event.target.closest(CONTROL) ?? event.target.closest(ICON)
        if (!target || target.matches(':disabled, [aria-disabled="true"]'))
          return
        if (
          event instanceof PointerEvent &&
          event.relatedTarget instanceof Node &&
          target.contains(event.relatedTarget)
        )
          return
        const now = performance.now()
        // A pointer entry and its focus event are one interaction; a click can replay.
        if (event.type !== "click" && now - (recent.get(target) ?? -1000) < 120)
          return
        recent.set(target, now)
        playIconMotions(target)
      }
      function stopAll() {
        for (const icon of running.keys()) stop(icon)
      }
      function motionChanged() {
        if (media.matches) stopAll()
      }
      function visibilityChanged() {
        if (document.visibilityState === "hidden") stopAll()
      }
      document.addEventListener("pointerover", interact)
      document.addEventListener("focusin", interact)
      document.addEventListener("click", interact)
      document.addEventListener("visibilitychange", visibilityChanged)
      media.addEventListener("change", motionChanged)
      removeListeners = () => {
        document.removeEventListener("pointerover", interact)
        document.removeEventListener("focusin", interact)
        document.removeEventListener("click", interact)
        document.removeEventListener("visibilitychange", visibilityChanged)
        media.removeEventListener("change", motionChanged)
        stopAll()
      }
    }
    return () => {
      activeControllers--
      if (!activeControllers) {
        removeListeners?.()
        removeListeners = undefined
      }
    }
  }, [])
}

export function IconMotionController() {
  useIconMotion()
  return null
}

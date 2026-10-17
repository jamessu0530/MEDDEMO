import { onAuthChange, readUser } from "@/lib/auth"
import { createUiDemo, createUiDemoTakeover } from "@/lib/ui-demo"
import {
  pageDemoTarget,
  pageDemoClickAllowed,
  pageDemoVisible,
  preparePageDemo,
} from "@/lib/page-demo-browser"

export const uiDemo = createUiDemo({
  pathname: () => window.location.pathname.replace(/\/$/, "") || "/",
  location: () => window.location.pathname + window.location.search,
  pageSteps: preparePageDemo,
  target(id) {
    const generic = id.startsWith("page-tour-")
    const element = generic
      ? pageDemoTarget(id)
      : [
          ...document.querySelectorAll<HTMLElement>(`[data-ui-demo="${id}"]`),
        ].find(
          (node) =>
            node.getClientRects().length > 0 &&
            !node.matches(":disabled, [aria-disabled=true]")
        )
    if (!element || (generic && !pageDemoVisible(element))) return null
    return {
      rect: () => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x, y, width, height }
      },
      scroll: () =>
        element.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        }),
      connected: () =>
        element.isConnected &&
        element.getClientRects().length > 0 &&
        (generic
          ? pageDemoVisible(element)
          : !element.matches(":disabled, [aria-disabled=true]")),
      act(action, value) {
        if (action === "point") return
        if (action === "click") {
          if (generic && !pageDemoClickAllowed(element))
            throw new Error("control changed")
          element.click()
          return
        }
        const prototype =
          element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
        if (!setter) throw new Error("unsupported field")
        setter.call(element, value ?? "")
        element.dispatchEvent(
          new Event(element instanceof HTMLSelectElement ? "change" : "input", {
            bubbles: true,
          })
        )
      },
    }
  },
  listen(interrupt) {
    const takeover = createUiDemoTakeover()
    let frame: number | null = null
    const block = (event: Event) => {
      if (event.cancelable) event.preventDefault()
      event.stopImmediatePropagation()
    }
    const swallowTapClick = () => {
      // The click following the second pointerup only dismisses the guide.
      const swallow = (event: Event) => { if (event.isTrusted) block(event) }
      window.addEventListener("click", swallow, true)
      window.addEventListener("dblclick", swallow, true)
      window.setTimeout(() => {
        window.removeEventListener("click", swallow, true)
        window.removeEventListener("dblclick", swallow, true)
      }, 250)
    }
    const onInput = (event: Event) => {
      if (!event.isTrusted) return
      if (event.type === "pointermove") { takeover(event); return }
      block(event)
      if (takeover(event)) {
        swallowTapClick()
        interrupt()
      }
    }
    const onLayout = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        uiDemo.refresh()
      })
    }
    const onHidden = () => {
      if (document.hidden) interrupt()
    }
    const types = ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "keydown", "click", "dblclick"]
    types.forEach((type) =>
      window.addEventListener(type, onInput, {
        capture: true,
        passive: false,
      })
    )
    window.addEventListener("resize", onLayout)
    window.addEventListener("scroll", onLayout, true)
    window.visualViewport?.addEventListener("resize", onLayout)
    window.visualViewport?.addEventListener("scroll", onLayout)
    document.addEventListener("visibilitychange", onHidden)
    return () => {
      types.forEach((type) => window.removeEventListener(type, onInput, true))
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener("resize", onLayout)
      window.removeEventListener("scroll", onLayout, true)
      window.visualViewport?.removeEventListener("resize", onLayout)
      window.visualViewport?.removeEventListener("scroll", onLayout)
      document.removeEventListener("visibilitychange", onHidden)
    }
  },
})

let ownerId = readUser()?.id
onAuthChange(() => {
  const next = readUser()?.id
  if (next !== ownerId) uiDemo.dismiss()
  ownerId = next
})

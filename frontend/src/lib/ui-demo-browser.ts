import { onAuthChange, readUser } from "@/lib/auth"
import { createUiDemo, isUserTakeover } from "@/lib/ui-demo"

export const uiDemo = createUiDemo({
  pathname: () => window.location.pathname,
  target(id) {
    const element = [
      ...document.querySelectorAll<HTMLElement>(`[data-ui-demo="${id}"]`),
    ].find(
      (node) =>
        node.getClientRects().length > 0 &&
        !node.matches(":disabled, [aria-disabled=true]")
    )
    if (!element) return null
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
        !element.matches(":disabled, [aria-disabled=true]"),
      act(action, value) {
        if (action === "point") return
        if (action === "click") {
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
    const onInput = (event: Event) => {
      if (isUserTakeover(event)) interrupt()
    }
    const onHidden = () => {
      if (document.hidden) interrupt()
    }
    const types = ["pointerdown", "touchstart", "wheel", "keydown", "click"]
    types.forEach((type) =>
      window.addEventListener(type, onInput, { capture: true, passive: true })
    )
    window.addEventListener("blur", interrupt)
    window.addEventListener("resize", interrupt)
    document.addEventListener("visibilitychange", onHidden)
    return () => {
      types.forEach((type) => window.removeEventListener(type, onInput, true))
      window.removeEventListener("blur", interrupt)
      window.removeEventListener("resize", interrupt)
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

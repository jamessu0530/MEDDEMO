import { pageContextFor } from "@/ask/page-context"
import {
  buildPageDemoSteps,
  pageDemoCanClick,
  pageDemoLoadingText,
  type PageDemoControl,
} from "@/lib/page-demo"

const targets = new Map<string, HTMLElement>()
const EXCLUDED =
  "[data-page-assistant], [data-ui-demo-overlay], [data-ui-demo-entry], [data-ui-demo-skip]"
const CONTROL_SELECTOR =
  'input:not([type="hidden"]), textarea, select, button, a[href], summary, [role="tab"], [role="combobox"], [role="button"], [role="switch"], [role="checkbox"]'

export function pageDemoVisible(element: HTMLElement) {
  return (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    !element.closest(`[hidden], [inert], [aria-hidden="true"], ${EXCLUDED}`)
  )
}

function visibleDialog() {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [role="alertdialog"]'
      ),
    ]
      .filter(pageDemoVisible)
      .at(-1) ?? null
  )
}

function labelFor(element: HTMLElement) {
  const labelledBy = element
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
  const labelled =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? [...(element.labels ?? [])]
          .map((label) => label.textContent ?? "")
          .join(" ")
      : ""
  return (
    element.getAttribute("aria-label") ||
    labelledBy ||
    labelled ||
    element.getAttribute("placeholder") ||
    element.getAttribute("title") ||
    element.textContent ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70)
}

function describe(
  element: HTMLElement,
  target: string,
  inDialog: boolean
): PageDemoControl {
  const label = labelFor(element)
  let kind: PageDemoControl["kind"] = "action"
  if (
    element.matches(
      'select, [role="tab"], [role="combobox"], [role="switch"], [role="checkbox"], button[aria-pressed], input[type="checkbox"], input[type="radio"]'
    )
  )
    kind = "choice"
  else if (element.matches("input, textarea"))
    kind =
      element.matches('input[type="search"]') || /搜尋|搜索|關鍵字/.test(label)
        ? "search"
        : "field"
  else if (element.matches("a[href]")) kind = "navigation"
  const disabled = element.matches(':disabled, [aria-disabled="true"]')
  const canOpen =
    !inDialog &&
    !disabled &&
    !(element.closest("form") && element.matches('button:not([type="button"])'))
  const opens =
    canOpen &&
    element.matches('summary[data-ui-demo-open="disclosure"]') &&
    element.parentElement?.matches("details:not([open])")
      ? "disclosure"
      : canOpen && element.matches('button[data-ui-demo-open="dialog"]')
        ? "dialog"
        : undefined
  return {
    target,
    label,
    kind,
    opens,
    disabled,
    primary: Boolean(element.closest("main")),
  }
}

/** 僅讀目前可見的應用控制項；不讀輸入值、不呼叫 AI，也不操作側邊欄或助理本身。 */
export function preparePageDemo() {
  targets.clear()
  const dialog = visibleDialog()
  const root =
    dialog ??
    [...document.querySelectorAll<HTMLElement>("[data-ui-demo-page]")].find(
      pageDemoVisible
    )
  if (!root) return []
  if (
    root.matches('[aria-busy="true"]') ||
    [...root.querySelectorAll<HTMLElement>('[aria-busy="true"]')].some(
      pageDemoVisible
    )
  )
    return []
  const textNodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
    if (
      node.parentElement &&
      pageDemoLoadingText(node.textContent ?? "") &&
      pageDemoVisible(node.parentElement)
    )
      return []
  }
  const heading = [
    ...root.querySelectorAll<HTMLElement>('h1, h2, [role="heading"]'),
  ].find(pageDemoVisible)
  const elements = [
    ...root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR),
  ].filter(
    (element) =>
      pageDemoVisible(element) &&
      !element.closest(EXCLUDED) &&
      !element.matches('a[aria-label*="圖片來源"]')
  )
  if (
    !heading &&
    !elements.length &&
    /載入|準備中|連線中/.test(root.textContent ?? "")
  )
    return []
  const title = heading
    ? labelFor(heading)
    : pageContextFor(window.location.pathname, window.location.search).title
  const controls: PageDemoControl[] = [
    {
      target: "page-tour-heading",
      label: title || "目前頁面",
      kind: "heading",
    },
  ]
  targets.set("page-tour-heading", heading ?? root)
  elements.forEach((element, index) => {
    const target = `page-tour-control-${index}`
    const control = describe(element, target, Boolean(dialog))
    if (!control.label) return
    targets.set(target, element)
    if (control.opens === "disclosure" && element.parentElement)
      targets.set(`${target}-content`, element.parentElement)
    controls.push(control)
  })
  return buildPageDemoSteps(window.location.pathname, controls)
}

export function pageDemoTarget(id: string) {
  if (id === "page-tour-dialog") return visibleDialog()
  return targets.get(id) ?? null
}

export function pageDemoClickAllowed(element: HTMLElement) {
  return (
    pageDemoVisible(element) && pageDemoCanClick(describe(element, "", false))
  )
}

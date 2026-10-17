export function keyboardViewport({
  layoutHeight,
  fullHeight,
  height = layoutHeight,
  top = 0,
  width,
  scale = 1,
  editing,
}: {
  layoutHeight: number
  fullHeight: number
  height?: number
  top?: number
  width: number
  scale?: number
  editing: boolean
}) {
  const inset = Math.max(0, layoutHeight - height - top)
  return {
    height,
    top,
    inset,
    open:
      width < 1024 &&
      editing &&
      scale === 1 &&
      Math.max(inset, fullHeight - height) > 120,
  }
}

export function isKeyboardInput(element: Element | null) {
  if (element instanceof HTMLTextAreaElement)
    return !element.disabled && !element.readOnly
  if (element instanceof HTMLInputElement)
    return (
      !element.disabled &&
      !element.readOnly &&
      ["text", "email", "password", "search", "tel", "url", "number"].includes(
        element.type
      )
    )
  return element instanceof HTMLElement && element.isContentEditable
}

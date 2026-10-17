export type ScrollHeaderState = {
  position: number
  travel: number
  hidden: boolean
}

/** 累積同方向的捲動才切換頁首；忽略頂端、底端的回彈與細小抖動。 */
export function scrollHeader(
  state: ScrollHeaderState,
  scrollY: number,
  maximum: number,
  focused = false,
  headerBottom = 16
): ScrollHeaderState {
  const max = Math.max(0, maximum)
  const position = Math.max(0, Math.min(max, scrollY))
  if (focused || position <= Math.max(16, headerBottom))
    return { position, travel: 0, hidden: false }
  const delta = position - Math.min(max, state.position)
  if (!delta) return { ...state, position }
  const travel =
    Math.sign(delta) === Math.sign(state.travel) ? state.travel + delta : delta
  const hidden = travel >= 24 ? true : travel <= -16 ? false : state.hidden
  return {
    position,
    travel: hidden !== state.hidden ? 0 : Math.max(-16, Math.min(24, travel)),
    hidden,
  }
}

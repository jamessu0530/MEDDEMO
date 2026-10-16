/** 眼睛開合比例；兩次短眨眼之間會完全張開，反光跟著眼睛一起縮放。 */
export function mascotEyeOpenness(seconds: number, deliberate = false) {
  const phase = Math.max(0, seconds) % (deliberate ? 2.4 : 5.6)
  const centers = deliberate ? [.22, .5] : [2.492, 2.772]
  const halfDuration = deliberate ? .12 : .14
  let openness = 1
  for (const center of centers) {
    const distance = Math.min(1, Math.abs(phase - center) / halfDuration)
    const eased = distance * distance * (3 - 2 * distance)
    openness = Math.min(openness, .06 + .94 * eased)
  }
  return openness
}

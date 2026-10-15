// Time-based motion samples keep movement consistent at different frame rates.
export const UNLOCK_DURATION = 2.25
export const TURN_DURATION = 1.15
export const ENTRANCE_DURATION = .85
const TAU = Math.PI * 2
const clamp = (v) => Math.max(0, Math.min(1, v))
export const easeOutCubic = (t) => 1 - (1 - clamp(t)) ** 3
export const easeInOutCubic = (t) => (t = clamp(t)) < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2

function scaleKeyframes(t, frames) {
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i][0]) {
      const [a, x] = frames[i - 1], [b, y] = frames[i]
      return x + (y - x) * easeInOutCubic((t - a) / (b - a))
    }
  }
  return frames.at(-1)[1]
}

export function idlePose(style, time) {
  const speed = [.72, .55, .63][style]
  const t = time * speed
  return {
    x: Math.sin(t * .77) * [ .045, .030, .055 ][style],
    y: Math.sin(t) * [ .14, .11, .18 ][style],
    z: Math.sin(t * .54) * .018,
    lift: Math.sin(t * 1.25) * [ .05, .035, .045 ][style],
  }
}

export function entrancePose(age) {
  const t = clamp(age / ENTRANCE_DURATION)
  const settle = 1 - easeOutCubic(t)
  return { scale: 1 - .16 * settle, lift: -.12 * settle, y: -.22 * settle }
}

export function celebrationPose(age, type = 'unlock') {
  const duration = type === 'unlock' ? UNLOCK_DURATION : TURN_DURATION
  const t = clamp(age / duration)
  return {
    progress: t,
    // One complete turn ends at exactly TAU, matching the neutral pose.
    y: TAU * easeInOutCubic(t),
    x: Math.sin(Math.PI * t) * (type === 'unlock' ? .15 : .05),
    lift: Math.sin(Math.PI * t) * (type === 'unlock' ? .13 : .02),
    scale: type === 'unlock' ? scaleKeyframes(t, [[0,1],[.12,.94],[.47,1.09],[.78,1.025],[1,1]]) : 1,
    burst: type === 'unlock' ? clamp((t - .25) / .55) : 0,
    opacity: type === 'unlock' && t > .25 ? Math.sin(Math.PI * clamp((t - .25) / .66)) * .62 : 0,
    done: age >= duration,
  }
}

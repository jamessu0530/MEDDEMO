import type { Medal } from "@/api/me"
import { LOCK_SHACKLE, LOCKED_COLORS, MEDAL_ICON, TIER_COLORS } from "@/components/me/medal-colors"

/** 平塗的獎牌：3D 載好之前、或跑不動 WebGL 時放在每一格 */
export function FlatMedal({ medal }: { medal: Medal }) {
  const open = medal.unlocked_on !== null
  const c = open ? TIER_COLORS[medal.tier] : LOCKED_COLORS
  return (
    <svg data-flat-medal viewBox="0 0 100 100" aria-hidden className="size-full">
      <circle cx="50" cy="50" r="46" fill={c.rim} />
      <circle cx="50" cy="50" r="39" fill={c.face} />
      <circle cx="50" cy="50" r="31" fill={c.inner} />
      {open ? (
        <g transform="translate(50 50) scale(1.55) translate(-12 -12)">
          <path d={MEDAL_ICON[medal.kind]} fill={c.icon} fillRule="evenodd" />
        </g>
      ) : (
        <g data-lock transform="translate(50 50) scale(1.4) translate(-12 -12)">
          <rect x="3" y="11" width="18" height="11" rx="2" fill={c.icon} />
          <path d={LOCK_SHACKLE} fill="none" stroke={c.icon} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )}
    </svg>
  )
}

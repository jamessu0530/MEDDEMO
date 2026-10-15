import type { Medal } from "@/api/me"
import { LOCK_SHACKLE, LOCKED_COLORS, MEDAL_ICON, PRODUCT_ACCENTS, TIER_COLORS } from "@/components/me/medal-colors"

/** 平塗的獎牌：3D 載好之前、或跑不動 WebGL 時放在每一格 */
export function FlatMedal({ medal }: { medal: Medal }) {
  const open = medal.unlocked_on !== null
  const c = open ? TIER_COLORS[medal.tier] : LOCKED_COLORS
  return (
    <svg data-flat-medal viewBox="0 0 100 100" aria-hidden className="size-full">
      <rect x="4" y="4" width="92" height="92" rx="25" fill={c.rim} />
      <rect x="7" y="7" width="86" height="86" rx="23" fill={open ? "#F0EFFB" : c.inner} />
      {open ? (
        <g transform="translate(50 50) scale(1.55) translate(-12 -12)">
          <path d={MEDAL_ICON[medal.kind]} fill={PRODUCT_ACCENTS[medal.kind]} fillRule="evenodd" />
        </g>
      ) : (
        <g data-lock transform="translate(50 50) scale(1.4) translate(-12 -12)">
          <rect x="3" y="11" width="18" height="11" rx="2" fill={c.icon} />
          <path d={LOCK_SHACKLE} fill="none" stroke={c.icon} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )}
      {Array.from({ length: medal.tier }, (_, i) => <circle key={i} cx={50 + (i - (medal.tier - 1) / 2) * 8} cy="82" r="2" fill={open ? c.face : c.rim} />)}
    </svg>
  )
}

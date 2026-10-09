import type { MedalKind } from "@/api/me"

// 獎牌的顏色（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）：外圈、面、內圈、圖示。
// 立體的（medal-scene.ts）用同一組，3D 載不起來時退回的平塗獎牌看起來才是同一面
export const TIER_COLORS = {
  1: { rim: "#A0622D", face: "#CD8A4B", inner: "#E7B07C", icon: "#6B3E17", metal: 0xb87333 },
  2: { rim: "#8E95A3", face: "#BCC2CC", inner: "#DDE1E7", icon: "#4B5260", metal: 0xc4cad3 },
  3: { rim: "#E0A100", face: "#FFC93C", inner: "#FFE08A", icon: "#8A5A00", metal: 0xe0a100 },
} as const
export const LOCKED_COLORS = { rim: "#B9B4C4", face: "#CFCBD8", inner: "#DEDBE5", icon: "#8E889C" } as const

// lucide 的 cross（藥局）與 map-pin（縣市），24×24；縣市的中間挖空用 evenodd
export const MEDAL_ICON: Record<MedalKind, string> = {
  stores:
    "M4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a1 1 0 0 1 1 1v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a1 1 0 0 1 1-1h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4a1 1 0 0 1-1-1V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4a1 1 0 0 1-1 1z",
  cities:
    "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z M15 10a3 3 0 1 0-6 0a3 3 0 1 0 6 0Z",
}
export const LOCK_SHACKLE = "M7 11V7a5 5 0 0 1 10 0v4"

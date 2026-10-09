import { request } from "@/api/client"

// 個人頁（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md）：後端 api/me.py

// stores：跑過的藥局；cities：跑過的縣市。各三級：1 銅、2 銀、3 金
export type MedalKind = "stores" | "cities"

export type Medal = { kind: MedalKind; tier: 1 | 2 | 3; need: number; have: number; unlocked_on: string | null }

export type Me = {
  name: string
  region: string
  stats: { visits_last_year: number; customers: number; sales_last_year: number }
  medals: Medal[]
  // 近一年進貨金額最多的五家
  top_customers: { customer_id: string; name: string; amount: number }[]
  // 含這個月的近六個月；這個月還沒過完時 through 是算到哪天（系統日）
  monthly: { month: string; amount: number; through: string | null }[]
}

export function getMe(signal?: AbortSignal) {
  return request<Me>("/api/me", { signal })
}

import type { RepRoute, StopStatus, TeamRoutes, TeamStop } from "@/api/team-routes"

/** 測試用的一站：預設是還沒去、10:00 到、沒有約時間、系統排的 */
export function teamStop(number: number, status: StopStatus, extra: Partial<TeamStop> = {}): TeamStop {
  return {
    number,
    customer_id: `C${number}`,
    customer_name: `客戶${number} · 大安`,
    area: "大安",
    lat: 25.03 + number / 100,
    lng: 121.54,
    status,
    planned_time: "10:00",
    duration_minutes: 40,
    late_minutes: 0,
    source: "model",
    signal: "ar",
    reason: "帳款最久拖了 78 天",
    window_kind: null,
    window_time: null,
    ...extra,
  }
}

/** 測試用的一位業務：林昱辰、三站（第 1 站跑完了）、還沒動過 */
export function repRoute(extra: Partial<RepRoute> = {}): RepRoute {
  return {
    rep: { id: "U01", name: "林昱辰", region: "北區" },
    version: 1,
    done: 1,
    total: 3,
    travel_minutes: 85,
    travel_km: 18.2,
    finish_time: "16:40",
    estimated: true,
    origin: { lat: 25.052, lng: 121.544 },
    stops: [teamStop(1, "done"), teamStop(2, "next", { planned_time: "10:40" }), teamStop(3, "todo")],
    legs: [
      { polyline: null, done: true },
      { polyline: null, done: false },
      { polyline: null, done: false },
    ],
    removed: [],
    added: [],
    moved: [],
    untouched: true,
    ...extra,
  }
}

export function teamRoutes(extra: Partial<TeamRoutes> = {}): TeamRoutes {
  return { date: "2026-10-28", updated_at: "11:02", scope: "北區", reps: [repRoute(), repRoute({ rep: { id: "U02", name: "王冠宇", region: "北區" } })], ...extra }
}

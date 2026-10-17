import { useMemo } from "react"
import type { DrawPlan } from "@/lib/route-draw"
import type { RouteGeometry } from "@/lib/route-geometry-work"
import { usePageWork } from "@/lib/use-page-work"

const EMPTY_PLAN: DrawPlan = { pieces: [], total: 0, legEnds: [] }
export function useRouteGeometry({ origin, legs, stops }: RouteGeometry) {
  const input = useMemo(
    () => ({
      kind: "route" as const,
      source: {
        origin: origin ? { lat: origin.lat, lng: origin.lng } : null,
        legs: legs.map(({ done, polyline, steps }) => ({
          done,
          polyline,
          steps: steps.map(({ polyline, walk }) => ({ polyline, walk })),
        })),
        stops: stops.map(({ lat, lng }) => ({ lat, lng })),
      },
    }),
    [origin, legs, stops]
  )
  const task = usePageWork(input, legs.length > 0)
  return {
    plan:
      !task.pending && task.input === input && task.result?.kind === "route"
        ? task.result.value
        : EMPTY_PLAN,
    pending: task.pending,
    error: task.error,
  }
}

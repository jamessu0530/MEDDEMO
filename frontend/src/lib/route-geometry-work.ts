import type { LatLng, RepRoute } from "@/api/team-routes"
import { finishWork, type Work } from "@/lib/background-work"

export type LegPiece = { path: LatLng[]; walk: boolean }
export type RouteGeometry = Pick<RepRoute, "origin" | "legs"> & {
  stops: LatLng[]
}
export type RouteLegPaths = { done: boolean; pieces: LegPiece[] }[]

export function* decodePolylineWork(encoded: string): Work<LatLng[]> {
  const points: LatLng[] = []
  let index = 0,
    lat = 0,
    lng = 0
  while (index < encoded.length) {
    const deltas: number[] = []
    for (let axis = 0; axis < 2; axis++) {
      let result = 0,
        shift = 0,
        byte: number
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      deltas.push(result & 1 ? ~(result >> 1) : result >> 1)
    }
    lat += deltas[0]
    lng += deltas[1]
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
    if (points.length % 128 === 0) yield
  }
  return points
}
export function decodePolyline(encoded: string) {
  return finishWork(decodePolylineWork(encoded))
}

export function boundsOf(points: LatLng[]) {
  if (!points.length) return null
  let north = -Infinity,
    south = Infinity,
    east = -Infinity,
    west = Infinity
  for (const { lat, lng } of points) {
    north = Math.max(north, lat)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    west = Math.min(west, lng)
  }
  return { north, south, east, west }
}

export function* legPathsWork(route: RouteGeometry): Work<RouteLegPaths> {
  const points: LatLng[] = route.origin ? [route.origin] : []
  let work = 0
  for (const { lat, lng } of route.stops) {
    points.push({ lat, lng })
    if (++work % 128 === 0) yield
  }
  const result: RouteLegPaths = []
  for (let index = 0; index < route.legs.length; index++) {
    const leg = route.legs[index],
      pieces: LegPiece[] = []
    if (leg.steps.length) {
      for (const step of leg.steps) {
        pieces.push({
          path: yield* decodePolylineWork(step.polyline),
          walk: step.walk,
        })
        if (++work % 128 === 0) yield
      }
    } else {
      pieces.push({
        path: leg.polyline
          ? yield* decodePolylineWork(leg.polyline)
          : [points[index], points[index + 1]],
        walk: false,
      })
    }
    result.push({ done: leg.done, pieces })
    if (++work % 128 === 0) yield
  }
  return result
}
export function legPaths(route: RouteGeometry) {
  return finishWork(legPathsWork(route))
}

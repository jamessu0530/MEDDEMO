import type { MapLink, MapNode } from "@/ask/memory-map"

export type MapPoint = { x: number; y: number; z: number }
export type MapPositions = Map<string, MapPoint>
export type MapLayoutInput = {
  nodes: Pick<MapNode, "id" | "kind">[]
  links: Pick<MapLink, "source" | "target">[]
}

/** Shared solver for the worker and the cooperative main-thread fallback. */
export function* memoryMapLayoutSteps(
  graph: MapLayoutInput
): Generator<void, MapPositions> {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id))
  const count = nodes.length
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  const z = new Float64Array(count)
  const fx = new Float64Array(count)
  const fy = new Float64Array(count)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  nodes.forEach((node, index) => {
    if (node.kind === "root") return
    const angle = index * goldenAngle
    const radius = 2.5 + Math.sqrt(index + 1) * 0.9
    x[index] = Math.cos(angle) * radius
    y[index] = Math.sin(angle) * radius
    z[index] = Math.sin(angle * 2) * 0.9
  })
  const indices = new Map(nodes.map((node, index) => [node.id, index]))
  const springs = graph.links.flatMap((link) => {
    const a = indices.get(link.source)
    const b = indices.get(link.target)
    return a === undefined || b === undefined
      ? []
      : [
          {
            a,
            b,
            length:
              nodes[a].kind === "root" || nodes[b].kind === "root" ? 4 : 2.6,
          },
        ]
  })
  for (let step = 0; step < 160; step++) {
    fx.fill(0)
    fy.fill(0)
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        const dx = x[a] - x[b]
        const dy = y[a] - y[b]
        const distance = Math.max(0.1, Math.sqrt(dx * dx + dy * dy))
        const strength = 4.5 / (distance * distance)
        const forceX = (dx / distance) * strength
        const forceY = (dy / distance) * strength
        fx[a] += forceX
        fy[a] += forceY
        fx[b] -= forceX
        fy[b] -= forceY
      }
      // Even one large iteration can be split when workers are unavailable.
      if (a % 32 === 31) yield
    }
    for (const { a, b, length } of springs) {
      const dx = x[b] - x[a]
      const dy = y[b] - y[a]
      const distance = Math.max(0.1, Math.sqrt(dx * dx + dy * dy))
      const strength = (distance - length) * 0.12
      const forceX = (dx / distance) * strength
      const forceY = (dy / distance) * strength
      fx[a] += forceX
      fy[a] += forceY
      fx[b] -= forceX
      fy[b] -= forceY
    }
    const cooling = 0.55 * (1 - step / 180)
    for (let index = 0; index < count; index++) {
      if (nodes[index].kind === "root") continue
      x[index] +=
        Math.max(-0.6, Math.min(0.6, fx[index] - x[index] * 0.015)) * cooling
      y[index] +=
        Math.max(-0.6, Math.min(0.6, fy[index] - y[index] * 0.015)) * cooling
    }
    yield
  }
  return new Map(
    nodes.map((node, index) => [
      node.id,
      { x: x[index], y: y[index], z: z[index] },
    ])
  )
}

/** One connected layout, shaped by actual links rather than query categories. */
export function layoutMemoryMap(graph: MapLayoutInput): MapPositions {
  const work = memoryMapLayoutSteps(graph)
  let result = work.next()
  while (!result.done) result = work.next()
  return result.value
}

const yieldToBrowser = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Worker startup can fail; still leave time for input, painting and cancellation. */
export async function layoutMemoryMapAsync(
  graph: MapLayoutInput,
  cancelled: () => boolean,
  pause = yieldToBrowser
): Promise<MapPositions | null> {
  await pause()
  if (cancelled()) return null
  const work = memoryMapLayoutSteps(graph)
  let started = performance.now()
  while (!cancelled()) {
    const result = work.next()
    if (result.done) return result.value
    if (performance.now() - started >= 4) {
      await pause()
      started = performance.now()
    }
  }
  return null
}

/** 座騎共用的形狀計算 */

const r2 = (v: number) => Math.round(v * 100) / 100

/** 圓角多邊形的 path：每個點 [x, y, 圓角半徑]，角用二次曲線修圓（台中的杯子、台南的魚鰭） */
export function roundedPath(points: [number, number, number][]) {
  const n = points.length
  const corners = points.map(([x, y, r], i) => {
    const [px, py] = points[(i + n - 1) % n]
    const [nx, ny] = points[(i + 1) % n]
    const a = r / Math.hypot(px - x, py - y)
    const b = r / Math.hypot(nx - x, ny - y)
    const from = `${r2(x + (px - x) * a)} ${r2(y + (py - y) * a)}`
    const to = `${r2(x + (nx - x) * b)} ${r2(y + (ny - y) * b)}`
    return `${i === 0 ? "M" : "L"}${from} Q${r2(x)} ${r2(y)} ${to}`
  })
  return `${corners.join(" ")} Z`
}

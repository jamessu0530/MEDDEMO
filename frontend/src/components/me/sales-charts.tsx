import { useEffect, useRef, useState } from "react"

import type { Me } from "@/api/me"
import { formatDate, formatWan } from "@/lib/format"
import { niceTicks } from "@/lib/medals"

/*
 * 個人頁的兩張圖（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈圖表〉）：單一系列用主色、不放圖例，
 * 文字一律用文字色。捲進畫面才播（每次打開頁面一次）：一根接一根長出來、稍微衝過頭再彈回，數字從 0 跳到實際的值；
 * 減少動態效果時直接畫好。
 */

const STAGGER_MS = 100
const GROW_MS = 900
// 稍微衝過頭再彈回
const SPRING = "cubic-bezier(.34,1.4,.64,1)"

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** 捲進畫面（露出三成以上）就變成 true，之後不再變回去；伺服器 render 與減少動態效果時一開始就是 true */
function useShown<T extends Element>() {
  const ref = useRef<T>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined" || reducedMotion())
  useEffect(() => {
    const node = ref.current
    if (shown || !node) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setShown(true), { threshold: 0.3 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [shown])
  return [ref, shown] as const
}

/** 數字從 0 跳到 value（三次方減速），shown 之前是 0；減少動態效果時直接是 value */
function CountUp({ value, shown, delay }: { value: number; shown: boolean; delay: number }) {
  const still = reducedMotion()
  const [current, setCurrent] = useState(() => (typeof window === "undefined" ? value : 0))
  useEffect(() => {
    if (!shown || still) return
    let frame = 0
    const start = performance.now() + delay
    const step = (now: number) => {
      const k = Math.min(Math.max((now - start) / GROW_MS, 0), 1)
      setCurrent(value * (1 - (1 - k) ** 3))
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [shown, still, value, delay])
  return <>{formatWan(still ? value : current)}</>
}

/** 賣最多的藥局：每列上面店名、下面長條（尾端圓角），數字在長條尖端跟著走 */
export function TopCustomers({ items }: { items: Me["top_customers"] }) {
  const [ref, shown] = useShown<HTMLOListElement>()
  const top = items[0]?.amount || 1
  return (
    <ol ref={ref} className="mt-1 flex flex-col">
      {items.map((item, i) => (
        <li key={item.customer_id} className="mt-2.5">
          <p className="text-sm">{item.name}</p>
          <div className="mt-1 flex items-center gap-2" title={`${item.name}：${formatWan(item.amount)}`}>
            <span
              className="h-3.5 rounded-r bg-primary"
              style={{
                ["--w" as string]: `${Math.round((item.amount / top) * 100)}%`,
                width: shown ? "calc(var(--w) * 0.68)" : 0,
                transition: `width ${GROW_MS}ms ${SPRING} ${i * STAGGER_MS}ms`,
              }}
            />
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              <CountUp value={item.amount} shown={shown} delay={i * STAGGER_MS} />
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}

const W = 326
const H = 190
const LEFT = 44
const BASE = 160
const TOP = 14
const BAR = 22

/** 每月業績：六根直條（頂端圓角），只標最高的那個月與這個月；這個月還沒過完畫淡色並註明算到哪天 */
export function MonthlySales({ months }: { months: Me["monthly"] }) {
  const [ref, shown] = useShown<SVGSVGElement>()
  const ticks = niceTicks(Math.max(0, ...months.map((m) => m.amount)))
  const max = ticks[ticks.length - 1]
  const y = (v: number) => BASE - (v / max) * (BASE - TOP)
  const band = (W - LEFT) / months.length
  const peak = months.reduce((best, m, i) => (m.amount > months[best].amount ? i : best), 0)
  const current = months.at(-1)
  return (
    <>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="mt-2.5 block h-auto w-full overflow-visible" role="img" aria-label="近六個月每月業績">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={LEFT - 8} y={y(t) + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground">
              {t ? `${t / 10000} 萬` : 0}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = LEFT + band * i + band / 2 - BAR / 2
          const label = `${Number(m.month.slice(5))} 月`
          const top = y(m.amount)
          return (
            <g key={m.month}>
              <title>{`${label}：${formatWan(m.amount)}${m.through ? `（到 ${formatDate(m.through)}）` : ""}`}</title>
              <path
                data-partial={m.through ? "" : undefined}
                d={`M${x} ${BASE} V${top + 4} a4 4 0 0 1 4 -4 h${BAR - 8} a4 4 0 0 1 4 4 V${BASE} Z`}
                className={m.through ? "fill-primary/40" : "fill-primary"}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "50% 100%",
                  transform: shown ? "scaleY(1)" : "scaleY(0)",
                  transition: `transform ${GROW_MS}ms ${SPRING} ${i * STAGGER_MS}ms`,
                }}
              />
              <text x={x + BAR / 2} y={BASE + 18} textAnchor="middle" fontSize={12} className="fill-muted-foreground">
                {label}
              </text>
              {(i === peak || i === months.length - 1) && (
                <text
                  x={x + BAR / 2}
                  y={top - 6}
                  textAnchor="middle"
                  fontSize={11}
                  className="fill-foreground"
                  style={{ opacity: shown ? 1 : 0, transition: `opacity 300ms ease ${i * STAGGER_MS + 600}ms` }}
                >
                  {(m.amount / 10000).toFixed(1)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {current?.through && (
        <p className="mt-2 text-xs text-muted-foreground">
          {Number(current.month.slice(5))} 月只算到 {formatDate(current.through)}，顏色淡一點。
        </p>
      )}
    </>
  )
}

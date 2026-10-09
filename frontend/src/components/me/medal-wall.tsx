import { useEffect, useRef, useState } from "react"

import type { Medal } from "@/api/me"
import { FlatMedal } from "@/components/me/flat-medal"
import "@/components/me/medal-wall.css"
import type { MedalScene } from "@/components/me/medal-scene"
import {
  freshIds, lockedHint, markSeen, MEDAL_KIND_LABEL, MEDAL_UNIT, medalBack, medalId, medalStatus, readSeen, TIER_NAME,
} from "@/lib/medals"
import { cn } from "@/lib/utils"

const KINDS = ["stores", "cities"] as const

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * 獎牌牆（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）：兩列各三面。
 * 先畫平塗的，three.js（medal-scene.ts）載好、建得起 WebGL 才換成立體的、可以拖著轉；建不起來就一直是平塗的。
 * 新解鎖、這支手機還沒看過的那幾面外圈亮一圈、快轉幾圈，演過就記成看過（lib/medals.ts）。
 */
export function MedalWall({ medals, userId }: { medals: Medal[]; userId: string }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const wallRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  // 進頁面那一刻算一次：新解鎖、還沒看過的
  const [fresh] = useState(() => new Set(typeof window === "undefined" ? [] : freshIds(medals, readSeen(userId))))
  const got = medals.filter((m) => m.unlocked_on).length

  // 3D 裡點了沒解鎖的那面：說還差多少（scene 建好之後才換 medals，所以用 ref 拿最新的）
  const medalsRef = useRef(medals)
  useEffect(() => {
    medalsRef.current = medals
  }, [medals])
  const sceneRef = useRef<MedalScene | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const card = cardRef.current
    const wall = wallRef.current
    if (!canvas || !card || !wall) return
    let cancelled = false
    import("@/components/me/medal-scene")
      .then(({ createMedalScene }) => {
        if (cancelled) return
        try {
          sceneRef.current = createMedalScene({
            canvas,
            card,
            wall,
            still: reducedMotion(),
            onLockedTap: (id) => {
              const medal = medalsRef.current.find((m) => medalId(m) === id)
              if (medal) setHint(lockedHint(medal))
            },
          })
          setReady(true)
        } catch {
          // 建不起 WebGL：留著平塗的獎牌
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
  }, [])

  // 立體獎牌照現在的資料畫（建好的那一刻、重新載入資料時）
  useEffect(() => {
    sceneRef.current?.sync(
      medals.map((m) => ({
        id: medalId(m),
        kind: m.kind,
        tier: m.tier,
        open: m.unlocked_on !== null,
        back: medalBack(m),
        fresh: fresh.has(medalId(m)),
      }))
    )
  }, [ready, medals, fresh])

  // 演過新解鎖的就記成看過
  useEffect(() => {
    markSeen(userId, medals)
  }, [medals, userId])

  // 提示 2.2 秒後收起來
  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => setHint(null), 2200)
    return () => window.clearTimeout(timer)
  }, [hint])

  return (
    <section ref={cardRef} className="relative rounded-3xl border-2 bg-card p-4 shadow-lip">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">獎牌</h2>
        <span className="text-sm text-muted-foreground">
          {got} / {medals.length}
        </span>
      </div>
      <div ref={wallRef}>
        {KINDS.map((kind) => {
          const row = medals.filter((m) => m.kind === kind)
          return (
            <div key={kind}>
              <p className="mt-3.5 mb-1.5 text-sm text-muted-foreground">
                {MEDAL_KIND_LABEL[kind]} · {row[0]?.have ?? 0} {MEDAL_UNIT[kind]}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {row.map((m) => (
                  <div key={medalId(m)} className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      data-medal-id={medalId(m)}
                      aria-label={`${TIER_NAME[m.tier]}：${MEDAL_KIND_LABEL[m.kind]} ${m.need} ${MEDAL_UNIT[m.kind]}，${medalStatus(m)}`}
                      onClick={() => !ready && !m.unlocked_on && setHint(lockedHint(m))}
                      className={cn(
                        "relative size-[92px] touch-none rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        ready && "cursor-grab active:cursor-grabbing",
                        fresh.has(medalId(m)) && "medal-glow"
                      )}
                    >
                      <span className={cn("block size-full", ready && "invisible")}>
                        <FlatMedal medal={m} />
                      </span>
                    </button>
                    <span className="text-sm">
                      {m.need} {MEDAL_UNIT[m.kind]}
                    </span>
                    <span className="text-xs text-muted-foreground">{medalStatus(m)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">在首頁點路線上的站、熊熊滾騎過去就算跑過。</p>
      {hint && (
        <p role="status" className="mt-2 rounded-xl bg-muted px-3 py-2 text-sm">
          {hint}
        </p>
      )}
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-[1] size-full" />
    </section>
  )
}

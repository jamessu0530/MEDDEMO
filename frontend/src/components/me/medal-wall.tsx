import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"

import type { Medal } from "@/api/me"
import { FlatMedal } from "@/components/me/flat-medal"

import "@/components/me/medal-wall.css"
import type { MedalScene } from "@/components/me/medal-scene"
import {
  freshIds,
  isProductMedal,
  lockedHint,
  markSeen,
  MEDAL_KINDS,
  MEDAL_KIND_LABEL,
  MEDAL_UNIT,
  medalAction,
  medalBack,
  medalCondition,
  medalId,
  medalName,
  medalProgress,
  medalStatus,
  readSeen,
  TIER_NAME,
} from "@/lib/medals"
import { cn } from "@/lib/utils"

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * 獎牌牆：六個成就類別各三面；過關畫面也可單獨呈現剛解鎖的獎牌。
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
            // WebGL 被收回：畫布空了，平塗的獎牌重新露出來（不然整面牆一片空白）
            onContextLost: () => setReady(false),
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
        {MEDAL_KINDS.map((kind) => {
          const row = medals.filter((m) => m.kind === kind)
          if (!row.length) return null
          return (
            <div key={kind}>
              <div className="mt-4 mb-2 flex items-center justify-between gap-2"><h3 className="text-base font-medium">{MEDAL_KIND_LABEL[kind]} · {row[0]?.have ?? 0} {MEDAL_UNIT[kind]}</h3></div>
              <div className={cn("grid gap-1.5", row.length === 1 ? "grid-cols-1" : "grid-cols-3")}>
                {row.map((m) => {
                  const progress = medalProgress(m)
                  return <div key={medalId(m)} className={cn("flex min-w-0 flex-col items-center gap-1.5 rounded-2xl bg-muted/20 px-1.5 py-2.5 text-center", row.length === 1 && "mx-auto w-full max-w-sm px-4")}>
                    <button
                      type="button"
                      data-medal-id={medalId(m)}
                      aria-label={`${medalName(m)}，${TIER_NAME[m.tier]}。達成條件：${medalCondition(m)}目前 ${progress.completed} / ${progress.total} ${MEDAL_UNIT[m.kind]}，${medalStatus(m)}`}
                      onClick={() => !ready && !m.unlocked_on && setHint(lockedHint(m))}
                      className={cn(
                        "relative size-[80px] shrink-0 touch-none rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-[92px]",
                        ready && "cursor-grab active:cursor-grabbing",
                        fresh.has(medalId(m)) && "medal-glow"
                      )}
                    >
                      <span className={cn("block size-full", ready && "invisible")}>
                        <FlatMedal medal={m} />
                      </span>
                    </button>
                    <p className="text-sm font-semibold leading-relaxed">{medalName(m)}</p>
                    <span className="text-xs text-muted-foreground">{TIER_NAME[m.tier]}</span>
                    <div role="progressbar" aria-label={`${medalName(m)}的達成進度`} aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.total} className="mt-auto h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.percent}%` }} />
                    </div>
                    <p className="text-xs tabular-nums">{progress.completed} / {progress.total} {MEDAL_UNIT[m.kind]}</p>
                    <span className="text-xs text-muted-foreground">{medalStatus(m)}</span>
                    {isProductMedal(m.kind) && <Link to={medalAction(m)} className="flex min-h-11 items-center text-xs font-medium text-primary">{m.unlocked_on ? "複習這關" : "去練習"}</Link>}
                  </div>
                })}
              </div>
            </div>
          )
        })}
      </div>
      {hint && (
        <p role="status" className="mt-2 rounded-xl bg-muted px-3 py-2 text-sm">
          {hint}
        </p>
      )}
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-[1] size-full" />
    </section>
  )
}

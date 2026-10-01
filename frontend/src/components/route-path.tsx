import { useEffect, useState, type CSSProperties } from "react"
import { Check, Flag } from "lucide-react"
import { Link } from "react-router"

import { SIGNAL_LABEL, type RouteSignal, type RouteStop } from "@/api/route"
import { Mascot } from "@/components/mascot"
import { buttonVariants } from "@/components/ui/button"
import { bearStopIndex, labelSide, pathOffset, signalTone } from "@/lib/route-path"
import { cn } from "@/lib/utils"

// 圓鈕 58×54（跟 Duolingo 一樣略寬），名字離圓鈕 12px
const HALF_NODE = 29
const LABEL_GAP = 12

const STATUS_LABEL: Record<RouteStop["status"], string> = { done: "已完成", next: "下一站", todo: "待拜訪" }

const TONE_CLASS = { good: "text-success", alert: "text-destructive", plain: "text-muted-foreground" } as const

function popoverId(stop: RouteStop) {
  return `stop-popover-${stop.customer_id}`
}

/**
 * 今日路線畫成 Duolingo 那樣的路（docs/superpowers/specs/2026-10-01-duolingo-home-design.md）：
 * 一站一顆厚圓鈕左右蛇行往下，名字標在旁邊空的那一側，下一站上面跳著「出發」；
 * 點圓鈕在底下彈出一張小卡寫為什麼排這家。熊熊滾站在路旁，點了進問答；最後是終點「收工」。
 */
export function RoutePath({ stops }: { stops: RouteStop[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const finished = stops.length > 0 && stops.every((stop) => stop.status === "done")
  const bearAt = bearStopIndex(stops)

  // 小卡開著時：點小卡和圓鈕以外的地方、按 Esc 都收起來（點別顆圓鈕由圓鈕自己換）
  useEffect(() => {
    if (!openId) return
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-stop-popover], [data-stop-node]")) return
      setOpenId(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenId(null)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [openId])

  return (
    <ol aria-label="今日路線" className="flex flex-col pt-2">
      {stops.map((stop, index) => {
        const offset = pathOffset(index)
        const open = openId === stop.customer_id
        return (
          // 下一站上面多留一點高度給「出發」泡泡
          <li key={stop.customer_id} className={cn("relative h-[92px]", stop.status === "next" && "mt-9")}>
            <StopNode
              stop={stop}
              index={index}
              offset={offset}
              open={open}
              onToggle={() => setOpenId(open ? null : stop.customer_id)}
            />
            <StopLabel stop={stop} offset={offset} />
            {bearAt === index && <Bear finished={false} />}
            {open && <StopPopover stop={stop} index={index} offset={offset} />}
          </li>
        )
      })}
      <li className="relative flex flex-col items-center gap-2 pt-1 pb-2">
        <span
          aria-hidden
          className={cn(
            "flex h-[54px] w-[58px] items-center justify-center rounded-[50%]",
            finished
              ? "bg-primary text-primary-foreground shadow-lip-node"
              : "bg-input text-muted-foreground shadow-lip-node-idle"
          )}
        >
          <Flag className="size-6" />
        </span>
        <p className="mt-1 text-sm font-semibold">{finished ? `今天 ${stops.length} 站都跑完了` : "收工"}</p>
        {bearAt === null && <Bear finished={finished} />}
      </li>
    </ol>
  )
}

function StopNode({
  stop,
  index,
  offset,
  open,
  onToggle,
}: {
  stop: RouteStop
  index: number
  offset: number
  open: boolean
  onToggle: () => void
}) {
  const done = stop.status === "done"
  const next = stop.status === "next"
  return (
    <div className="absolute top-0 h-[54px] w-[58px]" style={{ left: `calc(50% + ${offset - HALF_NODE}px)` }}>
      {next && (
        <>
          <span aria-hidden className="pointer-events-none absolute -inset-[9px] rounded-[50%] border-[5px] border-primary/25" />
          <Link to={`/customers/${stop.customer_id}`} className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2">
            {/* 跳的是裡面這一層：外層的 -translate-x-1/2 負責置中，跳動的 transform 寫在同一個元素上會把置中蓋掉 */}
            <span className="relative block animate-bob rounded-xl border-2 bg-card px-3 py-1 text-sm font-semibold whitespace-nowrap text-primary motion-reduce:animate-none after:absolute after:top-full after:left-1/2 after:size-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rotate-45 after:border-r-2 after:border-b-2 after:bg-card after:content-['']">
              出發
            </span>
          </Link>
        </>
      )}
      <button
        type="button"
        data-stop-node={stop.status}
        aria-expanded={open}
        aria-controls={popoverId(stop)}
        aria-label={`第 ${index + 1} 站 ${stop.customer_name}，${STATUS_LABEL[stop.status]}`}
        onClick={onToggle}
        className={cn(
          "relative flex size-full items-center justify-center rounded-[50%] text-lg font-semibold outline-none press focus-visible:ring-3 focus-visible:ring-ring/50",
          done || next ? "bg-primary text-primary-foreground shadow-lip-node" : "bg-input text-muted-foreground shadow-lip-node-idle"
        )}
      >
        {done ? <Check className="size-6" strokeWidth={3.5} /> : index + 1}
      </button>
    </div>
  )
}

function StopLabel({ stop, offset }: { stop: RouteStop; offset: number }) {
  const done = stop.status === "done"
  const left = labelSide(offset) === "left"
  // 名字在圓鈕空出來的那一側：右邊就從圓鈕右緣再過去 12px 開始，左邊就在圓鈕左緣前 12px 結束、靠右對齊
  const style: CSSProperties = left
    ? { left: 0, right: `calc(50% - ${offset - HALF_NODE - LABEL_GAP}px)` }
    : { left: `calc(50% + ${offset + HALF_NODE + LABEL_GAP}px)`, right: 0 }
  return (
    <div aria-hidden className={cn("absolute top-1 text-xs leading-snug", left && "text-right")} style={style}>
      <p className={cn("line-clamp-2 text-[0.8125rem] font-semibold", done && "text-muted-foreground")}>{stop.customer_name}</p>
      <p className="mt-0.5 text-muted-foreground">
        {done ? (
          `${stop.planned_time} 完成${stop.visit_id ? " · 已回寫" : ""}`
        ) : (
          <>
            {stop.planned_time} · <SignalLabel signal={stop.signal} />
          </>
        )}
      </p>
    </div>
  )
}

function SignalLabel({ signal }: { signal: RouteSignal }) {
  return <span className={cn("font-semibold", TONE_CLASS[signalTone(signal)])}>{SIGNAL_LABEL[signal]}</span>
}

/** 點圓鈕彈出的小卡：蓋在後面的路上，上面的尖角對準那顆圓鈕 */
function StopPopover({ stop, index, offset }: { stop: RouteStop; index: number; offset: number }) {
  const done = stop.status === "done"
  return (
    // z 比固定在上面的頁首（z-10）低，捲到頁首底下時被頁首蓋住
    <div
      id={popoverId(stop)}
      data-stop-popover
      role="group"
      aria-label={stop.customer_name}
      className="absolute inset-x-0 top-[70px] z-[5] rounded-2xl border-2 bg-card p-4 shadow-lip"
    >
      <span
        aria-hidden
        className="absolute -top-[9px] size-3.5 rotate-45 border-t-2 border-l-2 bg-card"
        style={{ left: `calc(50% + ${offset - 7}px)` }}
      />
      <p className="text-base leading-snug font-semibold">{stop.customer_name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {stop.planned_time} · 第 {index + 1} 站{done && ` · 已完成${stop.visit_id ? " · 已回寫" : ""}`}
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <SignalLabel signal={stop.signal} /> · {stop.reason}
      </p>
      <Link to={`/customers/${stop.customer_id}`} className={cn(buttonVariants(), "mt-3 h-11 w-full text-sm")}>
        {done ? "看客戶檔案" : "開啟拜訪準備"}
      </Link>
    </div>
  )
}

/** 熊熊滾站在那一列圓鈕的左邊（那一站置中、名字在右，左邊空著）；終點那一列也一樣 */
function Bear({ finished }: { finished: boolean }) {
  return (
    <Link
      to="/ask"
      aria-label="問熊熊滾（問答）"
      className="absolute -top-3 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      style={{ right: `calc(50% + ${HALF_NODE + 18}px)` }}
    >
      <Mascot state={finished ? "yay" : "idle"} size={72} />
    </Link>
  )
}

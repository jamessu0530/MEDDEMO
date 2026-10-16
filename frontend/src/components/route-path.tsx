import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Building2, Check, Flag } from "@/components/icons"
import { Link } from "react-router"

import { getBrief, type Brief } from "@/api/notes"
import { SIGNAL_LABEL, type RouteSignal, type LegMode, type RouteStop, type TravelMode } from "@/api/route"
import { Mascot } from "@/components/mascot"
import { NoteRow } from "@/components/note-row"
import { RideOnRoute } from "@/components/rides/ride-on-route"
import { LegChip, LegMenu } from "@/components/route/leg-chip"
import { buttonVariants } from "@/components/ui/button"
import { formatTaipeiTime } from "@/lib/format"
import { ROUTE_WIDTH } from "@/lib/ride-on-route"
import { finishesRoute, followsServer, hereOf, lastLeg, legBetween, officeLeg, type Leg } from "@/lib/rides"
import { departureRow, HALF_NODE, labelSide, pathOffset, signalTone, TONE_CLASS } from "@/lib/route-path"
import { legFrom } from "@/lib/travel-mode"
import { cn } from "@/lib/utils"

// 名字離圓鈕 12px（圓鈕的大小在 lib/route-path.ts）
const LABEL_GAP = 12

// 全部到過時座騎淡出多久才拿掉（跟 rides/ride-on-route.css 的 .ride-park-leave 一樣）
const LEAVE_MS = 300

const STATUS_LABEL: Record<RouteStop["status"], string> = { done: "已完成", next: "下一站", todo: "待拜訪" }

function popoverId(stop: RouteStop) {
  return `stop-popover-${stop.customer_id}`
}

type Opened = { kind: "stop" | "leg"; id: string } | null

/**
 * 今日路線畫成 Duolingo 那樣的路（docs/superpowers/specs/2026-10-01-duolingo-home-design.md）：
 * 一站一顆厚圓鈕左右蛇行往下，名字標在旁邊空的那一側，下一站上面跳著「出發」；
 * 點圓鈕：熊熊滾從停的那一站（或最上面的辦公室）騎到點的那一站，同時在底下彈出小卡（為什麼排這家、進門前三分鐘、
 * 下次去要記得），首頁送 arrive 記成到過（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md）。
 * 點停著的座騎重播最後那一段（騎乘動畫在 components/rides/ride-on-route.tsx，開始騎時叫 onRide）；
 * 最後是終點「收工」，全部跑完時熊熊滾在旗子旁跳起來。
 * 每站上面一顆膠囊寫從上一站（第一站從辦公室）怎麼過來，點了換交通方式
 * （docs/superpowers/specs/2026-10-07-ride-vehicles-design.md）；沒給 onPickMode 時膠囊不能點。
 */
export function RoutePath({
  stops,
  dayMode = "drive",
  officeStart = true,
  startCity = null,
  onPickMode,
  onArrive,
  unsaved,
  onRide,
  onRidingChange,
  collected = null,
}: {
  stops: RouteStop[]
  dayMode?: TravelMode
  officeStart?: boolean
  /** 辦公室所在的縣市：第一段的出發縣市 */
  startCity?: string | null
  onPickMode?: (from: string | null, to: string, mode: LegMode) => void
  /** 點了一站（熊騎過去或已經停在那裡但還沒記到過）：首頁送 arrive，回來時說有沒有記到 */
  onArrive?: (customerId: string) => Promise<boolean> | void
  /** 送 arrive 失敗的站：小卡寫「沒連上，這一站還沒記到」 */
  unsaved?: ReadonlySet<string>
  /** 開始騎一段（點站、點座騎重播；不能動而直接停好也算）：送騎過的座騎 */
  onRide?: (leg: Leg) => void
  /** 熊開始騎（true）、騎完（false；減少動態效果或量不到位置而直接停好也算、路線拆掉時也算）：首頁等熊到了才收急件卡 */
  onRidingChange?: (riding: boolean) => void
  /** 座騎圖鑑收集了幾台（首頁拿；拿不到是 null，入口就只寫名字） */
  collected?: { ridden: number; total: number } | null
}) {
  // 同時只開一個：站的小卡或某一段的選單
  const [opened, setOpened] = useState<Opened>(null)
  const finished = stops.length > 0 && stops.every((stop) => stop.status === "done")
  // 熊熊滾在哪：最後點的那一站。點了馬上換，不等後端；這支手機還沒點過時後端的「最後點的」變了就跟著換、不騎，
  // 點過之後只有 IT 重置才跟著換（別的評審點的站照樣打勾，熊不被拉走；lib/rides.ts followsServer）
  const serverHere = hereOf(stops)
  const [here, setHere] = useState(serverHere)
  const [seenHere, setSeenHere] = useState(serverHere)
  // 這次最後騎的那一段（點站時給）；token 換了 RideOnRoute 就騎一次，騎完清成 null（座騎重新掛上時不會再騎、再送一筆）
  const [ride, setRide] = useState<{ leg: Leg; token: number | null } | null>(null)
  const [riding, setRiding] = useState(false)
  // 開始騎時多留「出發」空間的那一列：騎的時候不搬，熊上方的路線才不會騎到一半往上移（lib/route-path.ts departureRow）
  const [heldDeparture, setHeldDeparture] = useState<string | null>(null)
  const departure = departureRow(stops, heldDeparture, riding)
  // 這次點過的站（照點的順序，含只送 arrive 沒騎的那一下）：有點過，後端回來的行程就不搬熊（lib/rides.ts followsServer）
  const [taps, setTaps] = useState<string[]>([])
  // 剛點的是最後一站還沒到過的：等後端記好（全部到過）、這一段也騎完，就收起小卡、把收工旗子捲到畫面中間，
  // 評審才看得到熊熊滾在旗子旁跳。一打開就全部到過、或全部到過之後再點一站看小卡，都不收。
  // 記的是那一下的號碼：那一下沒記到就不等了，不然很久以後別的原因全部到過時小卡會突然收起來、畫面自己捲走
  const [finishing, setFinishing] = useState<number | null>(null)
  const tapSeq = useRef(0)
  const flagRef = useRef<HTMLSpanElement>(null)
  if (serverHere !== seenHere) {
    setSeenHere(serverHere)
    if (followsServer(serverHere, here, taps)) {
      // 還沒點過時換了一站（別人點的、重新載入）或 IT 重置：熊直接換過去；正在騎的那一段會被拆掉、不會再叫 onEnd
      setHere(serverHere)
      setTaps([])
      setRide(null)
      setRiding(false)
    }
  }
  const onRoute = (id: string | null) => id !== null && stops.some((stop) => stop.customer_id === id)
  // 熊停的那一顆圓鈕：點過的站；沒點過是辦公室（null），沒有辦公室起點時是第 1 站
  const anchor = onRoute(here) ? here : officeStart ? null : (stops[0]?.customer_id ?? null)
  // 停著的座騎：剛騎的那一段、最後點的那一段；沒點過時停在辦公室是辦公室縣市那一台（點第 1 站出發時不換車），
  // 沒有辦公室起點時停在第 1 站是辦公室到第一站那段。這兩種都不能重播
  const replay = ride?.leg.to === anchor ? ride.leg : here && anchor === here ? lastLeg(stops, startCity) : null
  const parked =
    replay ??
    (anchor === null ? officeLeg(stops, startCity) : stops[0] ? legBetween(stops, null, stops[0].customer_id, startCity) : null)
  // 重播要畫面上量得到出發的那一顆：沒有辦公室起點時，從辦公室來的那一段（只點過一站）不能重播
  const canReplay = replay !== null && (officeStart || replay.from !== null)
  // 全部到過：最後一段騎完，座騎淡出（LEAVE_MS；減少動態效果時直接不見）再拿掉，熊熊滾在收工旗子旁跳。
  // 只有這次騎過才淡出：一打開就全部到過的本來就沒有座騎；又點了一站（騎起來）就不淡出了
  const parkedVisible = parked !== null && (!finished || riding)
  const [wasVisible, setWasVisible] = useState(parkedVisible)
  const [leaving, setLeaving] = useState(false)
  if (parkedVisible !== wasVisible) {
    setWasVisible(parkedVisible)
    setLeaving(!parkedVisible && finished && ride !== null)
  }
  const showParked = parkedVisible || leaving
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setLeaving(false), LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])

  // 騎的時候告訴首頁；騎完、或騎到一半路線被拆掉（切到地圖）都由 cleanup 說騎完了，首頁不會一直以為還在騎
  const ridingChange = useEffectEvent((now: boolean) => onRidingChange?.(now))
  useEffect(() => {
    if (!riding) return
    ridingChange(true)
    return () => ridingChange(false)
  }, [riding])

  // 路線的寬：座騎停多寬照它算。伺服器 render、還沒排版時照 390 寬的手機（ROUTE_WIDTH）
  const listRef = useRef<HTMLOListElement>(null)
  const [width, setWidth] = useState(ROUTE_WIDTH)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  // 開著時：點小卡、選單、圓鈕、膠囊以外的地方、按 Esc 都收起來（點別顆由那一顆自己換）
  useEffect(() => {
    if (!opened) return
    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-stop-popover], [data-stop-node], [data-leg-menu], [data-leg-chip]:not(:disabled)")
      )
        return
      setOpened(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpened(null)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [opened])

  const [flagCall, setFlagCall] = useState(0)
  if (finishing !== null && finished && !riding) {
    setFinishing(null)
    setOpened(null)
    setFlagCall((n) => n + 1)
  }
  useEffect(() => {
    if (!flagCall) return
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    flagRef.current?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" })
  }, [flagCall])

  // 選單開著時 onPickMode 不見了（忙著處理急件鈕、或重新載入退回快取的路線）：選了也沒人接，乾脆收起來
  if (!onPickMode && opened?.kind === "leg") setOpened(null)

  function toggle(kind: "stop" | "leg", id: string) {
    setOpened((now) => (now?.kind === kind && now.id === id ? null : { kind, id }))
  }

  function tapStop(stop: RouteStop) {
    const isOpen = opened?.kind === "stop" && opened.id === stop.customer_id
    setOpened(isOpen ? null : { kind: "stop", id: stop.customer_id })
    if (isOpen) return
    const rides = stop.customer_id !== anchor
    // 熊已經停在這一站、也記過到過了：只開小卡
    if (!rides && stop.arrived_at) return
    if (rides) {
      setRide({ leg: legBetween(stops, anchor, stop.customer_id, startCity), token: Date.now() })
      setRiding(true)
      setHeldDeparture(departure)
    }
    const tap = ++tapSeq.current
    const finishes = finishesRoute(stops, stop.customer_id, taps)
    setFinishing(finishes ? tap : null)
    // 只送 arrive、沒騎的那一下（沒有辦公室起點時點第 1 站、上次沒記到再點一次）也記進 taps，連點下一站時熊才不會被拉回來
    setHere(stop.customer_id)
    setTaps((now) => [...now, stop.customer_id])
    const sent = onArrive?.(stop.customer_id)
    // 這一下沒記到（小卡寫「沒連上」、或路線剛被改過要重新讀）：不再等全部到過；之後又點了別站就是那一下的事了
    if (finishes && sent)
      void sent.then((ok) => {
        if (!ok) setFinishing((now) => (now === tap ? null : now))
      })
  }

  const bear = (offset: number) =>
    parked && (
      <RideOnRoute
        key={anchor ?? "office"}
        leg={parked}
        offset={offset}
        containerWidth={width}
        play={ride && ride.leg.to === anchor ? ride.token : null}
        canReplay={canReplay}
        leaving={leaving}
        onRide={onRide}
        onEnd={() => {
          setRiding(false)
          setRide((now) => now && { ...now, token: null })
        }}
      />
    )

  return (
    <ol ref={listRef} aria-label="今日路線" className="flex flex-col pt-2">
      {officeStart && stops.length > 0 && (
        <li>
          <div className="relative h-[60px]">
            <OfficeNode />
            {showParked && anchor === null && bear(0)}
          </div>
        </li>
      )}
      {stops.map((stop, index) => {
        const offset = pathOffset(index)
        const from = legFrom(stops, index)
        const stopOpen = opened?.kind === "stop" && opened.id === stop.customer_id
        return (
          <li key={stop.customer_id}>
            <LegRow
              stop={stop}
              fromOffice={from === null}
              hideChip={from === null && !officeStart}
              x={(pathOffset(Math.max(index - 1, 0)) + offset) / 2}
              open={opened?.kind === "leg" && opened.id === stop.customer_id}
              onToggle={onPickMode ? () => toggle("leg", stop.customer_id) : undefined}
              menu={(id) => (
                <LegMenu
                  key={`${from}-${stop.customer_id}`}
                  id={id}
                  from={from}
                  to={stop.customer_id}
                  current={stop.travel_mode}
                  dayMode={dayMode}
                  onPick={(mode) => {
                    setOpened(null)
                    if (mode !== stop.travel_mode) onPickMode?.(from, stop.customer_id, mode)
                  }}
                />
              )}
            />
            {/* 下面這一列跟以前一樣；下一站上面多留一點高度給「出發」泡泡。熊在騎的時候照開始騎時那一列，
                騎完再平順搬過去（減少動態效果時直接換） */}
            <div
              className={cn(
                "relative h-[92px] transition-[margin] duration-300 ease-out motion-reduce:transition-none",
                departure === stop.customer_id && "mt-14"
              )}
            >
              <StopNode
                stop={stop}
                index={index}
                offset={offset}
                bubble={departure === stop.customer_id}
                open={stopOpen}
                onToggle={() => tapStop(stop)}
              />
              <StopLabel stop={stop} offset={offset} />
              {showParked && anchor === stop.customer_id && bear(offset)}
              {stopOpen && (
                <StopPopover stop={stop} index={index} offset={offset} unsaved={unsaved?.has(stop.customer_id) ?? false} />
              )}
            </div>
          </li>
        )
      })}
      <li className="relative flex flex-col items-center gap-2 pt-1 pb-2">
        <span
          ref={flagRef}
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
        {/* 還沒走的段只要有一段是 Google 算的就標出處（Google 的使用條款，不翻譯） */}
        {/* 同一點到同一點的段（兩站同座標、沒有辦公室起點的第一段）0 公里、不是 Google 算的，不算 */}
        {stops.some((stop) => stop.status !== "done" && !stop.travel_estimated && (stop.travel_km ?? 0) > 0) && (
          <p className="font-[Roboto,sans-serif] text-xs text-muted-foreground">Google Maps</p>
        )}
        {finished && !riding && <FinishBear />}
        <Link to="/rides" className="text-xs font-semibold text-primary">
          座騎圖鑑{collected && ` ${collected.ridden}/${collected.total}`}
        </Link>
      </li>
    </ol>
  )
}

/** 一站上面那一列：膠囊放在上一站與這一站兩顆圓鈕的正中間（x 是離中線多少 px），選單從膠囊底下彈出 */
function LegRow({
  stop,
  fromOffice,
  hideChip,
  x,
  open,
  onToggle,
  menu,
}: {
  stop: RouteStop
  fromOffice: boolean
  hideChip: boolean
  x: number
  open: boolean
  onToggle?: () => void
  menu: (id: string) => ReactNode
}) {
  const id = `leg-menu-${stop.customer_id}`
  return (
    <div className="relative h-11">
      {/* 沒有辦公室起點的第一站：這一列照樣留高度，只是不放膠囊；
          開著時要蓋過底下那一列的圓鈕：整組（含 translate 造成的疊層）抬到小卡（z-5）上面、頁首（z-10）下面 */}
      {!hideChip && (
        <div className={cn("absolute top-1 -translate-x-1/2", open && "z-[6]")} style={{ left: `calc(50% + ${x}px)` }}>
          <LegChip
            mode={stop.travel_mode}
            minutes={stop.travel_minutes}
            estimated={stop.travel_estimated}
            fromOffice={fromOffice}
            done={stop.status === "done"}
            open={open}
            controls={id}
            onClick={onToggle}
          />
          {open && menu(id)}
        </div>
      )}
    </div>
  )
}

/** 路線最上面的辦公室：熊熊滾今天還沒點過站時停在這裡，從這裡騎出去 */
function OfficeNode() {
  return (
    <>
      <span
        data-ride-anchor="office"
        data-offset={0}
        aria-hidden
        className="absolute top-0 flex h-[54px] w-[58px] items-center justify-center rounded-[50%] bg-primary text-primary-foreground shadow-lip-node"
        style={{ left: `calc(50% - ${HALF_NODE}px)` }}
      >
        <Building2 className="size-6" />
      </span>
      <p
        className="absolute top-3 text-[0.8125rem] font-semibold"
        style={{ left: `calc(50% + ${HALF_NODE + LABEL_GAP}px)` }}
      >
        辦公室
      </p>
    </>
  )
}

function StopNode({
  stop,
  index,
  offset,
  bubble,
  open,
  onToggle,
}: {
  stop: RouteStop
  index: number
  offset: number
  /** 這一列上面有留空間：沒留（熊還在騎、空間還沒搬過來）時不放泡泡，不然會蓋到上面的膠囊 */
  bubble: boolean
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
          {bubble && (
            <Link
              to={`/customers/${stop.customer_id}`}
              className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2 animate-in duration-300 fade-in motion-reduce:animate-none"
            >
              {/* 跳的是裡面這一層：外層的 -translate-x-1/2 負責置中，跳動的 transform 寫在同一個元素上會把置中蓋掉 */}
              <span className="relative block animate-bob rounded-xl border-2 bg-card px-3 py-1 text-sm font-semibold whitespace-nowrap text-primary motion-reduce:animate-none after:absolute after:top-full after:left-1/2 after:size-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rotate-45 after:border-r-2 after:border-b-2 after:bg-card after:content-['']">
                出發
              </span>
            </Link>
          )}
        </>
      )}
      <button
        type="button"
        data-stop-node={stop.status}
        data-ride-anchor={stop.customer_id}
        data-offset={offset}
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
      <p className={cn("line-clamp-2 text-sm font-semibold", done && "text-muted-foreground")}>{stop.customer_name}</p>
      <p className="mt-0.5 text-muted-foreground">
        {done ? (
          stop.visit_id || !stop.arrived_at ? (
            `${stop.planned_time} 完成${stop.visit_id ? " · 已回寫" : ""}`
          ) : (
            `${formatTaipeiTime(stop.arrived_at)} 到過`
          )
        ) : stop.window_kind && stop.late_minutes > 0 ? (
          // 有約的時間又趕不上：時間與理由讓位給這一句
          <span className="font-semibold text-destructive">會晚到 {stop.late_minutes} 分</span>
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
function StopPopover({ stop, index, offset, unsaved }: { stop: RouteStop; index: number; offset: number; unsaved: boolean }) {
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
        {stop.planned_time} · 第 {index + 1} 站{done && (stop.arrived_at && !stop.visit_id ? " · 已到過" : ` · 已完成${stop.visit_id ? " · 已回寫" : ""}`)}
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <SignalLabel signal={stop.signal} /> · {stop.reason}
      </p>
      <StopBrief customerId={stop.customer_id} />
      {unsaved && <p className="mt-3 text-xs font-semibold text-destructive">沒連上，這一站還沒記到</p>}
      <Link to={`/customers/${stop.customer_id}`} className={cn(buttonVariants(), "mt-3 h-11 w-full text-sm")}>
        開啟拜訪準備
      </Link>
    </div>
  )
}

// 小卡上最多列幾則備忘；多的進客戶檔案看
const STOP_NOTES_SHOWN = 3

/**
 * 小卡打開時才去拿這家的提醒：進門前三分鐘（最多五句）與下次去要記得（最多三則，要帶的在前；多的進客戶檔案看）。
 * 回來之前是灰色佔位條；拿不到就不顯示這兩區，不影響小卡其他內容。
 */
function StopBrief({ customerId }: { customerId: string }) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    getBrief(customerId, controller.signal)
      .then(setBrief)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [customerId])
  if (failed) return null
  if (!brief)
    return (
      <div aria-hidden className="mt-3 flex flex-col gap-2 border-t pt-3">
        <span className="h-3 w-4/5 rounded bg-muted" />
        <span className="h-3 w-3/5 rounded bg-muted" />
      </div>
    )
  if (brief.highlights.length === 0 && brief.notes.length === 0) return null
  const more = brief.notes.length - STOP_NOTES_SHOWN
  return (
    <div className="mt-3 border-t pt-2">
      {brief.highlights.length > 0 && (
        <>
          <p className="text-xs font-semibold text-primary">進門前三分鐘</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm leading-snug">
            {brief.highlights.map((line) => (
              <li key={line} className="flex gap-1.5">
                <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-primary" />
                {line}
              </li>
            ))}
          </ul>
        </>
      )}
      {brief.notes.length > 0 && (
        <>
          <p className={cn("text-xs font-semibold text-muted-foreground", brief.highlights.length > 0 && "mt-3")}>下次去要記得</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {brief.notes.slice(0, STOP_NOTES_SHOWN).map((note) => (
              <li key={note.id}>
                <NoteRow note={note} showDate={false} />
              </li>
            ))}
          </ul>
          {more > 0 && <p className="mt-1 text-xs text-muted-foreground">還有 {more} 則，在客戶檔案看</p>}
        </>
      )}
    </div>
  )
}

/** 全部跑完：熊熊滾在終點旗子左邊跳起來（只是裝飾；問答從底部分頁進） */
function FinishBear() {
  return (
    <div aria-hidden className="pointer-events-none absolute -top-3" style={{ right: `calc(50% + ${HALF_NODE + 18}px)` }}>
      <Mascot state="yay" size={72} />
    </div>
  )
}

import { useEffect, useState } from "react"
import { Car, ChevronDown } from "lucide-react"

import { getLegOptions, type LegMode, type LegOption, type TravelMode } from "@/api/route"
import { DriveSource } from "@/components/route/drive-source"
import { BETA_NOTE, LEG_MODES, legMinutes, MODE_ICON, TRAVEL_MODE_LABEL } from "@/lib/travel-mode"
import { cn } from "@/lib/utils"

/**
 * 首頁兩站之間的膠囊（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈首頁〉）：
 * 這段怎麼去、要多久，點了在底下彈出選單換交通方式。已經走完的段變灰、不能點。
 */
export function LegChip({
  mode,
  minutes,
  estimated,
  fromOffice,
  done,
  open,
  controls,
  onClick,
}: {
  mode: LegMode
  minutes: number | null
  estimated: boolean
  fromOffice: boolean
  done: boolean
  open: boolean
  controls: string
  onClick?: () => void
}) {
  // 認不得的交通方式（例如舊快取沒有這個欄位）當開車，不讓整頁當掉
  const Icon = MODE_ICON[mode] ?? Car
  const label = TRAVEL_MODE_LABEL[mode] ?? TRAVEL_MODE_LABEL.drive
  const text = done || minutes === null ? label : `${label} ${legMinutes(minutes, estimated)}`
  return (
    <button
      type="button"
      data-leg-chip
      aria-expanded={done ? undefined : open}
      aria-controls={done ? undefined : controls}
      aria-label={`${fromOffice ? "從辦公室出發，" : ""}${text}${done ? "（已走完）" : "，換交通方式"}`}
      disabled={done || !onClick}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border-2 bg-card px-2.5 text-xs font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        done ? "text-muted-foreground" : "shadow-lip press disabled:shadow-none"
      )}
    >
      {fromOffice && <span className="font-normal text-muted-foreground">從辦公室 ·</span>}
      <Icon aria-hidden className={cn("size-4", done ? "text-muted-foreground" : "text-primary")} />
      {text}
      {!done && <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />}
    </button>
  )
}

/** 膠囊底下的選單：打開時跟後端要這段四種交通方式的分鐘數 */
export function LegMenu({
  id,
  from,
  to,
  current,
  dayMode,
  onPick,
}: {
  id: string
  from: string | null
  to: string
  current: LegMode
  dayMode: TravelMode
  onPick: (mode: LegMode) => void
}) {
  const [options, setOptions] = useState<LegOption[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getLegOptions(from, to, controller.signal)
      .then((result) => setOptions(result.options))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [from, to])

  return (
    <div
      id={id}
      data-leg-menu
      className="absolute top-full left-1/2 mt-2 w-52 -translate-x-1/2 rounded-2xl border-2 bg-card p-1.5 shadow-lip"
    >
      <LegOptionList options={options} current={current} dayMode={dayMode} failed={failed} onPick={onPick} />
    </div>
  )
}

/** 選單裡的四列。options 還沒回來時分鐘數是灰色佔位條；連不上（failed）就不寫分鐘，照樣可以選 */
export function LegOptionList({
  options,
  current,
  dayMode,
  failed,
  onPick,
}: {
  options: LegOption[] | null
  current: LegMode
  dayMode: TravelMode
  failed: boolean
  onPick: (mode: LegMode) => void
}) {
  const byMode = new Map(options?.map((option) => [option.mode, option]))
  return (
    <>
      <div role="radiogroup" aria-label="交通方式" className="flex flex-col">
        {LEG_MODES.map((mode) => {
          const Icon = MODE_ICON[mode]
          const option = byMode.get(mode)
          const selected = mode === current
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPick(mode)}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-left text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected ? "bg-primary/10 text-primary" : "hover:bg-muted"
              )}
            >
              <Icon aria-hidden className={cn("size-[18px] shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span>
                  {TRAVEL_MODE_LABEL[mode]}
                  {mode === dayMode && <span className="ml-1 text-[0.6875rem] font-normal text-muted-foreground">整天預設</span>}
                </span>
                {option && !option.found && (
                  <span className="text-[0.6875rem] font-normal text-muted-foreground">查不到路線，用估算</span>
                )}
              </span>
              <span
                className={cn(
                  "ml-auto shrink-0 text-xs font-medium tabular-nums",
                  selected ? "text-primary" : "text-muted-foreground"
                )}
              >
                {option ? (
                  legMinutes(option.minutes, option.estimated)
                ) : failed ? (
                  "—"
                ) : (
                  <span aria-hidden className="block h-3 w-10 animate-pulse rounded bg-muted" />
                )}
              </span>
            </button>
          )
        })}
      </div>
      <p className="px-2.5 pt-1.5 text-[0.6875rem] leading-snug text-muted-foreground">
        {BETA_NOTE}
        {options && (
          <>
            <br />
            分鐘數
            {/* 只要有一個數字是 Google 算的就要標 Google Maps，四個都是估算才寫「（估計）」；估算的那幾列自己有「約」 */}
            <DriveSource estimated={options.every((option) => option.estimated)} />
          </>
        )}
      </p>
    </>
  )
}

import { useState } from "react"
import { Trash2, X } from "lucide-react"

import type { DraftStop, Precedence, WindowKind } from "@/api/route"
import { Switch } from "@/components/route/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { durationHabit, windowHabit, type HabitSuggestion } from "@/lib/itinerary"
import { cn } from "@/lib/utils"

const STAYS = [20, 40, 60, 90]
const WINDOWS: { kind: WindowKind | null; label: string }[] = [
  { kind: null, label: "不限" },
  { kind: "at", label: "幾點到" },
  { kind: "before", label: "以前" },
  { kind: "after", label: "以後" },
]

type StopEditorProps = {
  stop: DraftStop
  name: string
  // 目前排出來的到達時間：選了約的時間、還沒填幾點時先用它
  arrive: string
  // 其他還沒跑的站（先後的選項）
  others: { id: string; name: string }[]
  // 跟這一站有關的今天的先後
  precedences: Precedence[]
  // ask：改完要不要問「以後也這樣排嗎？」
  onChange: (patch: Partial<DraftStop>, ask?: HabitSuggestion) => void
  onAddPrecedence: (precedence: Precedence) => void
  onRemovePrecedence: (precedence: Precedence) => void
  onRemove: () => void
}

/** 點卡片就地展開的編輯區：約的時間、停留、先後、備註、鎖住、從今天的行程拿掉 */
export function StopEditor({
  stop,
  name,
  arrive,
  others,
  precedences,
  onChange,
  onAddPrecedence,
  onRemovePrecedence,
  onRemove,
}: StopEditorProps) {
  const [custom, setCustom] = useState(STAYS.includes(stop.duration_minutes) ? "" : String(stop.duration_minutes))
  const [relation, setRelation] = useState<"after" | "before">("after")
  const [other, setOther] = useState(others[0]?.id ?? "")

  function setWindow(kind: WindowKind | null, time = stop.window_time ?? arrive) {
    if (!kind) {
      onChange({ window_kind: null, window_time: null })
      return
    }
    onChange({ window_kind: kind, window_time: time }, windowHabit(stop.customer_id, name, kind, time))
  }

  function setStay(minutes: number) {
    if (minutes === stop.duration_minutes) return
    onChange({ duration_minutes: minutes }, durationHabit(stop.customer_id, name, minutes))
  }

  function commitCustom() {
    const minutes = Number(custom)
    if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 480) setStay(minutes)
  }

  function addPrecedence() {
    if (!other) return
    onAddPrecedence(relation === "after" ? { before: other, after: stop.customer_id } : { before: stop.customer_id, after: other })
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">約的時間</h3>
        <div role="radiogroup" aria-label="約的時間" className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
          {WINDOWS.map(({ kind, label }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={stop.window_kind === kind}
              onClick={() => setWindow(kind)}
              className={cn("h-9 rounded-lg text-sm", stop.window_kind === kind ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        {stop.window_kind && (
          <Input
            type="time"
            aria-label="幾點"
            value={stop.window_time ?? ""}
            onChange={(event) => event.target.value && setWindow(stop.window_kind, event.target.value)}
            className="h-11 w-36"
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">停留</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {STAYS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={stop.duration_minutes === minutes}
              onClick={() => {
                setCustom("")
                setStay(minutes)
              }}
              className={cn(
                "h-10 rounded-xl border-2 px-3 text-sm",
                stop.duration_minutes === minutes ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card"
              )}
            >
              {minutes} 分
            </button>
          ))}
          <Input
            inputMode="numeric"
            placeholder="自己輸入"
            aria-label="停留幾分鐘"
            value={custom}
            onChange={(event) => setCustom(event.target.value.replace(/\D/g, ""))}
            onBlur={commitCustom}
            onKeyDown={(event) => event.key === "Enter" && commitCustom()}
            className="h-10 w-24"
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">先後</h3>
        {precedences.length > 0 && (
          <ul className="flex flex-col gap-1">
            {precedences.map((p) => {
              const after = p.after === stop.customer_id
              const otherName = others.find((o) => o.id === (after ? p.before : p.after))?.name ?? (after ? p.before : p.after)
              return (
                <li key={`${p.before}>${p.after}`} className="flex items-center justify-between rounded-xl bg-muted px-3 py-1.5 text-sm">
                  <span>{after ? `要在 ${otherName} 之後` : `要在 ${otherName} 之前`}</span>
                  <button
                    type="button"
                    aria-label="拿掉這條先後"
                    onClick={() => onRemovePrecedence(p)}
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-card"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {others.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="shrink-0">要在</span>
              <NativeSelect aria-label="哪一站" value={other} onChange={(event) => setOther(event.target.value)}>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex gap-1.5">
              <NativeSelect
                aria-label="之前或之後"
                value={relation}
                onChange={(event) => setRelation(event.target.value as "after" | "before")}
                className="flex-1"
              >
                <option value="after">之後</option>
                <option value="before">之前</option>
              </NativeSelect>
              <Button variant="outline" className="h-11 shrink-0 px-4" onClick={addPrecedence}>
                加一條
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">備註</h3>
        <Textarea
          rows={2}
          maxLength={200}
          aria-label="備註"
          value={stop.note ?? ""}
          onChange={(event) => onChange({ note: event.target.value || null })}
        />
      </section>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">
          鎖住
          <span className="block text-xs text-muted-foreground">排順路時位置不動</span>
        </span>
        <Switch label="鎖住" checked={stop.locked} onChange={(locked) => onChange({ locked })} />
      </div>

      <Button variant="destructive" className="h-11" onClick={onRemove}>
        <Trash2 />
        從今天的行程拿掉
      </Button>
    </div>
  )
}

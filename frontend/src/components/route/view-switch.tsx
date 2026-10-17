import type { Ref } from "react"
import { Map as MapIcon, Route } from "@/components/icons"

import { cn } from "@/lib/utils"

/** 路線／地圖切換：平常看蛇行的路線，要看地圖再切過來 */
export function ViewSwitch({
  ref,
  onMap,
  onChange,
}: {
  ref?: Ref<HTMLDivElement>
  onMap: boolean
  onChange: (view: "route" | "map") => void
}) {
  const tab = (active: boolean) =>
    cn(
      "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors",
      active ? "bg-card text-foreground shadow-[0_2px_0_var(--lip)]" : "text-muted-foreground"
    )
  return (
    <div ref={ref} role="group" aria-label="怎麼看今天的路線" className="mb-3 flex gap-1 rounded-2xl bg-muted p-1">
      <button type="button" aria-pressed={!onMap} onClick={() => onChange("route")} className={tab(!onMap)}>
        <Route className="size-4" />
        路線
      </button>
      <button type="button" aria-pressed={onMap} onClick={() => onChange("map")} className={tab(onMap)}>
        <MapIcon className="size-4" />
        地圖
      </button>
    </div>
  )
}

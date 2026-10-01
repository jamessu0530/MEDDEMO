import { Pencil } from "lucide-react"
import { Link } from "react-router"

import type { TodayRoute } from "@/api/route"

/** 首頁橫幅上的「調整」：切成清單拖移、展開編輯，按「完成」一次存起來（pages/route-edit.tsx） */
export function EditRouteLink() {
  return (
    <Link
      to="/route/edit"
      className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 border-l-2 border-black/15 text-[0.6875rem] font-semibold active:bg-black/10"
    >
      <Pencil className="size-5" />
      調整
    </Link>
  )
}

/** 每天建立建議時跟別的規則衝突、今天沒套用的習慣，行程上提示原因。手機上存的舊行程沒有這個欄位 */
export function SkippedHabitsNote({ route }: { route: TodayRoute }) {
  const skipped = (route.skipped_habits ?? []).filter((habit) => habit.conflict)
  if (skipped.length === 0) return null
  return (
    <ul className="mb-3 flex flex-col gap-1 rounded-xl bg-muted px-3 py-2">
      {skipped.map((habit) => (
        <li key={habit.id} className="text-xs leading-relaxed text-muted-foreground">
          今天沒套用『{habit.text}』，因為{habit.reason}
        </li>
      ))}
    </ul>
  )
}

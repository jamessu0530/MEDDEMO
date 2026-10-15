import { ArrowUp, List } from "lucide-react"
import { NativeSelect } from "@/components/ui/native-select"
import {
  canExploreDates,
  nextDateDimension,
  type ReportDrillState,
  type ReportPointAction,
} from "@/lib/report-drill"
import {
  DATE_DIMENSIONS,
  DIMENSIONS,
  type ReportCard,
  type ReportDateDimension,
} from "@/lib/reports"

export function ReportExploreControls({
  card,
  state,
  action,
  disabled,
  onAction,
  onGrain,
  onUp,
  onReset,
  onDetails,
}: {
  card: ReportCard
  state?: ReportDrillState
  action: ReportPointAction
  disabled?: boolean
  onAction: (value: ReportPointAction) => void
  onGrain: (value: ReportDateDimension) => void
  onUp: () => void
  onReset: () => void
  onDetails: () => void
}) {
  const date = canExploreDates(card)
  return (
    <div className="mb-3 min-w-0 space-y-2 border-b pb-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
        {date && (
          <NativeSelect
            aria-label={`日期層級：${card.title}`}
            value={card.dimension}
            className="h-9 w-20 rounded-md border px-2 text-xs shadow-none"
            onChange={(event) =>
              onGrain(event.target.value as ReportDateDimension)
            }
          >
            {DATE_DIMENSIONS.map((value) => (
              <option key={value} value={value}>
                {DIMENSIONS[value]}
              </option>
            ))}
          </NativeSelect>
        )}
        {card.visual !== "kpi" && (
          <NativeSelect
            aria-label={`點選動作：${card.title}`}
            value={action}
            className="h-9 w-32 rounded-md border px-2 text-xs shadow-none"
            onChange={(event) =>
              onAction(event.target.value as ReportPointAction)
            }
          >
            <option value="filter">點選：聯動篩選</option>
            <option value="details">點選：逐筆明細</option>
            {date && nextDateDimension(card.dimension) && (
              <option value="drill">點選：日期下鑽</option>
            )}
          </NativeSelect>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={onDetails}
          className="ml-auto flex min-h-9 items-center gap-1 rounded px-2 text-primary hover:bg-muted disabled:opacity-50"
        >
          <List className="size-3.5" />
          逐筆明細
        </button>
      </div>
      {!!state?.steps.length && (
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <button
            type="button"
            className="min-h-8 rounded px-2 text-primary hover:bg-muted"
            onClick={onReset}
          >
            回到完整範圍
          </button>
          {state.steps.map((step, index) => (
            <span
              key={index}
              className="max-w-full rounded bg-muted px-2 py-1 wrap-break-word"
            >
              › {step.point.label}
            </span>
          ))}
          <button
            type="button"
            className="flex min-h-8 items-center gap-1 rounded px-2 text-primary hover:bg-muted"
            onClick={onUp}
          >
            <ArrowUp className="size-3" />
            上一層
          </button>
        </div>
      )}
    </div>
  )
}

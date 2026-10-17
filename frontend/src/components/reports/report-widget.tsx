import { useId, useState, type ComponentProps } from "react"
import { Popover } from "radix-ui"
import { Check } from "@/components/icons"
import type { ReportCard } from "@/lib/reports"
import {
  REPORT_WIDGET_PRESETS,
  reportWidgetDescription,
  type ReportWidgetSize,
} from "@/lib/report-widget"

/** Each visual explains its three presentations before changing the saved size. */
export function ReportWidgetSizeMenu({
  card,
  size,
  onChange,
}: {
  card: ReportCard
  size: ReportWidgetSize
  onChange?: (size: ReportWidgetSize) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`大小與顯示資訊：${card.title}`}
          title={`目前為${REPORT_WIDGET_PRESETS[size].label}尺寸，查看大小與顯示資訊`}
          className="flex h-8 min-w-7 shrink-0 items-center justify-center rounded-full bg-muted/60 px-1 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          {REPORT_WIDGET_PRESETS[size].label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          aria-label={`卡片大小：${card.title}`}
          className="report-widget-size-menu"
        >
          <p className="px-2 pt-1 pb-2 text-sm font-semibold">大小與顯示資訊</p>
          <div role="group" aria-label="選擇卡片大小" className="space-y-1">
            {(Object.keys(REPORT_WIDGET_PRESETS) as ReportWidgetSize[]).map(
              (option) => {
                const info = reportWidgetDescription(card.visual, option)
                const content = (
                  <>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold">
                      {REPORT_WIDGET_PRESETS[option].label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {info.title}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {info.detail}
                      </span>
                    </span>
                    {option === size && (
                      <Check
                        className="size-4 shrink-0 text-primary"
                        aria-hidden
                      />
                    )}
                  </>
                )
                return onChange ? (
                  <button
                    key={option}
                    type="button"
                    aria-label={`${REPORT_WIDGET_PRESETS[option].label}尺寸：${info.title}`}
                    aria-pressed={option === size}
                    className="flex min-h-16 w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => {
                      onChange(option)
                      setOpen(false)
                    }}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={option}
                    className="flex min-h-16 items-center gap-3 p-2"
                  >
                    {content}
                  </div>
                )
              }
            )}
          </div>
          <p className="px-2 pt-2 pb-1 text-xs leading-relaxed text-muted-foreground">
            手機、平板與桌面皆可使用，內容會依可用寬度排列。
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The same translucent curved grip used by the resizable map widget. */
export function ReportWidgetResizeHandle(props: ComponentProps<"button">) {
  const id = useId()
  return (
    <button
      {...props}
      type="button"
      className="report-widget-resize manager-map-corner absolute -right-1 -bottom-1 z-30 size-16 cursor-nwse-resize touch-none border-0 bg-transparent p-0 outline-none"
    >
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <defs>
          <clipPath id={`${id}-clip`} clipPathUnits="objectBoundingBox">
            <path d="M .9875 .45 A .5375 .5375 0 0 1 .45 .9875 A .1375 .1375 0 0 1 .45 .7125 A .2625 .2625 0 0 0 .7125 .45 A .1375 .1375 0 0 1 .9875 .45 Z" />
          </clipPath>
        </defs>
      </svg>
      <span
        aria-hidden="true"
        className="manager-map-corner-material absolute inset-0"
        style={{ clipPath: `url(#${id}-clip)` }}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 80 80"
        className="manager-map-corner-rim pointer-events-none absolute inset-0 size-full"
        fill="none"
      >
        <defs>
          <linearGradient
            id={`${id}-rim`}
            x1="22"
            y1="22"
            x2="76"
            y2="76"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="white" stopOpacity=".95" />
            <stop offset=".45" stopColor="white" stopOpacity=".65" />
            <stop offset="1" stopColor="black" stopOpacity=".3" />
          </linearGradient>
        </defs>
        <path
          d="M 79 36 A 43 43 0 0 1 36 79 A 11 11 0 0 1 36 57 A 21 21 0 0 0 57 36 A 11 11 0 0 1 79 36 Z"
          stroke={`url(#${id}-rim)`}
          strokeWidth="1.5"
        />
        <path
          d="M 59 36 A 9 9 0 0 1 75.5 31 M 36 59 A 23 23 0 0 0 59 36"
          stroke="white"
          strokeOpacity=".6"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}

import { useId, type ComponentProps } from "react"

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

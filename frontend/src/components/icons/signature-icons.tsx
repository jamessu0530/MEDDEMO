import { forwardRef, type ReactNode } from "react"
import type { LucideIcon, LucideProps } from "lucide-react"

// Original articulated SVG artwork. Each named group is a separately timed part.
// Props, refs, sizing, currentColor and accessible labels remain compatible with Lucide.
function articulated(name: string, artwork: ReactNode): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function ArticulatedIcon(
    {
      size = 24,
      color = "currentColor",
      strokeWidth = 2,
      absoluteStrokeWidth,
      className = "",
      children,
      ...props
    },
    ref
  ) {
    const labelled = Object.keys(props).some(
      (key) => key.startsWith("aria-") || key === "role"
    )
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={
          absoluteStrokeWidth
            ? (Number(strokeWidth) * 24) / (Number(size) || 24)
            : strokeWidth
        }
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={labelled ? undefined : true}
        className={`lucide lucide-${name} living-icon ${className}`}
        {...props}
      >
        {artwork}
        {children}
      </svg>
    )
  })
  Icon.displayName = name
  return Icon
}

const calendar = (
  <>
    <g data-part="calendar-sheet">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      {[
        [8, 13],
        [12, 13],
        [16, 13],
        [8, 17],
        [12, 17],
        [16, 17],
      ].map(([cx, cy], i) => (
        <circle
          key={i}
          data-part="calendar-day"
          cx={cx}
          cy={cy}
          r=".65"
          fill="currentColor"
          stroke="none"
          style={{ "--part-index": i } as React.CSSProperties}
        />
      ))}
    </g>
    <g data-part="calendar-rings">
      <path d="M8 2v4M16 2v4" />
    </g>
    <path data-part="calendar-curl" data-decor d="M3 16h13l5 5" />
  </>
)
export const CalendarDays = articulated("calendar-days", calendar)
export const Calendar = articulated("calendar", calendar)

export const ClipboardList = articulated(
  "clipboard-list",
  <>
    <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
    <rect x="9" y="2" width="6" height="4" rx="1" />
    {[10, 14, 18].map((y, i) => (
      <g key={y} style={{ "--part-index": i } as React.CSSProperties}>
        <path data-part="list-check" d={`m7 ${y} 1 1 2-2`} />
        <path data-part="list-line" d={`M13 ${y}h3`} />
      </g>
    ))}
  </>
)

export const Users = articulated(
  "users",
  <>
    <g data-part="person-back">
      <path d="M17 4a3 3 0 0 1 0 6M22 21v-2a4 4 0 0 0-4-4" />
    </g>
    <g data-part="person-front">
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
    </g>
    <path data-part="greeting" data-decor d="m19 1 .7 1M22 3l-1 .7" />
  </>
)

export const MessagesSquare = articulated(
  "messages-square",
  <>
    <g data-part="bubble-front">
      <path d="M14 2H4a2 2 0 0 0-2 2v11l4-3h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
      {[6, 9, 12].map((cx, i) => (
        <circle
          key={cx}
          data-part="typing-dot"
          data-decor
          cx={cx}
          cy="7"
          r=".65"
          fill="currentColor"
          stroke="none"
          style={{ "--part-index": i } as React.CSSProperties}
        />
      ))}
    </g>
    <g data-part="bubble-reply">
      <path d="M20 9a2 2 0 0 1 2 2v11l-4-3h-8a2 2 0 0 1-2-2v-1" />
      <path data-part="reply-line" data-decor d="M12 15h6" />
    </g>
  </>
)

export const MessageCircleQuestion = articulated(
  "message-circle-question",
  <>
    <path d="M21 11a9 9 0 0 1-9 9c-1.4 0-2.7-.3-3.9-.9L2 22l2.9-6.1A9 9 0 1 1 21 11Z" />
    <g data-part="question">
      <path d="M9.5 8a2.5 2.5 0 0 1 5 .5c0 1.8-2.5 1.8-2.5 3.5" />
      <path d="M12 15h.01" />
    </g>
    <path data-part="answer" data-decor d="m8.5 11.5 2.5 2.5 4.5-5" />
  </>
)

export const Pill = articulated(
  "pill",
  <>
    <g transform="rotate(45 12 12)">
      <path data-part="capsule-top" d="M7 12V7a5 5 0 0 1 10 0v5Z" />
      <path data-part="capsule-bottom" d="M7 12h10v5a5 5 0 0 1-10 0Z" />
      {[9.5, 12, 14.5].map((cx, i) => (
        <circle
          key={cx}
          data-part="medicine"
          data-decor
          cx={cx}
          cy="12"
          r=".7"
          fill="currentColor"
          stroke="none"
          style={{ "--part-index": i } as React.CSSProperties}
        />
      ))}
    </g>
  </>
)

export const Bell = articulated(
  "bell",
  <>
    <g data-part="bell-shell">
      <path d="M6 8a6 6 0 0 1 12 0c0 6 2 7 3 9H3c1-2 3-3 3-9Z" />
    </g>
    <path data-part="bell-clapper" d="M10 21a2 2 0 0 0 4 0" />
    <g data-part="bell-sound" data-decor>
      <path d="M2 5 1 8M22 5l1 3" />
    </g>
  </>
)

const book = (
  <>
    <g data-part="book-left">
      <path d="M12 5C9 3 6 3 2 4v15c4-1 7-1 10 1Z" />
      <path data-part="book-ink" d="M5 8h3M5 12h3M5 16h3" />
    </g>
    <g data-part="book-right">
      <path d="M12 5c3-2 6-2 10-1v15c-4-1-7-1-10 1Z" />
      <path data-part="book-ink" d="M16 8h3M16 12h3M16 16h3" />
    </g>
    <path d="M12 5v15" />
  </>
)
export const BookOpenText = articulated("book-open-text", book)
export const BookOpen = articulated("book-open", book)

export const ChartNoAxesCombined = articulated(
  "chart-no-axes-combined",
  <>
    {[
      [4, 18],
      [8, 15],
      [12, 17],
      [16, 13],
      [20, 10],
    ].map(([x, y], i) => (
      <path
        key={x}
        data-part="chart-bar"
        d={`M${x} 21V${y}`}
        style={{ "--part-index": i } as React.CSSProperties}
      />
    ))}
    <path data-part="chart-trend" d="m2 14 7-7 5 4 8-9" />
  </>
)

export const Settings = articulated(
  "settings",
  <>
    <g data-part="gear">
      <path d="m10 2-.6 3-2 .9-2.6-1.6L2 9l2.3 2v2L2 15l2.8 4.7 2.6-1.6 2 .9.6 3h4l.6-3 2-.9 2.6 1.6L22 15l-2.3-2v-2L22 9l-2.8-4.7-2.6 1.6-2-.9L14 2Z" />
    </g>
    <circle data-part="gear-core" cx="12" cy="12" r="3" />
  </>
)

export const Search = articulated(
  "search",
  <>
    <g data-part="search-lens">
      <circle cx="10.5" cy="10.5" r="7.5" />
      <path d="m16 16 5 5" />
      <path data-part="lens-glint" data-decor d="M6.5 10a4 4 0 0 1 4-4" />
    </g>
  </>
)

export const Send = articulated(
  "send",
  <>
    <g data-part="paper-plane">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path data-part="plane-fold" d="m22 2-11 11" />
    </g>
    <g data-part="flight-trail" data-decor>
      <path d="m3 16 4-4M5 21l5-5M12 21l2-2" />
    </g>
  </>
)

export const Mic = articulated(
  "mic",
  <>
    <rect data-part="mic-capsule" x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" />
    <g data-part="mic-waves" data-decor>
      <path d="M2 7v6M22 7v6" />
    </g>
  </>
)

export const Download = articulated(
  "download",
  <>
    <g data-part="download-arrow">
      <path d="M12 3v12m-5-5 5 5 5-5" />
    </g>
    <path
      data-part="download-tray"
      d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"
    />
  </>
)
export const Upload = articulated(
  "upload",
  <>
    <g data-part="upload-arrow">
      <path d="M12 16V3m-5 5 5-5 5 5" />
    </g>
    <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
  </>
)

export const Eye = articulated(
  "eye",
  <>
    <g data-part="eyelid">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle data-part="pupil" cx="12" cy="12" r="3" />
    </g>
  </>
)

export const MapPin = articulated(
  "map-pin",
  <>
    <ellipse data-part="pin-ripple" data-decor cx="12" cy="22" rx="5" ry="1" />
    <g data-part="pin">
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </g>
  </>
)

export const FileText = articulated(
  "file-text",
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path data-part="paper-corner" d="M14 2v6h6" />
    {[12, 16, 19].map((y, i) => (
      <path
        key={y}
        data-part="written-line"
        d={`M8 ${y}h${i === 2 ? 5 : 8}`}
        style={{ "--part-index": i } as React.CSSProperties}
      />
    ))}
  </>
)

export const Sun = articulated(
  "sun",
  <>
    <circle data-part="sun-core" cx="12" cy="12" r="4" />
    <g data-part="sun-rays">
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </g>
  </>
)
export const Moon = articulated(
  "moon",
  <>
    <path data-part="moon" d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />
    <path data-part="moon-star" data-decor d="M18 2v4M16 4h4M22 8v2M21 9h2" />
  </>
)

const heart =
  "M20.5 4.6a5.5 5.5 0 0 0-7.8 0L12 5.3l-.7-.7a5.5 5.5 0 0 0-7.8 7.8L12 21l8.5-8.6a5.5 5.5 0 0 0 0-7.8Z"
export const Heart = articulated(
  "heart",
  <>
    <path data-part="heart-outline" d={heart} />
    <path
      data-part="heart-fill"
      data-decor
      d={heart}
      fill="currentColor"
      stroke="none"
    />
  </>
)

export const Package = articulated(
  "package",
  <>
    <path d="M3 7v10l9 5 9-5V7M12 12v10" />
    <g data-part="box-lid">
      <path d="m3 7 9-5 9 5-9 5Zm4.5-2.5 9 5" />
    </g>
    <path
      data-part="box-surprise"
      data-decor
      d="m12 5 .8 2.2L15 8l-2.2.8L12 11l-.8-2.2L9 8l2.2-.8Z"
    />
  </>
)

export const Trash2 = articulated(
  "trash-2",
  <>
    <g data-part="trash-bin">
      <path d="m5 6 1 16h12l1-16M10 10v8M14 10v8" />
    </g>
    <g data-part="trash-lid">
      <path d="M3 6h18M9 6V2h6v4" />
    </g>
  </>
)

export const Flag = articulated(
  "flag",
  <>
    <path d="M4 22V3" />
    <path data-part="flag-cloth" d="M4 4c6-5 10 4 16-1v12c-6 5-10-4-16 1Z" />
  </>
)

export const Clock = articulated(
  "clock",
  <>
    <circle cx="12" cy="12" r="10" />
    <path data-part="clock-hour" d="M12 12h4" />
    <path data-part="clock-minute" d="M12 12V6" />
  </>
)

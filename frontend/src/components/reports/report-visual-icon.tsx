import type { ReportVisual } from "@/lib/reports"

const paths: Record<ReportVisual, string[]> = {
  kpi: ["M3 4h18v16H3z", "M7 9h3v6M7 15h6M15 9h3v6M15 12h3"],
  bar: ["M4 3v18h17", "M4 6h13v3H4M4 12h9v3H4M4 18h16v2H4"],
  column: ["M3 3v18h18", "M6 21V9h3v12M11 21V5h3v16M16 21V12h3v9"],
  stacked_bar: [
    "M3 3v18h18",
    "M3 6h16v4H3M9 6v4M14 6v4M3 14h13v4H3M8 14v4M12 14v4",
  ],
  stacked_column: [
    "M3 3v18h18",
    "M6 21V7h5v14M6 13h5M6 17h5M14 21V4h5v17M14 10h5M14 15h5",
  ],
  percent_bar: ["M3 5h18v5H3zM3 14h18v5H3z", "M10 5v5M16 5v5M7 14v5M14 14v5"],
  percent_column: [
    "M4 3h6v18H4zM14 3h6v18h-6z",
    "M4 10h6M4 17h6M14 7h6M14 14h6",
  ],
  line: ["M3 3v18h18", "M4 16l5-7 5 4 6-9", "M7.5 9h3M12.5 13h3M18.5 4h3"],
  area: ["M3 3v18h18", "M4 17l5-8 5 5 6-9v16H4z"],
  pie: ["M13 2v9h9A9 9 0 0 0 13 2z", "M10 4a9 9 0 1 0 10 10H10z"],
  donut: [
    "M12 3a9 9 0 1 0 9 9",
    "M12 7a5 5 0 1 0 5 5M12 3v4M17 12h4M14 3.2V7M20.8 10H17",
  ],
  treemap: ["M3 3h18v18H3z", "M12 3v18M3 11h9M12 8h9M12 15h9M7 11v10"],
  combo: [
    "M3 3v18h18",
    "M6 21V12h3v9M12 21V9h3v12M18 21V14h3v7",
    "M4 10l5-5 6 3 6-6",
  ],
  scatter: [
    "M3 3v18h18",
    "M7 15h.01M10 9h.01M13 13h.01M16 5h.01M20 8h.01",
    "M6 16l14-12",
  ],
  table: ["M3 4h18v16H3z", "M3 9h18M3 14h18M9 4v16M15 4v16"],
  matrix: [
    "M3 3h18v18H3z",
    "M3 8h18M3 14h18M8 3v18M14 3v18M16.5 17.5h2M17.5 16.5v2",
  ],
}

export function ReportVisualIcon({
  visual,
  className = "size-5",
}: {
  visual: ReportVisual
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[visual].map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  )
}

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import type { StudioObject } from "@/lib/report-studio"

export function ReportRibbon({
  editing,
  children,
  onInsert,
  panels,
  onPanel,
  onAnalytics,
}: {
  editing: boolean
  children: ReactNode
  onInsert: (kind: StudioObject["kind"]) => void
  panels: { data: boolean; filters: boolean; layers: boolean }
  onPanel: (key: "data" | "filters" | "layers") => void
  onAnalytics: () => void
}) {
  const [tab, setTab] = useState("home")
  return (
    <div
      className="mt-3 rounded-lg border bg-muted/10"
      aria-label="報表功能工具列"
    >
      <div
        className="flex overflow-x-auto border-b"
        role="tablist"
        aria-label="工具列分頁"
      >
        {[
          { id: "home", label: "常用" },
          { id: "insert", label: "插入" },
          { id: "view", label: "檢視" },
          { id: "analytics", label: "分析" },
        ].map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onKeyDown={(event) => {
              const tabs = ["home", "insert", "view", "analytics"]
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return
              event.preventDefault()
              const index =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 3
                    : (tabs.indexOf(tab) +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        4) %
                      4
              setTab(tabs[index])
              ;(
                event.currentTarget.parentElement?.children[
                  index
                ] as HTMLElement
              )?.focus()
            }}
            className={`min-h-10 shrink-0 px-4 text-xs whitespace-nowrap ${tab === item.id ? "border-b-2 border-primary font-semibold text-primary" : "text-muted-foreground"}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="toolbar"
        aria-label={`${tab}工具`}
        className="flex min-h-14 items-center gap-2 overflow-x-auto p-2 [&>*]:shrink-0"
      >
        {tab === "home" && children}
        {tab === "insert" && (
          <>
            {(
              [
                ["text", "文字方塊"],
                ["image", "圖片"],
                ["shape", "形狀"],
                ["button", "操作按鈕"],
                ["slicer", "畫布切片器"],
              ] as const
            ).map(([kind, label]) => (
              <Button
                key={kind}
                variant="outline"
                size="sm"
                disabled={!editing}
                onClick={() => onInsert(kind)}
              >
                {label}
              </Button>
            ))}
            {!editing && (
              <span className="text-xs text-muted-foreground">
                切換編輯模式即可插入物件。
              </span>
            )}
          </>
        )}
        {tab === "view" && (
          <>
            {(
              [
                ["data", "資料面板"],
                ["filters", "篩選面板"],
                ["layers", "選取與圖層"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                variant={panels[key] ? "secondary" : "outline"}
                size="sm"
                aria-pressed={panels[key]}
                onClick={() => onPanel(key)}
              >
                {label}
              </Button>
            ))}
          </>
        )}
        {tab === "analytics" && (
          <>
            <Button variant="outline" size="sm" onClick={onAnalytics}>
              圖表分析與互動
            </Button>
            <p className="text-xs text-muted-foreground">
              選取圖表，設定跨頁分析、提示頁、趨勢與預測。
            </p>
          </>
        )}
      </div>
    </div>
  )
}

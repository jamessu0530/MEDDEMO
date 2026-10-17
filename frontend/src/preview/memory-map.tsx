import { StrictMode, useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Ask, AskKind } from "@/api/asks"
import type { Entry, ToolRun } from "@/ask/conversation"
import { createMapEditsStore } from "@/ask/memory-map-edits"
import { AskMemoryMap } from "@/components/ask/memory-map"
import { Button } from "@/components/ui/button"
import "@/index.css"

function sample(
  id: number,
  kind: AskKind,
  question: string,
  answer: string,
  evidence: Ask["evidence"]
): ToolRun {
  return {
    id,
    kind: "tool",
    askKind: kind,
    question,
    original: null,
    error: null,
    cancelled: false,
    routing: false,
    choices: null,
    auto: true,
    ask: {
      id: `preview-${id}`,
      kind,
      question,
      answer,
      evidence,
      status: "answered",
      trace: [],
      error_message: null,
      customers: [],
      attachment: null,
    },
  }
}
const document = {
  chunk_id: 17,
  source_name: "展示用公司文件",
  doc_title: "退貨申請辦法（示範）",
  section: "近效期處理",
  content: "這是開發預覽的示範段落，用來檢查共用文件的關聯。",
}
const samples: Entry[] = [
  {
    ...sample(
      1,
      "data",
      "北區保健品最近三個月為什麼下滑？",
      "這是示範回答，可從這題查看查詢結果與相關客戶。",
      {
        columns: ["月份", "銷售額"],
        rows: [
          ["7月", 320000],
          ["8月", 270000],
          ["9月", 220000],
        ],
      }
    ),
    ask: {
      ...sample(1, "data", "", "", null).ask!,
      answer: "示範回答：北區保健品銷售額逐月減少。",
      customers: [{ id: "preview-customer", name: "康泰藥局（示範）" }],
      evidence: {
        columns: ["月份", "銷售額"],
        rows: [
          ["7月", 320000],
          ["8月", 270000],
          ["9月", 220000],
        ],
      },
    },
  },
  sample(
    2,
    "knowledge",
    "近效期的貨要多久前申請退貨？",
    "示範回答：依公司退貨申請辦法處理。",
    { sources: [document] }
  ),
  {
    ...sample(
      3,
      "knowledge",
      "已經拆封的貨也可以退嗎？",
      "示範回答：請核對退貨辦法的條件。",
      {
        sources: [
          document,
          {
            ...document,
            chunk_id: 18,
            section: "包裝條件",
            content: "這是另一個展示段落，可從右側回看這題。",
          },
        ],
      }
    ),
    original: "那拆封的呢？",
  },
  sample(
    4,
    "memory",
    "北區最近競品有什麼動作？",
    "示範回答：頻道提到競品正在推出促銷。",
    {
      items: [
        {
          index: 1,
          channel_name: "北區業務（示範）",
          date: "2026-10-14",
          category: "competitor",
          text: "競品推出組合促銷，需補充比價資料。",
        },
        {
          index: 2,
          channel_name: "北區業務（示範）",
          date: "2026-10-14",
          category: "todo",
          text: "週五前準備保健品比價表。",
        },
      ],
    }
  ),
]

// 24 questions, each with 24 distinct sources: 601 nodes including the center.
const stressSamples: Entry[] = Array.from({ length: 24 }, (_, index) =>
  sample(
    index + 1,
    "knowledge",
    `壓力測試問題 ${index + 1}`,
    "僅供開發效能檢查的示範回答。",
    {
      sources: Array.from({ length: 24 }, (_, source) => ({
        chunk_id: 1000 + index * 24 + source,
        source_name: "開發壓力測試",
        doc_title: `示範線索 ${index + 1}-${source + 1}`,
        section: "效能測試",
        content: "這是測試排列與畫面反應的示範段落。",
      })),
    }
  )
)

export function Preview() {
  const [entries, setEntries] = useState(samples)
  const [jumped, setJumped] = useState<number | null>(null)
  const [mapEdits] = useState(createMapEditsStore)
  useEffect(() => {
    const fail = (event: KeyboardEvent) => {
      if (event.key !== "F9") return
      event.preventDefault()
      const canvas = globalThis.document.querySelector<HTMLCanvasElement>(
        ".memory-map-canvas canvas"
      )
      canvas
        ?.getContext("webgl2")
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext()
    }
    globalThis.document.addEventListener("keydown", fail)
    return () => globalThis.document.removeEventListener("keydown", fail)
  }, [])
  return (
    <main className="memory-map-preview mx-auto max-w-2xl px-5 py-12">
      <p className="text-xs text-primary">開發預覽 · 示範資料</p>
      <h1 className="mt-2 text-2xl font-semibold">讓每個問題，找到脈絡。</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        開啟記憶地圖，旋轉看看問題、文件與頻道記憶。兩個規定問題共用一份文件，可點選查看關聯。
      </p>
      <AskMemoryMap entries={entries} edits={mapEdits} onJump={setJumped} />
      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setEntries(samples)}>
          已查完的對話
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            setEntries([
              ...samples,
              {
                ...sample(5, "memory", "北區還有哪些待辦沒做完？", "", null),
                ask: {
                  ...sample(5, "memory", "", "", null).ask!,
                  status: "running",
                  trace: [
                    {
                      round: 1,
                      step: "search",
                      sql: null,
                      search_query: "北區 待辦",
                      row_count: null,
                      decision: "正在找頻道的待辦重點",
                    },
                  ],
                },
              },
            ])
          }
        >
          正在查詢
        </Button>
        <Button variant="outline" onClick={() => setEntries([])}>
          空白對話
        </Button>
        <Button variant="outline" onClick={() => setEntries(stressSamples)}>
          壓力測試（601 節點）
        </Button>
      </div>
      {jumped !== null && (
        <p role="status" className="mt-5 text-sm text-primary">
          已選擇回看第 {jumped} 題。在正式問答頁會捲到該回答。
        </p>
      )}
      <p className="mt-8 text-xs text-muted-foreground">
        本頁只展示互動，不呼叫 AI 或讀取帳號資料。地圖開啟時按 F9 可測試 3D
        無法顯示的備援。
      </p>
    </main>
  )
}
const previewRoot: Root =
  import.meta.hot?.data.previewRoot ??
  createRoot(globalThis.document.getElementById("root")!)
if (import.meta.hot) import.meta.hot.data.previewRoot = previewRoot
previewRoot.render(
  <StrictMode>
    <Preview />
  </StrictMode>
)

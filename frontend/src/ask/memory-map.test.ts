import { describe, expect, it } from "vitest"
import type { Ask, AskKind, MemoryFile, Source } from "@/api/asks"
import { createConversation, type ToolRun } from "@/ask/conversation"
import { buildMemoryMap, filterMemoryMap } from "@/ask/memory-map"
import { layoutMemoryMap } from "@/ask/memory-map-layout"

function answered(
  id: string,
  kind: AskKind = "knowledge",
  evidence: Ask["evidence"] = null
): Ask {
  return {
    id,
    kind,
    question: "退貨怎麼處理？",
    status: "answered",
    answer: "請參考退貨規定。",
    evidence,
    error_message: null,
    trace: [],
    escalation_id: null,
    customers: [],
    attachment: null,
  }
}
const source: Source = {
  chunk_id: 17,
  source_name: "公司規定",
  doc_title: "退貨辦法",
  section: "近效期",
  content: "需提前申請。",
}

describe("query memory map", () => {
  it("不同查詢類型連成同一張網絡，不建立分類分區", () => {
    const conversation = createConversation()
    for (const kind of ["data", "knowledge", "memory"] as const) {
      const id = conversation.addToolRun(kind, `${kind}問題`)
      conversation.replace(id, {
        ask: answered(String(id), kind, { sources: [source] }),
      })
    }
    const graph = buildMemoryMap(conversation.getSnapshot())
    expect(graph.nodes.some((node) => node.kind === "topic")).toBe(false)
    const reachable = new Set(["conversation"])
    for (let pass = 0; pass < graph.nodes.length; pass++)
      for (const link of graph.links) {
        if (reachable.has(link.source)) reachable.add(link.target)
        if (reachable.has(link.target)) reachable.add(link.source)
      }
    expect(reachable.size).toBe(graph.nodes.length)
    const searched = filterMemoryMap(graph, "all", "退貨辦法")
    expect(searched.nodes.some((node) => node.id === "conversation")).toBe(true)
    expect(
      searched.nodes.filter((node) => node.kind === "question")
    ).toHaveLength(3)

    // Category changes do not move nodes into separate regions.
    const layout = layoutMemoryMap(graph)
    expect(
      layoutMemoryMap({
        ...graph,
        nodes: graph.nodes.map((node) => ({ ...node, askKind: "data" })),
      })
    ).toEqual(layout)
    expect(layout.get("conversation")).toEqual({ x: 0, y: 0, z: 0 })
    const points = [...layout.values()]
    expect(
      points.every((point) => Object.values(point).every(Number.isFinite))
    ).toBe(true)
    for (let a = 0; a < points.length; a++)
      for (let b = a + 1; b < points.length; b++)
        expect(
          Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y)
        ).toBeGreaterThan(1)
    expect(layoutMemoryMap({ ...graph, nodes: [], links: [] }).size).toBe(0)
  })

  it("共用引用合成一個節點，每題仍能回到自己的對話", () => {
    const conversation = createConversation()
    const first = conversation.addToolRun("knowledge", "近效期怎麼退？")
    const second = conversation.addToolRun("knowledge", "那要提前多久？")
    conversation.replace(first, {
      ask: answered("a", "knowledge", { sources: [source] }),
    })
    conversation.replace(second, {
      ask: answered("b", "knowledge", { sources: [{ ...source, index: 2 }] }),
      original: "那要提前多久？",
    })
    const graph = buildMemoryMap(conversation.getSnapshot())
    const documents = graph.nodes.filter((node) => node.kind === "document")
    expect(documents).toHaveLength(1)
    expect(documents[0].runIds).toEqual([first, second])
    expect(
      graph.links.filter((edge) => edge.target === documents[0].id)
    ).toHaveLength(2)
    expect(graph.links).toContainEqual({
      source: `question:${first}`,
      target: `question:${second}`,
      label: "接續查詢",
    })
    expect(graph.activeId).toBeNull()
    expect(graph.latestId).toBe(`question:${second}`)
  })

  it("正在判斷、等待選擇、查詢失敗與完成不會都被當成正在查", () => {
    const conversation = createConversation()
    const id = conversation.addToolRun(null, "我要查什麼？", { routing: true })
    expect(buildMemoryMap(conversation.getSnapshot()).activeId).toBe(
      `question:${id}`
    )
    conversation.replace(id, { routing: false, choices: ["data", "knowledge"] })
    expect(buildMemoryMap(conversation.getSnapshot()).activeId).toBeNull()
    conversation.replace(id, { choices: null, error: "暫時無法查詢" })
    const failed = buildMemoryMap(conversation.getSnapshot())
    expect(failed.activeId).toBeNull()
    expect(
      failed.nodes.find((node) => node.id === `question:${id}`)?.meta
    ).toBe("查詢失敗")
    conversation.replace(id, {
      error: null,
      askKind: "knowledge",
      ask: {
        ...answered("a"),
        status: "running",
        trace: [
          {
            round: 1,
            step: "search",
            sql: null,
            search_query: "退貨",
            row_count: 2,
            decision: "查公司文件",
          },
        ],
      },
    })
    const live = buildMemoryMap(conversation.getSnapshot())
    expect(live.activeId).toBe(`question:${id}`)
    expect(
      live.nodes.find((node) => node.id === live.activeId)?.meta
    ).toContain("檢索資料")
    conversation.replace(id, { ask: answered("a") })
    expect(buildMemoryMap(conversation.getSnapshot()).activeId).toBeNull()
  })

  it("只看這一題不帶進共用文件的其他題；搜尋仍保留引用的問題", () => {
    const conversation = createConversation()
    const first = conversation.addToolRun("knowledge", "第一題")
    const second = conversation.addToolRun("knowledge", "第二題")
    for (const id of [first, second])
      conversation.replace(id, {
        ask: answered(String(id), "knowledge", { sources: [source] }),
      })
    const graph = buildMemoryMap(conversation.getSnapshot())
    const current = filterMemoryMap(graph, "current", "退貨辦法")
    expect(current.nodes.some((node) => node.id === `question:${second}`)).toBe(
      true
    )
    expect(current.nodes.some((node) => node.id === `question:${first}`)).toBe(
      false
    )
    expect(current.nodes.some((node) => node.kind === "document")).toBe(true)
    expect(filterMemoryMap(graph, "data", "").nodes).toEqual([])
    expect(filterMemoryMap(graph, "all", "不存在的關鍵字").nodes).toEqual([])
  })

  it("頻道記憶、客戶與結果來自實際依據，沒有依據不生成假資料", () => {
    const conversation = createConversation()
    const id = conversation.addToolRun("memory", "北區有哪些待辦？")
    conversation.replace(id, {
      ask: {
        ...answered("a", "memory", {
          items: [
            {
              index: 1,
              channel_name: "北區",
              date: "2026-10-14",
              category: "todo",
              text: "補送報價",
            },
          ],
          columns: ["客戶"],
          rows: [["康泰"]],
        }),
        customers: [{ id: "C01", name: "康泰" }],
      },
    })
    const graph = buildMemoryMap(conversation.getSnapshot())
    expect(graph.nodes.filter((node) => node.kind === "memory")).toHaveLength(1)
    expect(graph.nodes.find((node) => node.kind === "channel")?.label).toBe(
      "北區"
    )
    expect(graph.nodes.find((node) => node.kind === "customer")?.href).toBe(
      "/customers/C01"
    )
    expect(graph.nodes.find((node) => node.kind === "result")?.label).toBe(
      "1 筆查詢結果"
    )
    const empty = buildMemoryMap([])
    expect(empty.nodes.map((node) => node.kind)).toEqual(["root"])
    expect(empty.links).toEqual([])
  })

  it("只有可讀的原始頻道才提供附件跳轉；外部網址拒絕腳本", () => {
    const conversation = createConversation()
    const id = conversation.addToolRun("memory", "看競品海報")
    const file: MemoryFile = {
      id: 3,
      attachment_id: 3,
      index: 1,
      kind: "image",
      filename: "海報.jpg",
      width: 800,
      height: 600,
      page_count: null,
      url: "/files/3",
      thumb_url: null,
      channel_name: "北區",
      date: "2026-10-14",
      caption: "競品活動",
      message_id: 45,
      channel_id: null,
    }
    conversation.replace(id, {
      ask: answered("a", "memory", {
        attachments: [file],
        sources: [{ ...source, kind: "web", url: "javascript:alert(1)" }],
      }),
    })
    let graph = buildMemoryMap(conversation.getSnapshot())
    expect(
      graph.nodes.find((node) => node.kind === "attachment")?.href
    ).toBeUndefined()
    expect(
      graph.nodes.find((node) => node.kind === "web")?.href
    ).toBeUndefined()
    conversation.replace(id, {
      ask: answered("a", "memory", {
        attachments: [{ ...file, channel_id: 7 }],
      }),
    })
    graph = buildMemoryMap(conversation.getSnapshot())
    expect(
      graph.nodes.find((node) => node.kind === "attachment")?.navigationState
    ).toEqual({ jumpTo: 45 })
  })

  it("只保留最近24題的地圖資料，舊題不留下孤立節點或關係", () => {
    const conversation = createConversation()
    for (let i = 0; i < 30; i++) {
      const id = conversation.addToolRun("knowledge", `問題${i}`)
      conversation.replace(id, { ask: answered(String(i)) })
    }
    const graph = buildMemoryMap(conversation.getSnapshot())
    expect(graph.total).toBe(30)
    expect(graph.shown).toBe(24)
    expect(graph.nodes.some((node) => node.id === "question:1")).toBe(false)
    const ids = new Set(graph.nodes.map((node) => node.id))
    expect(
      graph.links.every((edge) => ids.has(edge.source) && ids.has(edge.target))
    ).toBe(true)
    const run = conversation.getSnapshot().at(-1) as ToolRun
    expect(graph.latestId).toBe(`question:${run.id}`)
  })
})

import { isFinished, type AskKind } from "@/api/asks"
import type { Entry, ToolRun } from "@/ask/conversation"

export type MapNodeKind =
  | "root"
  | "topic"
  | "question"
  | "document"
  | "web"
  | "channel"
  | "memory"
  | "customer"
  | "result"
  | "attachment"
export type MapNode = {
  id: string
  kind: MapNodeKind
  label: string
  detail: string
  meta: string
  note?: string
  askKind?: AskKind
  runIds: number[]
  href?: string
  navigationState?: { jumpTo: number }
  active?: boolean
}
export type MapLink = { source: string; target: string; label: string }
export type MemoryMap = {
  nodes: MapNode[]
  links: MapLink[]
  latestId: string | null
  activeId: string | null
  total: number
  shown: number
}

export const MAP_KIND_LABEL: Record<MapNodeKind, string> = {
  root: "記憶中心",
  topic: "查詢類型",
  question: "問題",
  document: "公司文件",
  web: "網路資料",
  channel: "頻道",
  memory: "頻道記憶",
  customer: "客戶",
  result: "查詢結果",
  attachment: "附件",
}
export const MAP_COLOR: Record<MapNodeKind, string> = {
  root: "#9b51e0",
  topic: "#9298a3",
  question: "#007aff",
  document: "#249c89",
  web: "#279bbb",
  channel: "#bd8732",
  memory: "#bd8732",
  customer: "#9874c5",
  result: "#249c89",
  attachment: "#758baf",
}
export const QUERY_LABEL: Record<AskKind, string> = {
  data: "查數字",
  knowledge: "查規定",
  memory: "查頻道",
}
const STATUS_LABEL = {
  queued: "等待查詢",
  running: "正在查詢",
  answered: "已回答",
  no_evidence: "查無依據",
  not_converged: "找到部分依據",
  failed: "查詢失敗",
}
const STEP_LABEL = {
  attachment: "看附件",
  sql: "查數字",
  search: "檢索資料",
  rewrite: "調整問法",
  web: "搜尋網路",
  answer: "整理答案",
  stop: "停止查詢",
}

export function runStatus(run: ToolRun) {
  if (run.error) return "查詢失敗"
  if (run.cancelled) return "已停止使用結果"
  if (run.routing) return "正在判斷查詢範圍"
  if (run.choices) return "等待選擇查詢類型"
  return run.ask ? STATUS_LABEL[run.ask.status] : "送出查詢中"
}

/** Only relations present in the authorized query response are drawn; no inferred semantic links. */
export function buildMemoryMap(entries: Entry[]): MemoryMap {
  const all = entries.filter((entry): entry is ToolRun => entry.kind === "tool")
  const runs = all.slice(-24)
  const nodes = new Map<string, MapNode>()
  const links = new Map<string, MapLink>()
  function node(value: Omit<MapNode, "runIds">, runId?: number) {
    const existing = nodes.get(value.id)
    if (existing) {
      if (runId !== undefined && !existing.runIds.includes(runId))
        existing.runIds.push(runId)
    } else
      nodes.set(value.id, {
        ...value,
        runIds: runId === undefined ? [] : [runId],
      })
    return value.id
  }
  function link(source: string, target: string, label: string) {
    links.set(JSON.stringify([source, target]), { source, target, label })
  }
  const root = node({
    id: "conversation",
    kind: "root",
    label: "熊熊滾",
    meta: `${all.length} 題查詢`,
    detail:
      "問題與實際引用的資料會連在一起。共用同一份依據的問題，也會連到同一個節點。",
  })
  let activeId: string | null = null
  let previous: string | null = null
  for (const run of runs) {
    const id = `question:${run.id}`
    const active =
      !run.error &&
      !run.cancelled &&
      !run.choices &&
      (run.routing || !run.ask || !isFinished(run.ask))
    if (active) activeId = id
    const last = run.ask?.trace.at(-1)
    const status = runStatus(run)
    const parts = [run.question]
    if (run.original) parts.push(`原本的問法：${run.original}`)
    if (last)
      parts.push(`目前進度：${STEP_LABEL[last.step]} · ${last.decision}`)
    if (run.ask?.answer) parts.push(run.ask.answer)
    if (run.error || run.ask?.error_message)
      parts.push(run.error || run.ask?.error_message || "")
    node(
      {
        id,
        kind: "question",
        askKind: run.askKind ?? undefined,
        label: run.original || run.question || "尚未提供問題",
        meta: active && last ? `${status} · ${STEP_LABEL[last.step]}` : status,
        detail: parts.join("\n\n"),
        active,
      },
      run.id
    )
    if (run.askKind) {
      const topic = node(
        {
          id: `topic:${run.askKind}`,
          kind: "topic",
          label: QUERY_LABEL[run.askKind],
          meta: "查詢範圍",
          detail: {
            data: "公司數字、商品與客戶資料",
            knowledge: "公司文件與另行標示的網路公開資料",
            memory: "你有權查看的頻道重點與附件",
          }[run.askKind],
        },
        run.id
      )
      link(root, topic, "查詢範圍")
      link(topic, id, "提問")
    } else link(root, id, "判斷範圍")
    if (run.original && previous) link(previous, id, "接續查詢")
    previous = id

    for (const source of run.ask?.evidence?.sources ?? []) {
      const key =
        source.kind === "web"
          ? ["web", source.url || source.doc_title, source.section]
          : [
              "document",
              source.chunk_id ?? [
                source.source_name,
                source.doc_title,
                source.section,
                source.content,
              ],
            ]
      const sourceId = node(
        {
          id: JSON.stringify(key),
          kind: source.kind === "web" ? "web" : "document",
          label: source.doc_title || source.source_name || "引用資料",
          meta:
            source.section || (source.kind === "web" ? "網路出處" : "公司文件"),
          detail: source.content,
          href: externalUrl(source.url),
        },
        run.id
      )
      link(id, sourceId, "引用依據")
    }
    for (const item of run.ask?.evidence?.items ?? []) {
      const channel = node(
        {
          id: JSON.stringify(["channel", item.channel_name]),
          kind: "channel",
          label: item.channel_name,
          meta: "記憶來源頻道",
          detail: "這段對話引用了這個頻道的重點。",
        },
        run.id
      )
      const memory = node(
        {
          id: JSON.stringify([
            "memory",
            item.channel_name,
            item.date,
            item.category,
            item.text,
          ]),
          kind: "memory",
          label: item.text,
          meta: `${item.channel_name} · ${item.date}`,
          detail: item.text,
        },
        run.id
      )
      link(id, memory, "引用重點")
      link(memory, channel, "來自頻道")
    }
    for (const customer of run.ask?.customers ?? []) {
      const customerId = node(
        {
          id: `customer:${customer.id}`,
          kind: "customer",
          label: customer.name,
          meta: "查詢提到的客戶",
          detail: customer.name,
          href: `/customers/${encodeURIComponent(customer.id)}`,
        },
        run.id
      )
      link(id, customerId, "提到客戶")
    }
    const evidence = run.ask?.evidence
    if (evidence?.columns && evidence.rows) {
      const result = node(
        {
          id: `result:${run.id}`,
          kind: "result",
          label: `${evidence.rows.length} 筆查詢結果`,
          meta: evidence.columns.join("、"),
          detail: `欄位：${evidence.columns.join("、")}\n\n完整結果表可在這題的回答查看。`,
        },
        run.id
      )
      link(id, result, "查到的資料")
    }
    for (const file of evidence?.attachments ?? []) {
      const attachment = node(
        {
          id: `attachment:${file.attachment_id}`,
          kind: "attachment",
          label: file.filename,
          meta: `${file.channel_name} · ${file.date}`,
          detail: file.caption || file.filename,
        },
        run.id
      )
      link(id, attachment, "引用附件")
      // Shared-up evidence has no readable original channel. Do not invent a navigation target.
      if (file.channel_id !== null) {
        nodes.get(attachment)!.href = `/channels/${file.channel_id}`
        nodes.get(attachment)!.navigationState = { jumpTo: file.message_id }
      }
    }
  }
  return {
    nodes: [...nodes.values()],
    links: [...links.values()],
    latestId: runs.length ? `question:${runs.at(-1)!.id}` : null,
    activeId,
    total: all.length,
    shown: runs.length,
  }
}

function externalUrl(url?: string) {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined
  } catch {
    return undefined
  }
}

export function filterMemoryMap(
  graph: MemoryMap,
  scope: "all" | "current" | AskKind,
  search: string
): MemoryMap {
  const current = graph.activeId ?? graph.latestId
  const allowed = new Set(
    scope === "current"
      ? (graph.nodes.find((node) => node.id === current)?.runIds ?? [])
      : scope === "all"
        ? graph.nodes.flatMap((node) => node.runIds)
        : graph.nodes
            .filter(
              (node) => node.kind === "question" && node.askKind === scope
            )
            .flatMap((node) => node.runIds)
  )
  const scoped = graph.nodes.filter(
    (node) =>
      (node.kind === "root" && (allowed.size > 0 || scope === "all")) ||
      node.runIds.some((id) => allowed.has(id))
  )
  const query = search.trim().toLocaleLowerCase()
  const matches = new Set(
    scoped
      .filter(
        (node) =>
          !query ||
          `${node.label} ${node.meta} ${node.detail} ${node.note ?? ""}`
            .toLocaleLowerCase()
            .includes(query)
      )
      .map((node) => node.id)
  )
  // Search keeps one-hop context so a matching source still shows which question cited it.
  const ids = new Set(matches)
  if (query)
    for (const edge of graph.links)
      if (matches.has(edge.source) || matches.has(edge.target)) {
        ids.add(edge.source)
        ids.add(edge.target)
      }
  const visible = scoped.filter((node) => ids.has(node.id))
  const visibleIds = new Set(visible.map((node) => node.id))
  return {
    ...graph,
    nodes: visible,
    links: graph.links.filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)
    ),
  }
}

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  ArrowUpRight,
  Focus,
  Loader2,
  Network,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { Link } from "react-router"

import type { AskKind } from "@/api/asks"
import type { Entry } from "@/ask/conversation"
import {
  buildMemoryMap,
  filterMemoryMap,
  MAP_COLOR,
  MAP_KIND_LABEL,
  QUERY_LABEL,
  type MemoryMap,
  type MapNode,
} from "@/ask/memory-map"
import { applyMapEdits, type MapEditsStore } from "@/ask/memory-map-edits"
import type { MemoryMapScene } from "@/components/ask/memory-map-scene"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import "@/components/ask/memory-map.css"

type Scope = "all" | "current" | AskKind
const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "current", label: "這一題" },
  ...(["data", "knowledge", "memory"] as const).map((id) => ({
    id,
    label: QUERY_LABEL[id],
  })),
]

export function AskMemoryMap({
  entries,
  edits,
  onJump,
}: {
  entries: Entry[]
  edits: MapEditsStore
  onJump: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const changes = useSyncExternalStore(edits.subscribe, edits.getSnapshot)
  const original = useMemo(() => buildMemoryMap(entries), [entries])
  const graph = useMemo(
    () => applyMapEdits(original, changes),
    [original, changes]
  )
  const current = original.nodes.find(
    (node) => node.id === (original.activeId ?? original.latestId)
  )
  const jumping = useRef(false)
  function jump(id: number) {
    jumping.current = true
    setOpen(false)
    onJump(id)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="memory-map-entry mt-3 flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
        <Network className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {current?.label || "把查過的問題串起來"}
          </p>
          <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
            {current
              ? `${current.meta} · ${graph.total} 題查詢`
              : "問題、文件與頻道記憶的關聯"}
          </p>
        </div>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
            記憶地圖
            <span className="text-[0.625rem] text-muted-foreground">3D</span>
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent
        showCloseButton={false}
        className="memory-map-dialog"
        onCloseAutoFocus={(event) => {
          if (jumping.current) {
            event.preventDefault()
            jumping.current = false
          }
        }}
      >
        <div className="memory-map-header flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <DialogTitle className="flex items-center gap-2 text-lg">
              記憶地圖
            </DialogTitle>
            <DialogDescription className="mt-2 text-xs">
              每一個問題，都有它的脈絡。
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="關閉記憶地圖">
              <X className="size-5" />
            </Button>
          </DialogClose>
        </div>
        {open && (
          <MapExplorer
            graph={graph}
            edits={edits}
            onJump={jump}
            onNavigate={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function MapExplorer({
  graph,
  edits,
  onJump,
  onNavigate,
}: {
  graph: MemoryMap
  edits: MapEditsStore
  onJump: (id: number) => void
  onNavigate: () => void
}) {
  const [scope, setScope] = useState<Scope>("all")
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ id: string; label: string } | null>(
    null
  )
  const changes = useSyncExternalStore(edits.subscribe, edits.getSnapshot)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLElement>(null)
  const runtime = useRef<MemoryMapScene | null>(null)
  const visible = useMemo(
    () => filterMemoryMap(graph, scope, search),
    [graph, scope, search]
  )
  const desired = picked ?? graph.activeId ?? graph.latestId ?? "conversation"
  const selected =
    visible.nodes.find((node) => node.id === desired) ??
    visible.nodes.find((node) => node.kind === "question") ??
    visible.nodes[0]
  const snapshot = useRef({ graph: visible, selected: selected?.id ?? null })

  useEffect(() => {
    snapshot.current = { graph: visible, selected: selected?.id ?? null }
    runtime.current?.sync(visible, selected?.id ?? null)
  }, [visible, selected?.id])

  useEffect(() => {
    let disposed = false
    let scene: MemoryMapScene | null = null
    const element = host.current
    void import("@/components/ask/memory-map-scene")
      .then(({ createMemoryMapScene }) => {
        if (disposed || !element) return
        try {
          scene = createMemoryMapScene(element, setPicked, () => {
            scene?.dispose()
            runtime.current = null
            setFailed(true)
          })
          runtime.current = scene
          scene.sync(snapshot.current.graph, snapshot.current.selected)
          setReady(true)
        } catch {
          scene?.dispose()
          runtime.current = null
          setFailed(true)
        }
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true)
          setLoadFailed(true)
        }
      })
    return () => {
      disposed = true
      scene?.dispose()
      runtime.current = null
    }
  }, [attempt])

  const relations = selected
    ? visible.links.flatMap((edge) => {
        const otherId =
          edge.source === selected.id
            ? edge.target
            : edge.target === selected.id
              ? edge.source
              : null
        const node = visible.nodes.find((node) => node.id === otherId)
        return node ? [{ node, label: edge.label }] : []
      })
    : []
  const current = graph.nodes.find(
    (node) => node.id === (graph.activeId ?? graph.latestId)
  )

  return (
    <>
      <div className="memory-map-toolbar flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div
          className="memory-map-segmented flex flex-wrap gap-1"
          aria-label="地圖範圍"
        >
          {SCOPES.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={scope === item.id}
              onClick={() => setScope(item.id)}
              className={cn(
                "min-h-9 rounded-lg px-3 text-xs font-medium",
                scope === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="memory-map-search ml-auto flex min-w-0 items-center gap-2 rounded-lg border bg-background px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            aria-label="搜尋地圖節點"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="找問題或資料…"
            className="h-9 w-36 min-w-0 bg-transparent text-xs outline-none"
          />
        </label>
      </div>
      <div className="memory-map-body">
        <div className="memory-map-visual">
          <div className="memory-map-overview" aria-hidden="true">
            <span>對話中的脈絡</span>
            <strong>
              {graph.nodes.filter((node) => node.kind === "question").length}{" "}
              <small>個問題</small>
              <i />
              {
                graph.nodes.filter(
                  (node) => !["question", "root", "topic"].includes(node.kind)
                ).length
              }{" "}
              <small>份線索</small>
            </strong>
          </div>
          <div className="memory-map-current">
            <span
              className={cn(
                "memory-map-status-dot",
                graph.activeId && "is-live"
              )}
            />
            <div className="min-w-0">
              <span>{current?.meta || "你的查詢線索"}</span>
              <strong>
                {current?.label ||
                  (graph.total
                    ? "選取線索，查看內容與關聯"
                    : "問一題，地圖就會長出第一條關聯")}
              </strong>
            </div>
            {graph.latestId && (
              <button
                type="button"
                onClick={() => {
                  setPicked(null)
                  setScope("current")
                  setSearch("")
                }}
                aria-label="聚焦目前查詢"
              >
                <Focus className="size-4" />
              </button>
            )}
          </div>
          <div
            ref={host}
            tabIndex={0}
            role="group"
            aria-label="3D 記憶關聯圖；拖曳或方向鍵旋轉，滾輪、雙指或加減鍵縮放"
            className={cn("memory-map-canvas", failed && "is-unavailable")}
          />
          {(!ready || failed || !graph.total || !visible.nodes.length) && (
            <div className="memory-map-message" role="status">
              {failed ? (
                <>
                  <Network className="size-8" />
                  <p>
                    {loadFailed
                      ? "3D 地圖載入失敗。重新整理會清空這段對話。"
                      : "這個裝置暫時無法顯示 3D 地圖。"}
                  </p>
                  <p>仍可從節點清單查看問題與依據。</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (loadFailed) {
                        window.location.reload()
                        return
                      }
                      setFailed(false)
                      setReady(false)
                      setAttempt((value) => value + 1)
                    }}
                  >
                    {loadFailed ? "重新整理" : "重試 3D"}
                  </Button>
                </>
              ) : !ready ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  <p>展開記憶地圖…</p>
                </>
              ) : !graph.total ? (
                <>
                  <Network className="size-9" />
                  <p>從一個問題開始</p>
                  <p>查詢後，問題與引用資料會自動連起來。</p>
                </>
              ) : (
                <>
                  <Search className="size-7" />
                  <p>這個範圍沒有符合的節點。</p>
                </>
              )}
            </div>
          )}
          <div className="memory-map-controls">
            <span>拖移探索 · 縮放查看</span>
            <div>
              <button
                type="button"
                disabled={!ready || failed}
                onClick={() => runtime.current?.zoom(1.15)}
                aria-label="縮小地圖"
              >
                <ZoomOut className="size-4" />
              </button>
              <button
                type="button"
                disabled={!ready || failed}
                onClick={() => runtime.current?.reset()}
                aria-label="重設地圖視角"
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                disabled={!ready || failed}
                onClick={() => runtime.current?.zoom(0.85)}
                aria-label="放大地圖"
              >
                <ZoomIn className="size-4" />
              </button>
            </div>
          </div>
          <div className="memory-map-legend">
            {["question", "document", "memory", "customer", "web"].map(
              (kind) => (
                <span key={kind}>
                  <i
                    style={{
                      background: MAP_COLOR[kind as keyof typeof MAP_COLOR],
                    }}
                  />
                  {MAP_KIND_LABEL[kind as keyof typeof MAP_KIND_LABEL]}
                </span>
              )
            )}
          </div>
        </div>
        <aside ref={detail} className="memory-map-detail" aria-label="節點內容">
          {selected ? (
            <>
              <div className="memory-map-detail-actions">
                <span>已選取</span>
                <div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="編輯節點"
                    onClick={() => setEditingId(selected.id)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="刪除節點"
                    onClick={() => {
                      setRemoved({ id: selected.id, label: selected.label })
                      edits.remove(selected.id)
                      setPicked(null)
                      setEditingId(null)
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              {editingId === selected.id ? (
                <NodeEditor
                  key={selected.id}
                  node={selected}
                  onCancel={() => setEditingId(null)}
                  onSave={(label, note) => {
                    edits.edit(selected.id, label, note)
                    setEditingId(null)
                    requestAnimationFrame(() =>
                      detail.current?.scrollTo({ top: 0 })
                    )
                  }}
                />
              ) : (
                <>
                  <p className="text-[0.6875rem] font-medium text-primary">
                    {MAP_KIND_LABEL[selected.kind]} · {selected.meta}
                  </p>
                  <h2 className="mt-2 text-base leading-relaxed font-semibold break-words">
                    {selected.label}
                  </h2>
                  {selected.note && (
                    <div className="memory-map-note">
                      <span>我的筆記</span>
                      <p>{selected.note}</p>
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-6 break-words whitespace-pre-line text-muted-foreground">
                    {selected.detail}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selected.runIds.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onJump(selected.runIds.at(-1)!)}
                      >
                        回看這題
                        <ArrowUpRight className="size-3.5" />
                      </Button>
                    )}
                    {selected.href &&
                      (selected.href.startsWith("/") ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            to={selected.href}
                            state={selected.navigationState}
                            onClick={onNavigate}
                          >
                            開啟
                            {selected.kind === "customer" ? "客戶" : "來源頻道"}
                            <ArrowUpRight className="size-3.5" />
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={selected.href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            開啟出處
                            <ArrowUpRight className="size-3.5" />
                          </a>
                        </Button>
                      ))}
                  </div>
                </>
              )}
              {relations.length > 0 && (
                <div className="memory-map-relations mt-5 border-t pt-4">
                  <h3 className="mb-2 text-xs font-medium">
                    {relations.length} 個關聯
                  </h3>
                  <div className="flex flex-col gap-1">
                    {relations.map(({ node, label }) => (
                      <button
                        type="button"
                        key={`${node.id}:${label}`}
                        onClick={() => setPicked(node.id)}
                        className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted"
                      >
                        <i
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: MAP_COLOR[node.kind] }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {node.label}
                        </span>
                        <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              換個範圍或關鍵字看看。
            </p>
          )}
          <details className="mt-5 border-t pt-3" open={failed || undefined}>
            <summary className="min-h-8 cursor-pointer text-xs text-muted-foreground">
              節點清單（{visible.nodes.length}）
            </summary>
            <div className="mt-2 flex flex-col gap-1">
              {visible.nodes.map((node) => (
                <button
                  type="button"
                  key={node.id}
                  aria-pressed={node.id === selected?.id}
                  onClick={() => setPicked(node.id)}
                  className={cn(
                    "min-h-9 rounded-lg px-2 py-2 text-left text-xs",
                    node.id === selected?.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  )}
                >
                  <span className="mr-2 text-[0.625rem] text-muted-foreground">
                    {MAP_KIND_LABEL[node.kind]}
                  </span>
                  {node.label}
                </button>
              ))}
            </div>
          </details>
        </aside>
      </div>
      {removed && (
        <div className="memory-map-undo" role="status">
          <span>已從地圖刪除「{removed.label}」</span>
          <button
            type="button"
            onClick={() => {
              edits.restore(removed.id)
              setPicked(removed.id)
              setRemoved(null)
            }}
          >
            <Undo2 className="size-3.5" />
            復原
          </button>
        </div>
      )}
      <div className="memory-map-footer border-t px-4 py-3 text-[0.6875rem] text-muted-foreground">
        <p>
          {graph.total > graph.shown ? `顯示最近 ${graph.shown} 題。` : ""}
          地圖與筆記保留於這段對話 · 重新整理會清空
        </p>
        {changes.deleted.length > 0 && (
          <button
            type="button"
            onClick={() => {
              edits.restore()
              setRemoved(null)
            }}
          >
            還原已刪除的 {changes.deleted.length} 個節點
          </button>
        )}
      </div>
    </>
  )
}

function NodeEditor({
  node,
  onSave,
  onCancel,
}: {
  node: MapNode
  onSave: (label: string, note: string) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(node.label)
  const [note, setNote] = useState(node.note ?? "")
  return (
    <form
      className="memory-map-editor"
      onSubmit={(event) => {
        event.preventDefault()
        if (label.trim()) onSave(label, note)
      }}
    >
      <h2>編輯節點</h2>
      <label>
        名稱
        <input
          autoFocus
          value={label}
          maxLength={80}
          required
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label>
        我的筆記
        <textarea
          value={note}
          maxLength={1200}
          rows={5}
          placeholder="記下你的想法或下一步…"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <p>名稱與筆記顯示在地圖，引用原文保留於原回答。</p>
      <div>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={!label.trim()}>
          儲存變更
        </Button>
      </div>
    </form>
  )
}

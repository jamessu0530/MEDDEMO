import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  ArrowUpRight,
  ChevronRight,
  Focus,
  List,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut,
} from "@/components/icons"
import { Link } from "react-router"

import type { Entry } from "@/ask/conversation"
import {
  buildMemoryMap,
  filterMemoryMap,
  MAP_COLOR,
  MAP_KIND_LABEL,
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
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import "@/components/ask/memory-map.css"

export function AskMemoryMap({
  entries,
  edits,
  onJump,
  compact = false,
}: {
  entries: Entry[]
  edits: MapEditsStore
  onJump: (id: number) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const questionCount = entries.filter((entry) => entry.kind === "tool").length
  const page = Math.min(historyPage, Math.max(0, Math.ceil(questionCount / 24) - 1))
  const changes = useSyncExternalStore(edits.subscribe, edits.getSnapshot)
  const original = useMemo(() => buildMemoryMap(entries, page * 24), [entries, page])
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
      {compact ? (
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <Waypoints
              aria-hidden
              className="size-5 shrink-0 text-muted-foreground"
            />
            <span className="flex-1 font-medium">記憶地圖</span>
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          </button>
        </DialogTrigger>
      ) : (
        <div className="memory-map-entry mt-3 flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
          <Waypoints
            className="size-5 shrink-0 text-primary"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">
              {current?.label || "把查過的問題串起來"}
            </p>
          </div>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
              記憶地圖
              <span className="text-xs text-muted-foreground">3D</span>
            </Button>
          </DialogTrigger>
        </div>
      )}
      <DialogContent aria-describedby={undefined}
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
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="關閉記憶地圖">
              <X className="size-5" />
            </Button>
          </DialogClose>
        </div>
        {questionCount > 24 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-2 text-xs">
            <span>共 {questionCount} 題記憶 · 第 {page + 1} / {Math.ceil(questionCount / 24)} 頁</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setHistoryPage(page - 1)}>較新的記憶</Button>
              <Button variant="ghost" size="sm" disabled={(page + 1) * 24 >= questionCount} onClick={() => setHistoryPage(page + 1)}>較早的記憶</Button>
            </div>
          </div>
        )}
        {open && (
          <MapExplorer
            key={page}
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
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
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
    () => filterMemoryMap(graph, "all", search),
    [graph, search]
  )
  const selected = visible.nodes.find((node) => node.id === picked)
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
          scene = createMemoryMapScene(
            element,
            (id) => {
              setPicked(id)
              setDetailOpen(true)
            },
            () => {
              scene?.dispose()
              runtime.current = null
              setFailed(true)
              setDetailOpen(true)
            },
            () => setReady(true)
          )
          runtime.current = scene
          scene.sync(snapshot.current.graph, snapshot.current.selected)
        } catch {
          scene?.dispose()
          runtime.current = null
          setFailed(true)
          setDetailOpen(true)
        }
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true)
          setLoadFailed(true)
          setDetailOpen(true)
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
      <div className="memory-map-toolbar">
        <label className="memory-map-search flex min-w-0 items-center gap-2 px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            aria-label="搜尋地圖節點"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="找問題或資料…"
            className="h-9 w-36 min-w-0 bg-transparent text-base outline-none"
          />
          {search && (
            <button
              type="button"
              aria-label="清除搜尋"
              onClick={() => setSearch("")}
            >
              <X className="size-4" />
            </button>
          )}
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDetailOpen((value) => !value)}
          aria-expanded={detailOpen}
          aria-controls="memory-map-detail"
        >
          <List className="size-4" aria-hidden="true" />
          節點清單
        </Button>
      </div>
      <div
        className={cn(
          "memory-map-body",
          detailOpen && "has-detail",
          failed && "is-failed"
        )}
      >
        <div className="memory-map-visual">
          <div className="memory-map-status">
            <span
              className={cn(
                "memory-map-status-dot",
                graph.activeId && "is-live"
              )}
            />
            <span className="memory-map-status-text">
              {graph.activeId && current
                ? `${current.meta} · ${current.label}`
                : `${graph.nodes.filter((node) => node.kind === "question").length} 個問題 · ${graph.nodes.filter((node) => !["question", "root", "topic"].includes(node.kind)).length} 份線索`}
            </span>
            {current && (
              <button
                type="button"
                onClick={() => {
                  setPicked(current.id)
                  setSearch("")
                  runtime.current?.sync(graph, current.id)
                  runtime.current?.focus(current.id)
                }}
                aria-label="聚焦目前查詢"
              >
                <Focus className="size-4" />
              </button>
            )}
          </div>
          <div className="memory-map-stage">
            <div
              ref={host}
              tabIndex={0}
              role="group"
              aria-label="3D 記憶關聯圖；拖曳或方向鍵旋轉，滾輪、雙指或加減鍵縮放"
              className={cn(
                "memory-map-canvas",
                (failed || !graph.total || !visible.nodes.length) &&
                  "is-unavailable"
              )}
            />
            {(!ready || failed || !graph.total || !visible.nodes.length) && (
              <div className="memory-map-message" role="status">
                {failed ? (
                  <>
                    <Waypoints className="size-8" aria-hidden="true" />
                    <p>
                      {loadFailed
                        ? "3D 地圖載入失敗，請重新整理後再試。帳號記憶會保留。"
                        : "這個裝置暫時無法顯示 3D 地圖。"}
                    </p>
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
                    <span className="memory-map-empty-icon" aria-hidden="true">
                      <Waypoints className="size-8" strokeWidth={1.5} />
                    </span>
                    <p>從一個問題開始</p>
                  </>
                ) : (
                  <>
                    <Search className="size-7" />
                    <p>找不到符合的問題或資料</p>
                    <button type="button" onClick={() => setSearch("")}>
                      清除搜尋，回到完整網絡
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="memory-map-bottom">
            <div className="memory-map-legend" aria-label="節點顏色說明">
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
            <div className="memory-map-controls">
              <div>
                <button
                  type="button"
                  disabled={
                    !ready || failed || !graph.total || !visible.nodes.length
                  }
                  onClick={() => runtime.current?.zoom(1.15)}
                  aria-label="縮小地圖"
                >
                  <ZoomOut className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={
                    !ready || failed || !graph.total || !visible.nodes.length
                  }
                  onClick={() => runtime.current?.reset()}
                  aria-label="重設地圖視角"
                >
                  <RotateCcw className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={
                    !ready || failed || !graph.total || !visible.nodes.length
                  }
                  onClick={() => runtime.current?.zoom(0.85)}
                  aria-label="放大地圖"
                >
                  <ZoomIn className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
        {detailOpen && (
          <aside
            ref={detail}
            id="memory-map-detail"
            className="memory-map-detail"
            aria-label="節點內容"
          >
            <div className="memory-map-detail-heading">
              <span>{selected ? "節點內容" : "節點清單"}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="關閉節點內容"
                onClick={() => {
                  setDetailOpen(false)
                  setEditingId(null)
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
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
                    <p className="text-xs font-medium text-primary">
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
                              {selected.kind === "customer"
                                ? "客戶"
                                : "來源頻道"}
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
                    <h3 className="mb-2 text-sm font-medium">
                      {relations.length} 個關聯
                    </h3>
                    <div className="flex flex-col gap-1">
                      {relations.map(({ node, label }) => (
                        <button
                          type="button"
                          key={`${node.id}:${label}`}
                          onClick={() => setPicked(node.id)}
                          className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
                        >
                          <i
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: MAP_COLOR[node.kind] }}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {node.label}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              null
            )}
            <details
              className="mt-5 border-t pt-3"
              open={failed || !selected || undefined}
            >
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
                    <span className="mr-2 text-xs text-muted-foreground">
                      {MAP_KIND_LABEL[node.kind]}
                    </span>
                    {node.label}
                  </button>
                ))}
              </div>
            </details>
          </aside>
        )}
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
      {changes.deleted.length > 0 && (
        <div className="memory-map-footer border-t px-4 py-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => {
              edits.restore()
              setRemoved(null)
            }}
          >
            還原已刪除的 {changes.deleted.length} 個節點
          </button>
        </div>
      )}
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

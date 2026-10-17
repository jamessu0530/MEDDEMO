import { useAskPageContext } from "@/ask/use-page-context"
import { useReportAssistant } from "@/ask/use-report-assistant"
import { ReportPageTooltip } from "@/components/reports/report-page-tooltip"
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react"
import {
  Download,
  Ellipsis,
  FileChartColumn,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from "@/components/icons"
import { CSS } from "@dnd-kit/utilities"
import { useReportCardDrag } from "@/components/reports/use-report-card-drag"
import { createReportSaveQueue } from "@/lib/report-autosave"
import { ApiError } from "@/api/client"

import {
  getReportData,
  getReportFilterOptions,
  getReports,
  saveReportConfig,
  saveReportDocument,
  type ReportWorkspace,
} from "@/api/reports"
import {
  loadReportProgressively,
  visibleReportCardIds,
} from "@/lib/report-load"
import { Notice } from "@/components/notice"
import { BottomNav } from "@/components/bottom-nav"

import { PageHeader } from "@/components/page-header"
import { ReportChart } from "@/components/reports/report-chart"
import { useReportWidgetSize } from "@/components/reports/use-report-widget-size"
import { ReportDocumentControls } from "@/components/reports/report-document-controls"
import { ReportExportDialog } from "@/components/reports/report-export"
import { ReportRefreshControls } from "@/components/reports/report-refresh"
import { ReportSheet } from "@/components/reports/report-sheet"
import "@/components/reports/report-workspace.css"
import { ReportDatasetLauncher } from "@/components/reports/report-datasets"
import { ReportDataFields } from "@/components/reports/report-fields"
import { ReportRibbon } from "@/components/reports/report-ribbon"
import {
  StudioVisual,
  StudioLayers,
  StudioObjectInspector,
} from "@/components/reports/report-objects"
import { ReportFilterPane } from "@/components/reports/report-filter-pane"
import {
  assignReportField,
  canvasQuerySelections,
  commitStudioLayout,
  createDatasetObject,
  createStudioObject,
  pruneStudioReferences,
  placeStudioObject,
  safeStudioExploration,
  studioLayoutConfig,
  updateCanvasSelection,
  type FieldRole,
  type StudioAction,
  type StudioExploration,
  type StudioField,
  type StudioObject,
  type StudioSelections,
} from "@/lib/report-studio"
import { getDataSource, type DataSource } from "@/api/report-datasets"
import { useReportDraft } from "@/components/reports/use-report-draft"
import {
  applyReportBookmark,
  editReportDraft,
  undoReportDraft,
  redoReportDraft,
  type ReportDraftHistory,
  type ReportLibrarySnapshot,
} from "@/lib/report-documents"
import {
  ReportLayoutCanvas,
  type ReportLayoutRender,
} from "@/components/reports/report-layout"
import { setMobileReportLayout } from "@/lib/report-layout"
import { ReportDetailsDialog } from "@/components/reports/report-details"
import { ReportExploreControls } from "@/components/reports/report-explore-controls"
import {
  ReportDateRangeEditor,
  ReportFilterChips,
  ReportPeriodEditor,
  ReportSlicerEditor,
} from "@/components/reports/report-filters"
import {
  ReportInspector,
  ReportVisualGallery,
} from "@/components/reports/report-inspector"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { homePath, useAuth } from "@/lib/auth"
import { matrixRenderKey } from "@/lib/report-matrix"
import { formatDate } from "@/lib/format"
import {
  drillDown,
  drillReset,
  drillUp,
  resolveReportPointAction,
  reportExploreQuery,
  type ReportDrills,
  type ReportDrillState,
  type ReportPointAction,
} from "@/lib/report-drill"
import {
  emptyFilterOptions,
  reportPeriodRange,
  setReportSlicer,
} from "@/lib/report-filters"
import {
  DIMENSIONS,
  METRICS,
  PERIODS,
  VISUALS,
  moveReportCard,
  normalizeCard,
  normalizeReportConfig,
  reportDataKey,
  reportPages,
  pruneReportSelections,
  selectionPointKey,
  toggleReportSelection,
  type CardData,
  type ReportCard,
  type ReportConfig,
  type ReportData,
  type ReportFilter,
  type ReportFilterOptions,
  type ReportPage,
  type ReportPeriod,
  type ReportVisual,
  type ReportSelectionGroup,
  type ReportSelectionPoint,
  type ReportDateDimension,
  type ReportQuery,
  type ReportMatrixView,
} from "@/lib/reports"
import { useIsDesktop } from "@/lib/use-media-query"
import { useReportWorkspaceLayout } from "@/lib/report-workspace-layout"
import { cn } from "@/lib/utils"
import { uiDemo } from "@/lib/ui-demo-browser"

type Boot =
  | { status: "ready"; workspace: ReportWorkspace }
  | { status: "error"; message: string }
type Snapshot =
  | {
      key: string
      attempt: number
      status: "ready"
      data: ReportData
      pending?: boolean
      message?: string
      matrixKeys?: Record<string, string>
    }
  | { key: string; attempt: number; status: "error"; message: string }

export function ReportsPage() {
  const user = useAuth()?.user
  const [boot, setBoot] = useState<Boot | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    // Activity 恢復效果時沿用已載入的工作區，只有初次進入或重試才讀取。
    if (boot) return
    const controller = new AbortController()
    getReports(controller.signal)
      .then((workspace) => {
        if (!controller.signal.aborted) setBoot({ status: "ready", workspace })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setBoot({
            status: "error",
            message:
              error instanceof Error ? error.message : "報表暫時載入不了",
          })
      })
    return () => controller.abort()
  }, [attempt, boot])

  if (!user) return null
  const primaryNavigation = user.role === "sales"
  if (boot?.status === "ready")
    return (
      <>
        <ReportCanvas
          key={user.id}
          workspace={boot.workspace}
          backTo={homePath(user.role)}
          primaryNavigation={primaryNavigation}
        />
        {primaryNavigation && <BottomNav />}
      </>
    )
  return (
    <div className="min-h-svh pb-24 lg:pb-0">
      <PageHeader
        title={primaryNavigation ? "報表" : "我的報表"}
        hideTitle
        backTo={primaryNavigation ? undefined : homePath(user.role)}
      />
      <main className="p-4">
        {boot?.status === "error" ? (
          <Notice
            text={boot.message}
            action={{
              label: "重新載入",
              onClick: () => {
                setBoot(null)
                setAttempt((n) => n + 1)
              },
            }}
          />
        ) : (
          <p
            className="py-16 text-center text-sm text-muted-foreground"
            role="status"
          >
            正在準備你的報表…
          </p>
        )}
      </main>
      {primaryNavigation && <BottomNav />}
    </div>
  )
}

export function ReportCanvas({
  workspace,
  backTo,
  primaryNavigation = false,
}: {
  workspace: ReportWorkspace
  backTo: string
  primaryNavigation?: boolean
}) {
  const [activeWorkspace, setActiveWorkspace] = useState(workspace)
  return (
    <ReportDocument
      key={activeWorkspace.active_report_id ?? "report-default"}
      workspace={activeWorkspace}
      backTo={backTo}
      primaryNavigation={primaryNavigation}
      onOpen={(snapshot) =>
        setActiveWorkspace((current) => ({ ...current, ...snapshot }))
      }
    />
  )
}

function ReportDocument({
  workspace,
  backTo,
  primaryNavigation,
  onOpen,
}: {
  workspace: ReportWorkspace
  backTo: string
  primaryNavigation: boolean
  onOpen: (snapshot: ReportLibrarySnapshot) => void
}) {
  const isDesktop = useIsDesktop()
  const [{ config, history, future }, setDraft] = useState<ReportDraftHistory>({
    config: workspace.config,
    history: [],
    future: [],
  })
  const [library, setLibrary] = useState<ReportLibrarySnapshot>(() => ({
    config: workspace.config,
    account_id: workspace.account_id ?? "",
    active_report_id: workspace.active_report_id ?? "report-default",
    revision: workspace.revision ?? 1,
    documents: workspace.documents ?? [
      {
        id: "report-default",
        name: workspace.config.name,
        revision: 1,
        updated_at: "1970-01-01T00:00:00Z",
      },
    ],
    bookmarks: workspace.bookmarks ?? [],
    readonly: workspace.readonly,
    shared_from: workspace.shared_from,
  }))
  const [savedKey, setSavedKey] = useState(() =>
    JSON.stringify(workspace.config)
  )
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const completedLoad = useRef<{
    key: string
    attempt: number
    data: ReportData
  } | null>(null)
  const [loadedFilterOptions, setLoadedFilterOptions] = useState(
    workspace.filter_options
  )
  const [retry, setRetry] = useState(0)
  const readonly = library.readonly === true
  const [inspecting, setInspecting] = useState(false)
  const editing = !readonly && inspecting
  const setEditing = setInspecting
  const [toolsOpen, setToolsOpen] = useState(false)
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null)
  const [lastAsOf, setLastAsOf] = useState(workspace.as_of)
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      workspace.config.cards.find((card) => card.visual !== "kpi")?.id ??
      workspace.config.cards[0]?.id ??
      null
  )
  const [pageId, setPageId] = useState(
    () => reportPages(workspace.config)[0].id
  )
  const [mobileInspector, setMobileInspector] = useState(false)
  const [gallery, setGallery] = useState(false)
  const [pageSettings, setPageSettings] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [studioPanels, setStudioPanels] = useState({
    data: true,
    filters: false,
    layers: false,
  })
  const {
    ref: workspaceRef,
    canvasRef,
    fitsPanels,
  } = useReportWorkspaceLayout(studioPanels.data)
  const dockedPanels = isDesktop && fitsPanels
  const [datasetEpoch, setDatasetEpoch] = useState(0)
  const [studioSelection, setStudioSelection] = useState<string[]>([])
  const [canvasValues, setCanvasValues] = useState<StudioSelections>({})
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  const [navigation, setNavigation] = useState<{
    page: string | null
    filters: ReportFilter[]
  }>({ page: null, filters: [] })
  const [navigationStack, setNavigationStack] = useState<
    { pageId: string; state: StudioExploration }[]
  >([])
  const [filterScope, setFilterScope] = useState<"report" | "page">("report")
  const [selectionGroups, setSelectionGroups] = useState<
    ReportSelectionGroup[]
  >([])
  const [multipleSelection, setMultipleSelection] = useState(false)
  const [exportView, setExportView] = useState<{ cardId?: string } | null>(null)
  const [drills, setDrills] = useState<ReportDrills>({})
  const [matrixViews, setMatrixViews] = useState<
    Record<string, ReportMatrixView>
  >({})
  const [tooltip, setTooltip] = useState<{
    pageId: string
    point: ReportSelectionPoint
  } | null>(null)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    },
    []
  )
  const [pointActions, setPointActions] = useState<
    Record<string, ReportPointAction>
  >({})
  const [detailView, setDetailView] = useState<{
    config: ReportQuery
    card: ReportCard
    point?: ReportSelectionPoint
  } | null>(null)
  useEffect(() => {
    let preparedRun = 0
    const prepare = () => {
      const demo = uiDemo.getSnapshot()
      if (
        demo.status !== "running" ||
        demo.kind !== "report-tour" ||
        demo.runId === preparedRun
      )
        return
      preparedRun = demo.runId
      setToolsOpen(false)
      setFiltersOpen(false)
      setMobileInspector(false)
      setGallery(false)
      setPageSettings(false)
      setExportView(null)
      setDetailView(null)
      setTooltip(null)
    }
    prepare()
    return uiDemo.subscribe(prepare)
  }, [])
  const [saving, setSaving] = useState(false)
  const [autosaveError, setAutosaveError] = useState("")
  const [autosavePaused, setAutosavePaused] = useState(false)
  const [saveAttempt, setSaveAttempt] = useState(0)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null
  )
  const pages = reportPages(config)
  const currentPage = pages.find((page) => page.id === pageId) ?? pages[0]
  const pageCards = config.cards.filter(
    (card) => (card.page_id ?? "overview") === currentPage.id
  )
  const selected = pageCards.find((card) => card.id === selectedId) ?? null
  const pageObjects = (config.objects ?? []).filter(
    (object) => object.page_id === currentPage.id
  )
  const selectedObject =
    pageObjects.find((object) => object.id === selectedId) ?? null
  const activeSelection =
    selectedId && studioSelection.includes(selectedId)
      ? studioSelection
      : selectedId
        ? [selectedId]
        : []
  const layoutConfig = studioLayoutConfig({
    ...config,
    cards: config.cards.map((card) => ({
      ...card,
      hidden: visibility[card.id] ?? card.hidden,
    })),
    objects: (config.objects ?? []).map((object) => ({
      ...object,
      hidden: visibility[object.id] ?? object.hidden,
    })),
  })
  const queryConfig = useMemo(
    () => ({
      ...reportExploreQuery(config, drills, selectionGroups),
      matrix_views: matrixViews,
      canvas_selections: canvasQuerySelections(config, canvasValues),
      navigation_page: navigation.page,
      navigation_filters: navigation.filters,
    }),
    [config, drills, selectionGroups, matrixViews, canvasValues, navigation]
  )
  const visibleQuery = useMemo(() => {
    const availablePages = reportPages(config)
    const activePage =
      availablePages.find((page) => page.id === pageId) ?? availablePages[0]
    return {
      ...queryConfig,
      requested_card_ids: visibleReportCardIds(
        config,
        activePage.id,
        visibility,
        editing
      ),
    }
  }, [queryConfig, config, pageId, visibility, editing])
  const queryKey = reportDataKey(visibleQuery)
  const dirty = !readonly && JSON.stringify(config) !== savedKey
  const ready =
    snapshot?.key === queryKey &&
    snapshot.attempt === retry &&
    snapshot.status === "ready"
      ? snapshot.data
      : null
  const error =
    snapshot?.key === queryKey &&
    snapshot.attempt === retry &&
    (snapshot.status === "error" || snapshot.message)
      ? snapshot.message
      : null
  const loading =
    !error &&
    (!ready || (snapshot?.status === "ready" && snapshot.pending === true))
  const cardLoading = (id: string) =>
    loading && !ready?.cards.some((card) => card.id === id)
  const cardData = (id: string) => {
    const current = ready?.cards.find((card) => card.id === id)
    if (current || snapshot?.status !== "ready") return current
    const key = matrixRenderKey(queryConfig, id)
    return key && snapshot.matrixKeys?.[id] === key
      ? snapshot.data.cards.find((card) => card.id === id)
      : undefined
  }
  const asOf = lastAsOf
  const dateFallback = asOf
    ? reportPeriodRange(config.period, asOf, config.date_range)
    : { start: "", end: "" }
  useAskPageContext({
    title: `${config.name} · ${currentPage.name}`,
    facts: [
      `報表：${config.name}`,
      `報表分頁：${currentPage.name}`,
      `期間：${config.period}`,
      `資料基準日：${asOf}`,
      `日期範圍：${dateFallback.start} 至 ${dateFallback.end}`,
      ...(currentPage.date_range
        ? [`頁面日期範圍：${JSON.stringify(currentPage.date_range)}`]
        : []),
      `報表篩選：${JSON.stringify(config.filters ?? [])}`,
      `頁面篩選：${JSON.stringify(currentPage.filters ?? [])}`,
      `選取條件：${JSON.stringify(selectionGroups)}`,
      `業務編號：${config.owner_id ?? "未指定"}`,
      `客戶類型：${config.customer_type ?? "全部"}`,
      `導覽篩選：${JSON.stringify(queryConfig.navigation_filters ?? [])}`,
      `切片器選取：${JSON.stringify(queryConfig.canvas_selections ?? [])}`,
      ...(selected
        ? [
            `選取圖表：${selected.title}`,
            `圖表指標：${selected.metric}；分類：${selected.dimension}`,
            `圖表篩選：${JSON.stringify(selected.filters ?? [])}`,
          ]
        : []),
    ],
  })

  const filterOptions = loadedFilterOptions ?? {
    ...emptyFilterOptions(),
    owner: workspace.owners.map((owner) => ({
      key: owner.id,
      label: owner.name,
    })),
  }
  useEffect(() => {
    if (workspace.filter_options || loadedFilterOptions) return
    const controller = new AbortController()
    getReportFilterOptions(controller.signal)
      .then((options) => {
        if (!controller.signal.aborted) setLoadedFilterOptions(options)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setNotice({
            text: err instanceof Error ? err.message : "篩選選項暫時載入不了",
            error: true,
          })
      })
    return () => controller.abort()
  }, [workspace.filter_options, loadedFilterOptions, retry])
  const reportLegacyFilters: ReportFilter[] = [
    ...(config.filters ?? []),
    ...(config.owner_id
      ? [{ dimension: "owner" as const, key: config.owner_id }]
      : []),
    ...(config.customer_type
      ? [{ dimension: "customer_type" as const, key: config.customer_type }]
      : []),
  ]
  const queryRef = useRef(visibleQuery)
  useEffect(() => {
    queryRef.current = visibleQuery
  }, [visibleQuery])
  useEffect(() => {
    const controller = new AbortController()
    const requested = queryRef.current
    if (
      completedLoad.current?.key === queryKey &&
      completedLoad.current.attempt === retry
    ) {
      setSnapshot({
        key: queryKey,
        attempt: retry,
        status: "ready",
        data: completedLoad.current.data,
        matrixKeys: Object.fromEntries(
          requested.cards
            .filter((card) => card.visual === "matrix")
            .map((card) => [card.id, matrixRenderKey(requested, card.id)!])
        ),
      })
      return
    }
    loadReportProgressively(
      requested,
      getReportData,
      controller.signal,
      (data, complete) => {
        if (!controller.signal.aborted) {
          if (complete) {
            completedLoad.current = { key: queryKey, attempt: retry, data }
            setLastLoadedAt(data.loaded_at ?? new Date().toISOString())
          }
          setLastAsOf(data.as_of)
          setSnapshot({
            key: queryKey,
            attempt: retry,
            status: "ready",
            data,
            pending: !complete,
            matrixKeys: Object.fromEntries(
              requested.cards
                .filter((card) => card.visual === "matrix")
                .map((card) => [card.id, matrixRenderKey(requested, card.id)!])
            ),
          })
        }
      }
    ).catch((err: unknown) => {
      if (!controller.signal.aborted)
        setSnapshot((previous) =>
          previous?.key === queryKey &&
          previous.attempt === retry &&
          previous.status === "ready"
            ? {
                ...previous,
                pending: false,
                message:
                  err instanceof Error ? err.message : "資料暫時載入不了",
              }
            : {
                key: queryKey,
                attempt: retry,
                status: "error",
                message:
                  err instanceof Error ? err.message : "資料暫時載入不了",
              }
        )
    })
    return () => controller.abort()
  }, [queryKey, retry])

  function change(next: ReportConfig) {
    const normalized = normalizeReportConfig(pruneStudioReferences(next))
    if (reportDataKey(config) !== reportDataKey(normalized)) {
      setSelectionGroups([])
      setDrills({})
      setMatrixViews({})
    } else
      setSelectionGroups((groups) => pruneReportSelections(groups, normalized))
    setCanvasValues((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) =>
          normalized.objects?.some(
            (object) => object.id === id && object.kind === "slicer"
          )
        )
      )
    )
    if (
      navigation.page &&
      !reportPages(normalized).some((page) => page.id === navigation.page)
    )
      setNavigation({ page: null, filters: [] })
    setDraft((current) => editReportDraft(current, normalized))
    setNotice(null)
  }
  useReportAssistant(
    editing && !readonly,
    config,
    workspace.ai_available,
    change
  )

  function undo() {
    setSelectionGroups([])
    setDrills({})
    setMatrixViews({})
    setDraft(undoReportDraft)
    setNotice(null)
  }
  function redo() {
    setSelectionGroups([])
    setDrills({})
    setMatrixViews({})
    setDraft(redoReportDraft)
    setNotice(null)
  }
  function updateCurrentPage(patch: Partial<ReportPage>) {
    change({
      ...config,
      pages: pages.map((page) =>
        page.id === currentPage.id ? { ...page, ...patch } : page
      ),
    })
  }
  function removeReportLegacy(filter: ReportFilter) {
    change({
      ...config,
      owner_id:
        filter.dimension === "owner" && filter.key === config.owner_id
          ? null
          : config.owner_id,
      customer_type:
        filter.dimension === "customer_type" &&
        filter.key === config.customer_type
          ? null
          : config.customer_type,
      filters: (config.filters ?? []).filter(
        (item) => item.dimension !== filter.dimension || item.key !== filter.key
      ),
    })
  }
  function changeScopedSlicer(
    dimension: ReportFilter["dimension"],
    keys: string[]
  ) {
    if (filterScope === "page") {
      updateCurrentPage({
        slicers: setReportSlicer(currentPage.slicers ?? [], dimension, keys),
        filters: (currentPage.filters ?? []).filter(
          (item) => item.dimension !== dimension
        ),
      })
    } else {
      change({
        ...config,
        slicers: setReportSlicer(config.slicers ?? [], dimension, keys),
        filters: (config.filters ?? []).filter(
          (item) => item.dimension !== dimension
        ),
        owner_id: dimension === "owner" ? null : config.owner_id,
        customer_type:
          dimension === "customer_type" ? null : config.customer_type,
      })
    }
  }
  const [saveQueue] = useState(() =>
    createReportSaveQueue(
      { config: workspace.config, revision: library.revision },
      async (submitted, revision) => {
        if (workspace.active_report_id)
          return saveReportDocument(
            workspace.active_report_id,
            submitted,
            revision
          )
        return {
          ...library,
          config: await saveReportConfig(submitted),
          revision: revision + 1,
        }
      },
      (stored, submitted) => {
        setLibrary(stored)
        setDraft((current) =>
          JSON.stringify(current.config) === JSON.stringify(submitted)
            ? { ...current, config: stored.config }
            : current
        )
        setSavedKey(JSON.stringify(stored.config))
      }
    )
  )
  useEffect(() => {
    saveQueue.update(config)
  }, [saveQueue, config])
  async function save() {
    if (readonly || autosavePaused) return false
    if (!dirty && !saving) return true
    setSaving(true)
    setAutosaveError("")
    try {
      await saveQueue.flush()
      return true
    } catch (err) {
      const permanent =
        err instanceof ApiError && err.status >= 400 && err.status < 500
      if (permanent) setAutosavePaused(true)
      setAutosaveError(
        err instanceof Error
          ? err.message
          : "自動儲存暫時失敗，連線恢復後會重試。"
      )
      return false
    } finally {
      setSaving(false)
    }
  }
  function selectCard(id: string) {
    if (readonly) return
    setEditing(true)
    setSelectedId(id)
    if (!dockedPanels) setMobileInspector(true)
  }
  function exploreSnapshot(): StudioExploration {
    return {
      selections: selectionGroups,
      drills,
      matrix_views: matrixViews,
      canvas_values: canvasValues,
      hidden: {
        ...Object.fromEntries(
          [...config.cards, ...(config.objects ?? [])].map((item) => [
            item.id,
            item.hidden ?? false,
          ])
        ),
        ...visibility,
      },
      navigation_page: navigation.page,
      navigation_filters: navigation.filters,
    }
  }
  function restoreExplore(raw: StudioExploration) {
    const state = safeStudioExploration(
      config,
      raw,
      workspace.owners.map((owner) => owner.id)
    )
    setSelectionGroups(state.selections)
    setDrills(state.drills)
    setMatrixViews(state.matrix_views)
    setCanvasValues(state.canvas_values)
    setVisibility(state.hidden)
    setNavigation({
      page: state.navigation_page,
      filters: state.navigation_filters,
    })
  }
  function navigateReport(target: string, filters: ReportFilter[] = []) {
    if (!pages.some((page) => page.id === target)) return
    setNavigationStack((stack) =>
      [...stack, { pageId: currentPage.id, state: exploreSnapshot() }].slice(
        -20
      )
    )
    setTooltip(null)
    setPageId(target)
    setNavigation({ page: filters.length ? target : null, filters })
    setSelectionGroups([])
    setDrills({})
    setMatrixViews({})
    setSelectedId(null)
    setStudioSelection([])
  }
  function runStudioAction(action: StudioAction) {
    if (action.kind === "page" && action.target) navigateReport(action.target)
    if (action.kind === "back") {
      const previous = navigationStack.at(-1)
      if (previous) {
        setNavigationStack((stack) => stack.slice(0, -1))
        setTooltip(null)
        setPageId(previous.pageId)
        restoreExplore(previous.state)
        setSelectedId(null)
      }
    }
    if (action.kind === "reset") {
      setSelectionGroups([])
      setDrills({})
      setMatrixViews({})
      setCanvasValues({})
      setNavigation({ page: null, filters: [] })
      setVisibility({})
    }
    if (action.kind === "toggle" && action.target) {
      const item = [...config.cards, ...(config.objects ?? [])].find(
        (item) => item.id === action.target
      )
      if (item)
        setVisibility((current) => ({
          ...current,
          [item.id]: !(current[item.id] ?? item.hidden ?? false),
        }))
    }
    if (action.kind === "bookmark" && action.target) {
      setTooltip(null)
      const bookmark = library.bookmarks.find(
        (item) => item.id === action.target
      )
      if (!bookmark)
        setNotice({
          text: "這個書籤不在目前報表中；可另存報表後重新指定按鈕目標。",
          error: true,
        })
      if (bookmark) {
        change(
          applyReportBookmark(
            config,
            bookmark.state,
            workspace.owners.map((owner) => owner.id)
          )
        )
        setPageId(bookmark.state.page_id)
        if (bookmark.state.exploration)
          restoreExplore(bookmark.state.exploration)
      }
    }
  }
  function addObject(value: StudioObject["kind"] | StudioObject) {
    if ((config.objects?.length ?? 0) >= 100) {
      setNotice({ text: "每份報表最多 100 個設計物件。", error: true })
      return
    }
    const draftObject =
      typeof value === "string"
        ? createStudioObject(
            value,
            currentPage.id,
            pageCards.length + pageObjects.length
          )
        : value
    const object = placeStudioObject(config, draftObject)
    change({
      ...config,
      objects: [...(config.objects ?? []), object],
      pages: pages.map((page) =>
        page.id === currentPage.id ? { ...page, desktop_layout: "free" } : page
      ),
    })
    setSelectedId(object.id)
    setStudioSelection([object.id])
    setEditing(true)
    if (!dockedPanels) setMobileInspector(true)
  }
  function addDataset(source: DataSource, field?: StudioField) {
    addObject(createDatasetObject(source, currentPage.id, field))
  }
  function assignField(field: StudioField, role?: FieldRole) {
    if (!dockedPanels) setMobileInspector(true)
    try {
      if (field.kind === "dataset") {
        if (
          selectedObject?.kind === "dataset" &&
          selectedObject.dataset_id === field.dataset_id &&
          selectedObject.dataset_chart
        ) {
          const chart = {
            ...selectedObject.dataset_chart,
            ...(role === "value" || (field.column.kind === "number" && !role)
              ? {
                  value: field.column.id,
                  aggregation:
                    field.column.kind === "number"
                      ? ("sum" as const)
                      : ("distinct" as const),
                }
              : { group_by: field.column.id }),
          }
          change({
            ...config,
            objects: (config.objects ?? []).map((object) =>
              object.id === selectedObject.id
                ? { ...object, dataset_chart: chart }
                : object
            ),
          })
        } else
          getDataSource(field.dataset_id)
            .then((source) => addDataset(source, field))
            .catch(() =>
              setNotice({ text: "無法讀取這份匯入來源。", error: true })
            )
        return
      }
      if (selected)
        updateSelected(
          assignReportField(
            selected,
            field,
            role ?? (field.kind === "metric" ? "value" : "group")
          )
        )
      else {
        if (config.cards.length >= 24 || pageCards.length >= 12)
          throw new Error("圖表已達目前頁面或整份報表上限。")
        const card = normalizeCard({
          id: `visual-${crypto.randomUUID()}`,
          title:
            field.kind === "metric"
              ? METRICS[field.key].label
              : `${DIMENSIONS[field.key]}分析`,
          metric: field.kind === "metric" ? field.key : "sales",
          dimension: field.kind === "dimension" ? field.key : "none",
          visual: field.kind === "metric" ? "kpi" : "bar",
          limit: 5,
          page_id: currentPage.id,
        })
        change({ ...config, cards: [...config.cards, card] })
        setSelectedId(card.id)
        setStudioSelection([card.id])
      }
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "這個欄位無法套用",
        error: true,
      })
    }
  }
  function updateSelected(patch: Partial<ReportCard>) {
    if (!selected) return
    if (
      patch.page_id &&
      patch.page_id !== currentPage.id &&
      config.cards.filter((card) => card.page_id === patch.page_id).length >= 12
    ) {
      setNotice({ text: "每一頁最多可放 12 個視覺效果。", error: true })
      return
    }
    const next = normalizeCard({
      ...selected,
      ...patch,
      ...(patch.page_id && patch.page_id !== selected.page_id
        ? { desktop_layout: null, mobile_layout: null }
        : {}),
    })
    const updated = {
      ...config,
      cards: config.cards.map((card) => (card.id === next.id ? next : card)),
    }
    change(
      patch.mobile_layout
        ? setMobileReportLayout(updated, next.id, patch.mobile_layout)
        : updated
    )
    if (patch.page_id) setPageId(patch.page_id)
  }
  function addVisual(visual: ReportVisual) {
    if (config.cards.length >= 24 || pageCards.length >= 12) return
    const card = normalizeCard({
      id: `visual-${crypto.randomUUID()}`,
      title: `${METRICS.sales.label} · ${VISUALS[visual]}`,
      metric: "sales",
      dimension: "customer",
      visual,
      limit: 5,
      page_id: currentPage.id,
    })
    change({ ...config, cards: [...config.cards, card] })
    setEditing(true)
    setSelectedId(card.id)
    setGallery(false)
    if (!dockedPanels) setMobileInspector(true)
  }
  function duplicate() {
    if (!selected || config.cards.length >= 24 || pageCards.length >= 12) return
    const copy = {
      ...selected,
      id: `visual-${crypto.randomUUID()}`,
      title: `${selected.title.slice(0, 35)} 副本`,
      desktop_layout: selected.desktop_layout
        ? { ...selected.desktop_layout, x: 0, y: 0 }
        : null,
      mobile_layout: null,
    }
    const cards = [...config.cards]
    cards.splice(
      cards.findIndex((card) => card.id === selected.id) + 1,
      0,
      copy
    )
    change({ ...config, cards })
    setSelectedId(copy.id)
  }
  function deleteSelected() {
    if (!selected) return
    change({
      ...config,
      cards: config.cards.filter((card) => card.id !== selected.id),
    })
    setSelectedId(pageCards.find((card) => card.id !== selected.id)?.id ?? null)
  }
  function addPage() {
    if (pages.length >= 5) return
    const page = {
      id: `page-${crypto.randomUUID()}`,
      name: `第 ${pages.length + 1} 頁`,
    }
    change({ ...config, pages: [...pages, page] })
    setPageId(page.id)
    setSelectedId(null)
  }
  function deletePage() {
    if (pages.length <= 1) return
    const target = pages.find(
      (page) =>
        page.id !== currentPage.id &&
        pageCards.length +
          config.cards.filter(
            (card) => (card.page_id ?? "overview") === page.id
          ).length <=
          12
    )
    if (!target) {
      setNotice({
        text: "其他頁面空間不足，請先移動或刪除部分圖表。",
        error: true,
      })
      return
    }
    change({
      ...config,
      pages: pages.filter((page) => page.id !== currentPage.id),
      cards: config.cards.map((card) =>
        card.page_id === currentPage.id ? { ...card, page_id: target.id } : card
      ),
    })
    setPageId(target.id)
    setPageSettings(false)
  }
  function pointFilter(sourceId: string, point: ReportSelectionPoint) {
    if (editing) return
    const group = selectionGroups.find((item) => item.source_id === sourceId)
    if (
      multipleSelection &&
      (group?.points.length ?? 0) >= 30 &&
      !group?.points.some(
        (item) => selectionPointKey(item) === selectionPointKey(point)
      )
    ) {
      setNotice({
        text: "同一張圖最多可選取 30 個資料點，請先取消部分選取。",
        error: true,
      })
      return
    }
    setSelectionGroups((groups) =>
      toggleReportSelection(groups, sourceId, point, multipleSelection)
    )
  }
  function setCardDrill(id: string, state: ReportDrillState | null) {
    setDrills((current) => {
      const next = { ...current }
      if (state) next[id] = state
      else delete next[id]
      return next
    })
    setSelectionGroups((groups) =>
      groups.filter((group) => group.source_id !== id)
    )
  }
  function holdTooltip() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
  }
  function closeTooltipLater() {
    holdTooltip()
    tooltipTimer.current = setTimeout(() => setTooltip(null), 400)
  }
  function openTooltip(card: ReportCard, point: ReportSelectionPoint) {
    if (editing || !card.tooltip_page) return
    holdTooltip()
    setTooltip({ pageId: card.tooltip_page, point })
  }
  function pointAction(card: ReportCard): ReportPointAction {
    return resolveReportPointAction(card, pointActions[card.id])
  }
  function openDetails(card: ReportCard, point?: ReportSelectionPoint) {
    const detailCard = point?.metric
      ? {
          ...card,
          metric: point.metric,
          title: `${card.title} · ${METRICS[point.metric].label}`,
        }
      : card
    setDetailView({ config: queryConfig, card: detailCard, point })
  }
  function explorePoint(sourceId: string, point: ReportSelectionPoint) {
    if (editing) return
    const card = queryConfig.cards.find((item) => item.id === sourceId)
    if (!card) return
    const action = pointAction(card)
    if (action === "page" && card.drillthrough_page)
      navigateReport(card.drillthrough_page, [
        ...new Map(
          [
            ...navigation.filters,
            ...(queryConfig.drill_filters?.[card.id] ?? []),
            ...point.filters,
          ].map((filter) => [filter.dimension, filter])
        ).values(),
      ])
    else if (action === "tooltip" && card.tooltip_page) openTooltip(card, point)
    else if (action === "details") openDetails(card, point)
    else if (action === "drill") {
      const state = drillDown(card, drills[card.id], point)
      if (state) setCardDrill(card.id, state)
    } else pointFilter(sourceId, point)
  }
  function exploreControls(card: ReportCard) {
    return {
      state: drills[card.id],
      action: pointAction(card),
      onAction: (action: ReportPointAction) =>
        setPointActions((current) => ({ ...current, [card.id]: action })),
      onGrain: (dimension: ReportDateDimension) =>
        setCardDrill(card.id, { dimension, steps: [] }),
      onUp: () => {
        if (drills[card.id]) setCardDrill(card.id, drillUp(drills[card.id]))
      },
      onReset: () =>
        setCardDrill(
          card.id,
          drills[card.id] ? drillReset(drills[card.id]) : null
        ),
      onDetails: () => openDetails(card),
    }
  }
  const inspectorProps = {
    card: selected,
    data: ready?.cards.find((item) => item.id === selected?.id),
    config,
    owners: workspace.owners,
    filterOptions,
    asOf,
    dateFallback,
    onChange: updateSelected,
    onAdd: addVisual,
    onDuplicate: duplicate,
    onDelete: deleteSelected,
    onMove: (direction: -1 | 1) => {
      if (selected) change(moveReportCard(config, selected.id, direction))
    },
  }
  const filtered = Boolean(
    reportLegacyFilters.length ||
    config.slicers?.length ||
    currentPage.filters?.length ||
    currentPage.slicers?.length ||
    currentPage.date_range
  )
  const draftProtection = useReportDraft({
    accountId: readonly ? "" : library.account_id,
    reportId: library.active_report_id,
    config,
    pageId,
    revision: library.revision,
    savedKey,
    dirty,
    saving,
    onSave: save,
    onRestore: (restored, restoredPage, _revision, conflict) => {
      change(restored)
      setPageId(
        reportPages(restored).some((page) => page.id === restoredPage)
          ? restoredPage
          : reportPages(restored)[0].id
      )
      setSelectedId(null)
      if (conflict) {
        setAutosavePaused(true)
        setAutosaveError("帳號報表已有較新版本，請比較版本或另存新報表。")
      }
      setNotice({
        text: conflict
          ? "已復原草稿；帳號版本已有變更，請另存新報表或先比較版本。"
          : "已復原本機草稿，將自動儲存到帳號。",
        error: false,
      })
    },
  })

  const latestSave = useRef(save)
  useEffect(() => {
    latestSave.current = save
  })
  useEffect(() => {
    if (
      !dirty ||
      readonly ||
      saving ||
      autosavePaused ||
      draftProtection.recovering
    )
      return
    const timer = window.setTimeout(
      () => void latestSave.current(),
      autosaveError ? 5000 : 700
    )
    return () => window.clearTimeout(timer)
  }, [
    config,
    dirty,
    readonly,
    saving,
    autosavePaused,
    autosaveError,
    saveAttempt,
    draftProtection.recovering,
  ])
  useEffect(() => {
    const retrySave = () => setSaveAttempt((value) => value + 1)
    const hide = () => {
      if (document.visibilityState === "hidden") void latestSave.current()
    }
    window.addEventListener("online", retrySave)
    document.addEventListener("visibilitychange", hide)
    return () => {
      window.removeEventListener("online", retrySave)
      document.removeEventListener("visibilitychange", hide)
      void latestSave.current()
    }
  }, [])

  return (
    <div ref={workspaceRef} className="report-workspace min-h-svh min-w-0">
      <PageHeader
        title={config.name}
        hideTitle
        backTo={primaryNavigation ? undefined : backTo}
        trailing={
          <div className="report-header-actions">
            {!readonly && (
              <span
                className="report-autosave-status"
                role="status"
                aria-live="polite"
              >
                {autosaveError
                  ? "尚未同步"
                  : saving
                    ? "自動儲存中…"
                    : dirty
                      ? "等待自動儲存…"
                      : "已自動儲存"}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="report-more-button"
              aria-label="更多報表操作"
              data-ui-demo="report-more"
              aria-haspopup="dialog"
              onClick={() => setToolsOpen(true)}
            >
              <Ellipsis className="size-5" />
            </Button>
          </div>
        }
      />
      <div className="report-navigation-bar">
      <nav
        className="report-page-tabs flex min-w-0 flex-1 items-center overflow-x-auto"
        aria-label="報表分頁"
        data-ui-demo="report-page-tabs"
      >
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            aria-current={page.id === currentPage.id ? "page" : undefined}
            onClick={() => {
              setPageId(page.id)
              setSelectedId(null)
              setStudioSelection([])
              setSelectionGroups([])
              setNavigation({ page: null, filters: [] })
              setNavigationStack([])
            }}
            className={cn(
              "report-page-tab min-h-11 shrink-0 px-4 text-sm",
              page.id === currentPage.id
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {page.name}
          </button>
        ))}
        {editing && (
          <>
            <button
              type="button"
              aria-label="新增報表分頁"
              disabled={pages.length >= 5}
              onClick={addPage}
              className="flex size-11 shrink-0 items-center justify-center text-muted-foreground disabled:opacity-30"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              aria-label="報表分頁設定"
              onClick={() => setPageSettings(true)}
              className="ml-auto flex size-11 shrink-0 items-center justify-center text-muted-foreground"
            >
              <Settings2 className="size-4" />
            </button>
          </>
        )}
      </nav>
        <div className="report-reading-controls" role="group" aria-label="報表日期與篩選">
          <NativeSelect
            aria-label="報表期間"
            data-ui-demo="report-period"
            className="report-period-select"
            value={config.period}
            onChange={(event) => {
              const period = event.target.value as ReportPeriod
              if (period === "custom") setFiltersOpen(true)
              else change({ ...config, period, date_range: null })
            }}
          >
            {Object.entries(PERIODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <button
            type="button"
            className="report-scope-button"
            onClick={() => setFiltersOpen(true)}
            aria-label="篩選報表"
            data-ui-demo="report-filters"
            aria-haspopup="dialog"
          >
            <SlidersHorizontal className="size-4 shrink-0" />
            <span className="hidden sm:inline">{filtered ? "已套用篩選" : "篩選"}</span>
            {filtered && (
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" />
            )}
          </button>
        </div>
      </div>
      <div className="report-toolbar">
        {readonly && (
          <p className="report-readonly-note" role="status">
            唯讀共享 · 來自 {library.shared_from?.name}
          </p>
        )}
        <ReportSheet
          open={toolsOpen}
          onOpenChange={setToolsOpen}
          title="報表工具"
          description="管理報表與書籤、編輯圖表，或匯出目前報表。"
        >
          <ReportDocumentControls
            config={config}
            library={library}
            pageId={currentPage.id}
            exploration={exploreSnapshot()}
            dirty={dirty}
            saving={saving}
            onOpen={onOpen}
            onLibraryChange={setLibrary}
            requestAction={draftProtection.requestAction}
            flushDraft={draftProtection.flush}
            onBookmark={(bookmark) => {
              change(
                applyReportBookmark(
                  config,
                  bookmark.state,
                  workspace.owners.map((owner) => owner.id)
                )
              )
              if (pages.some((page) => page.id === bookmark.state.page_id))
                setPageId(bookmark.state.page_id)
              setSelectionGroups([])
              setDrills({})
              setMatrixViews({})
              if (bookmark.state.exploration)
                restoreExplore(bookmark.state.exploration)
              setSelectedId(null)
              setNotice({
                text: `已套用檢視書籤「${bookmark.name}」。`,
                error: false,
              })
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {!readonly ? (
                <input
                  aria-label="報表名稱"
                  value={config.name}
                  maxLength={40}
                  onChange={(event) =>
                    change({
                      ...config,
                      name: event.target.value || "我的報表",
                    })
                  }
                  onBlur={(event) => {
                    const name = event.target.value.trim() || "我的報表"
                    if (name !== config.name) change({ ...config, name })
                  }}
                  className="w-full min-w-0 rounded border border-transparent bg-transparent py-0.5 text-lg font-semibold outline-none focus:border-primary"
                />
              ) : (
                <h2 className="truncate text-lg font-semibold">
                  {config.name}
                </h2>
              )}
            </div>
          </div>
          {!readonly && (
            <ReportRibbon
              editing={!readonly}
              onInsert={addObject}
              panels={studioPanels}
              onPanel={(key) =>
                setStudioPanels((current) => ({
                  ...current,
                  [key]: !current[key],
                }))
              }
              onAnalytics={() => {
                setEditing(true)
                setToolsOpen(false)
                setMobileInspector(true)
                setStudioPanels((current) => ({
                  ...current,
                  layers: false,
                  filters: false,
                }))
              }}
            >
              {(editing || history.length > 0 || future.length > 0) && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label="復原上一次調整"
                    disabled={readonly || !history.length}
                    onClick={undo}
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label="重做上一次復原"
                    disabled={readonly || !future.length}
                    onClick={redo}
                  >
                    <RotateCw className="size-4" />
                  </Button>
                </>
              )}
              <ReportDatasetLauncher
                onClose={() => setDatasetEpoch((value) => value + 1)}
              />
              {!readonly && (
                <Button
                  variant="outline"
                  className="h-10 rounded-md border shadow-none"
                  disabled={config.cards.length >= 24 || pageCards.length >= 12}
                  onClick={() => {
                    setToolsOpen(false)
                    setGallery(true)
                  }}
                >
                  <Plus className="size-4" />
                  新增視覺效果
                </Button>
              )}
              <Button
                variant={filtersOpen ? "secondary" : "ghost"}
                className="h-10 rounded-md px-3 shadow-none"
                onClick={() => {
                  setToolsOpen(false)
                  setFiltersOpen(true)
                }}
                aria-expanded={filtersOpen}
                aria-controls="report-filters"
              >
                <SlidersHorizontal className="size-4" />
                切片器
                {filtered && (
                  <span className="size-1.5 rounded-full bg-primary" />
                )}
              </Button>
              {!readonly && (
                <NativeSelect
                  aria-label="套用報表範本"
                  className="h-10 max-w-36 rounded-md border text-base shadow-none"
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return
                    change(
                      structuredClone(
                        workspace.templates[
                          event.target.value as "sales" | "manager"
                        ]
                      )
                    )
                    setPageId("overview")
                    setSelectedId(null)
                    setSelectionGroups([])
                  }}
                >
                  <option value="">套用範本</option>
                  <option value="sales">業務報表</option>
                  <option value="manager">經理報表</option>
                </NativeSelect>
              )}
              <Button
                data-ui-demo="report-export"
                variant="outline"
                className="h-10 rounded-md border shadow-none"
                onClick={() => {
                  setToolsOpen(false)
                  setExportView({})
                }}
              >
                <Download className="size-4" />
                完整匯出
              </Button>
              <span
                className="ml-auto text-xs text-muted-foreground"
                role="status"
              >
                {saving
                  ? "自動儲存中…"
                  : dirty
                    ? "等待自動儲存…"
                    : "已自動儲存"}
              </span>
            </ReportRibbon>
          )}
          {readonly && (
            <div className="report-reading-tools">
              <Button
                data-ui-demo="report-export"
                variant="outline"
                onClick={() => {
                  setToolsOpen(false)
                  setExportView({})
                }}
              >
                <Download className="size-4" />
                完整匯出
              </Button>
              <button
                type="button"
                aria-pressed={multipleSelection}
                onClick={() => setMultipleSelection((value) => !value)}
                className="report-tool-row"
              >
                多選聯動{multipleSelection ? "：開啟" : "：關閉"}
              </button>
            </div>
          )}
        </ReportSheet>
        <ReportSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title="篩選報表"
          description="調整期間與報表或分頁的資料範圍。"
        >
          <div id="report-filters" className="min-w-0 space-y-5">
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {asOf ? (
                <div data-ui-demo="report-filter-period">
                  <ReportPeriodEditor
                    period={config.period}
                    range={config.date_range}
                    fallback={dateFallback}
                    asOf={asOf}
                    onChange={(period, date_range) =>
                      change({ ...config, period, date_range })
                    }
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  正在取得報表基準日…
                </p>
              )}
              <div className="min-w-0 space-y-2">
                <label className="block space-y-1 text-sm">
                  篩選範圍
                  <NativeSelect
                    aria-label="篩選範圍"
                    value={filterScope}
                    onChange={(event) =>
                      setFilterScope(event.target.value as "report" | "page")
                    }
                    className="h-10 rounded-md border text-sm"
                  >
                    <option value="report">整份報表</option>
                    <option value="page">目前分頁：{currentPage.name}</option>
                  </NativeSelect>
                </label>
                {filterScope === "page" && asOf && (
                  <ReportDateRangeEditor
                    value={currentPage.date_range ?? null}
                    fallback={dateFallback}
                    asOf={asOf}
                    label="分頁日期"
                    allowClear
                    onChange={(date_range) => updateCurrentPage({ date_range })}
                  />
                )}
              </div>
            </div>
            <ReportSlicerEditor
              key={filterScope === "page" ? currentPage.id : "report"}
              wide
              options={filterOptions}
              slicers={
                filterScope === "page" ? currentPage.slicers : config.slicers
              }
              onChange={changeScopedSlicer}
            />
            <ReportFilterChips
              options={filterOptions}
              scope={filterScope === "page" ? "分頁既有條件" : "報表既有條件"}
              filters={
                filterScope === "page"
                  ? currentPage.filters
                  : reportLegacyFilters
              }
              onRemoveFilter={
                filterScope === "page"
                  ? (filter) =>
                      updateCurrentPage({
                        filters: (currentPage.filters ?? []).filter(
                          (item) =>
                            item.dimension !== filter.dimension ||
                            item.key !== filter.key
                        ),
                      })
                  : removeReportLegacy
              }
            />
            {filtered && (
              <button
                type="button"
                className="min-h-10 text-left text-sm text-primary"
                onClick={() => {
                  if (filterScope === "page")
                    updateCurrentPage({
                      filters: [],
                      slicers: [],
                      date_range: null,
                    })
                  else
                    change({
                      ...config,
                      owner_id: null,
                      customer_type: null,
                      filters: [],
                      slicers: [],
                    })
                }}
              >
                清除{filterScope === "page" ? "目前分頁" : "報表"}篩選條件
              </button>
            )}
          </div>
        </ReportSheet>
        {autosaveError && (
          <Notice
            text={`${autosaveError} ${autosavePaused ? "目前變更已保留在本機草稿。" : "會自動重試，草稿仍保留在此裝置。"}`}
          />
        )}
        {notice && (
          <p
            role={notice.error ? "alert" : "status"}
            className={cn(
              "mt-3 rounded-md px-3 py-2 text-xs",
              notice.error
                ? "bg-destructive/10 text-destructive"
                : "bg-success/10 text-success"
            )}
          >
            {notice.text}
          </p>
        )}
      </div>

      {draftProtection.status && (
        <p
          className="px-3 py-2 text-xs text-muted-foreground lg:px-5"
          role="status"
        >
          {draftProtection.status}
        </p>
      )}
      {draftProtection.dialogs}
      {tooltip && !editing && (
        <ReportPageTooltip
          config={queryConfig}
          pageId={tooltip.pageId}
          point={tooltip.point}
          onClose={() => setTooltip(null)}
          onHold={holdTooltip}
          onLeave={closeTooltipLater}
        />
      )}
      <main
        className={cn(
          "report-main grid min-w-0 gap-4",
          primaryNavigation && "report-main-with-navigation",
          editing &&
            dockedPanels &&
            (studioPanels.data
              ? "grid-cols-[14rem_minmax(0,1fr)_18rem]"
              : "grid-cols-[minmax(0,1fr)_18rem]")
        )}
      >
        {editing && studioPanels.data && dockedPanels && (
          <aside
            aria-label="資料欄位面板"
            className={cn(
              "min-w-0 rounded-lg border bg-card p-3",
              dockedPanels &&
                "sticky top-16 max-h-[calc(100dvh-5rem)] self-start overflow-y-auto"
            )}
          >
            <details open={dockedPanels}>
              <summary
                className={cn(
                  "cursor-pointer py-2 text-sm font-semibold",
                  dockedPanels && "hidden"
                )}
              >
                資料欄位（點開選取）
              </summary>
              <div
                className={cn(
                  !dockedPanels &&
                    "max-h-72 overflow-y-auto overscroll-contain pt-3"
                )}
              >
                <ReportDataFields
                  key={datasetEpoch}
                  onField={assignField}
                  onDataset={addDataset}
                />
              </div>
            </details>
          </aside>
        )}
        <div ref={canvasRef} className="min-w-0">
          {navigationStack.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded border bg-card p-2 text-xs">
              <Button
                variant="outline"
                size="sm"
                onClick={() => runStudioAction({ kind: "back", target: null })}
              >
                返回來源頁
              </Button>
              <span>
                跨頁分析：
                {navigation.filters
                  .map(
                    (filter) => `${DIMENSIONS[filter.dimension]} ${filter.key}`
                  )
                  .join(" · ") || currentPage.name}
              </span>
            </div>
          )}
          {editing &&
            !dockedPanels &&
            (studioPanels.filters || studioPanels.layers) && (
              <details
                open={studioPanels.filters || studioPanels.layers}
                className="mb-3 rounded-lg border bg-card p-3"
              >
                <summary className="min-h-9 text-xs">篩選與圖層</summary>
                {studioPanels.filters && asOf && (
                  <ReportFilterPane
                    config={config}
                    pageId={currentPage.id}
                    cardId={selected?.id}
                    options={filterOptions}
                    asOf={asOf}
                    onChange={change}
                  />
                )}
                <StudioLayers
                  config={config}
                  pageId={currentPage.id}
                  selected={activeSelection}
                  onSelect={(ids) => {
                    setStudioSelection(ids)
                    setSelectedId(ids.at(-1) ?? null)
                  }}
                  onChange={change}
                />
              </details>
            )}

          <div
            className={cn(
              "mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground",
              !editing && "sr-only"
            )}
            aria-live="polite"
          >
            {(editing || reportPages(config).length > 1) && (
              <span className="flex items-center gap-1.5">
                <FileChartColumn className="size-3.5" />
                {currentPage.name}
              </span>
            )}
            <span>
              {ready
                ? `${PERIODS[config.period]} · ${ready.scope_label} · 截至 ${formatDate(ready.as_of)}`
                : loading
                  ? "正在更新資料…"
                  : "資料載入失敗"}
            </span>
          </div>
          <div className="mb-3 space-y-2">
            <ReportFilterChips
              options={filterOptions}
              scope="報表"
              filters={reportLegacyFilters}
              slicers={config.slicers}
              onRemoveFilter={removeReportLegacy}
              onRemoveSlicer={(slicer) =>
                change({
                  ...config,
                  slicers: (config.slicers ?? []).filter(
                    (item) => item.dimension !== slicer.dimension
                  ),
                })
              }
            />
            <ReportFilterChips
              options={filterOptions}
              scope={`分頁 ${currentPage.name}`}
              filters={currentPage.filters}
              slicers={currentPage.slicers}
              onRemoveFilter={(filter) =>
                updateCurrentPage({
                  filters: (currentPage.filters ?? []).filter(
                    (item) =>
                      item.dimension !== filter.dimension ||
                      item.key !== filter.key
                  ),
                })
              }
              onRemoveSlicer={(slicer) =>
                updateCurrentPage({
                  slicers: (currentPage.slicers ?? []).filter(
                    (item) => item.dimension !== slicer.dimension
                  ),
                })
              }
            />
            {config.period === "custom" && config.date_range && (
              <p className="text-xs text-muted-foreground">
                報表日期：{config.date_range.start} 至 {config.date_range.end}
              </p>
            )}
            {currentPage.date_range && (
              <button
                type="button"
                className="min-h-9 rounded bg-muted px-2 text-sm"
                onClick={() => updateCurrentPage({ date_range: null })}
              >
                分頁日期：{currentPage.date_range.start} 至{" "}
                {currentPage.date_range.end} ×
              </button>
            )}
          </div>
          {Boolean(selectionGroups.length) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 text-xs">
              {selectionGroups.flatMap((group) =>
                group.points.map((point) => (
                  <button
                    key={`${group.source_id}-${selectionPointKey(point)}`}
                    type="button"
                    onClick={() =>
                      setSelectionGroups((groups) =>
                        toggleReportSelection(
                          groups,
                          group.source_id,
                          point,
                          true
                        )
                      )
                    }
                    className="flex min-h-8 items-center gap-2 rounded bg-primary/10 px-2 text-primary"
                  >
                    {
                      config.cards.find((card) => card.id === group.source_id)
                        ?.title
                    }{" "}
                    · {point.label}
                    <X className="size-3.5" />
                  </button>
                ))
              )}
              {!!selectionGroups.length && (
                <button
                  type="button"
                  className="min-h-8 px-2 text-primary"
                  onClick={() => setSelectionGroups([])}
                >
                  清除全部聯動
                </button>
              )}
            </div>
          )}
          {error && (
            <Notice
              text={error}
              action={{
                label: "再試一次",
                onClick: () => {
                  setSnapshot(null)
                  setRetry((n) => n + 1)
                },
              }}
            />
          )}
          {!!(pageCards.length + pageObjects.length) && (
            <ReportLayoutCanvas
              config={layoutConfig}
              pageId={currentPage.id}
              editing={editing}
              readonly={readonly}
              isDesktop={isDesktop}
              selectedId={selectedId}
              selectionIds={activeSelection}
              onSelectionChange={setStudioSelection}
              onSelect={selectCard}
              onChange={(next) => change(commitStudioLayout(config, next))}
              renderCard={(card, layout) => {
                const object = config.objects?.find(
                  (item) => item.id === card.id
                )
                return object ? (
                  <StudioVisual
                    key={
                      object.kind === "dataset"
                        ? `${object.id}/${datasetEpoch}`
                        : object.id
                    }
                    object={object}
                    editing={editing}
                    layout={layout}
                    filterOptions={filterOptions}
                    values={canvasValues}
                    onValues={(id, keys) =>
                      setCanvasValues((current) =>
                        updateCanvasSelection(config, current, id, keys)
                      )
                    }
                    onAction={runStudioAction}
                  />
                ) : (
                  <CanvasVisual
                    key={card.id}
                    card={
                      queryConfig.cards.find((item) => item.id === card.id) ??
                      card
                    }
                    layout={layout}
                    filterOptions={filterOptions}
                    data={cardData(card.id)}
                    editing={editing && layout.selected}
                    selected={layout.selected}
                    loading={cardLoading(card.id)}
                    selections={
                      selectionGroups.find(
                        (group) => group.source_id === card.id
                      )?.points ?? []
                    }
                    onSelect={layout.onSelect}
                    onPoint={explorePoint}
                    onHover={(point) => openTooltip(card, point)}
                    onHoverEnd={closeTooltipLater}
                    matrixView={matrixViews[card.id]}
                    onMatrixViewChange={(view) =>
                      setMatrixViews((current) => ({
                        ...current,
                        [card.id]: view,
                      }))
                    }
                    explore={exploreControls(
                      queryConfig.cards.find((item) => item.id === card.id) ??
                        card
                    )}
                  />
                )
              }}
            />
          )}
          {!(pageCards.length + pageObjects.length) && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-card/50 text-center">
              <FileChartColumn className="size-9 text-muted-foreground/50" />
              <p className="text-sm font-medium">這一頁還沒有視覺效果</p>
              {!readonly && (
                <Button
                  className="rounded-md shadow-none"
                  onClick={() => setGallery(true)}
                >
                  <Plus className="size-4" />
                  新增視覺效果
                </Button>
              )}
            </div>
          )}
          <footer className="report-footer">
            {ready && (
              <p>
                {formatDate(ready.start)} 至 {formatDate(ready.end)} ·
                金額：新台幣
              </p>
            )}
            <ReportRefreshControls
              compact
              seconds={config.refresh_seconds ?? 0}
              busy={loading}
              loadedAt={lastLoadedAt}
              asOf={asOf}
              onRefresh={() => setRetry((n) => n + 1)}
              onChange={(refresh_seconds) =>
                change({ ...config, refresh_seconds })
              }
            />
          </footer>
        </div>
        {editing && dockedPanels && (
          <aside
            aria-label="視覺效果設定面板"
            data-ui-demo="report-inspector"
            className="sticky top-16 max-h-[calc(100dvh-5rem)] min-w-0 self-start overflow-y-auto rounded-lg border bg-card p-3 pb-24"
          >
            {studioPanels.filters && asOf && (
              <div className="mb-4 border-b pb-4">
                <ReportFilterPane
                  config={config}
                  pageId={currentPage.id}
                  cardId={selected?.id}
                  options={filterOptions}
                  asOf={asOf}
                  onChange={change}
                />
              </div>
            )}
            {studioPanels.layers && (
              <div className="mb-4 border-b pb-4">
                <StudioLayers
                  config={config}
                  pageId={currentPage.id}
                  selected={activeSelection}
                  onSelect={(ids) => {
                    setStudioSelection(ids)
                    setSelectedId(ids.at(-1) ?? null)
                  }}
                  onChange={change}
                />
              </div>
            )}
            {selectedObject ? (
              <StudioObjectInspector
                key={`${selectedObject.id}/${datasetEpoch}`}
                object={selectedObject}
                config={config}
                bookmarks={library.bookmarks}
                onChange={(next) =>
                  change({
                    ...config,
                    objects: (config.objects ?? []).map((item) =>
                      item.id === next.id ? next : item
                    ),
                  })
                }
                onDelete={() => {
                  change({
                    ...config,
                    objects: (config.objects ?? []).filter(
                      (item) => item.id !== selectedObject.id
                    ),
                  })
                  setSelectedId(null)
                }}
              />
            ) : (
              <ReportInspector {...inspectorProps} />
            )}
          </aside>
        )}
      </main>
      <Dialog
        open={editing && mobileInspector && !dockedPanels}
        onOpenChange={(open) => {
          setMobileInspector(open)
          if (!open) setEditing(false)
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="inset-x-0 top-auto bottom-0 mx-auto grid max-h-[88dvh] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-t-2xl rounded-b-none border p-0 shadow-xl sm:max-w-xl"
        >
          <DialogHeader
            data-ui-demo="report-inspector"
            className="flex-row items-center justify-between border-b px-4 py-2"
          >
            <div>
              <DialogTitle className="text-sm">
                {selectedObject ? "編輯畫布物件" : "編輯圖表"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {selectedObject
                  ? `正在編輯：${selectedObject.title}`
                  : selected
                    ? `正在編輯：${selected.title}`
                    : "選擇圖表建立你的報表"}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              className="size-11"
              aria-label="關閉視覺效果設定"
              data-ui-demo="report-inspector-close"
              onClick={() => {
                setMobileInspector(false)
                setEditing(false)
              }}
            >
              <X className="size-4" />
            </Button>
          </DialogHeader>
          <div className="overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {studioPanels.data && (
              <details className="mb-5 rounded-xl bg-muted/30 p-3">
                <summary className="min-h-10 text-sm">資料欄位</summary>
                <ReportDataFields
                  key={datasetEpoch}
                  onField={assignField}
                  onDataset={addDataset}
                />
              </details>
            )}
            {selectedObject ? (
              <StudioObjectInspector
                key={`${selectedObject.id}/${datasetEpoch}`}
                object={selectedObject}
                config={config}
                bookmarks={library.bookmarks}
                onChange={(next) =>
                  change({
                    ...config,
                    objects: (config.objects ?? []).map((item) =>
                      item.id === next.id ? next : item
                    ),
                  })
                }
                onDelete={() => {
                  change({
                    ...config,
                    objects: (config.objects ?? []).filter(
                      (item) => item.id !== selectedObject.id
                    ),
                  })
                  setSelectedId(null)
                }}
              />
            ) : (
              <ReportInspector {...inspectorProps} hideHeading />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={gallery} onOpenChange={setGallery}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-xl border p-4 shadow-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增視覺效果</DialogTitle>
            <DialogDescription>
              多種呈現方式，選擇後可再配置資料與格式。
            </DialogDescription>
          </DialogHeader>
          <ReportVisualGallery onSelect={addVisual} />
        </DialogContent>
      </Dialog>
      <Dialog open={pageSettings} onOpenChange={setPageSettings}>
        <DialogContent className="rounded-xl border shadow-xl">
          <DialogHeader>
            <DialogTitle>分頁設定</DialogTitle>
            <DialogDescription>
              替目前分頁命名，或把圖表移至其他頁。
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm">
            分頁名稱
            <input
              aria-label="分頁名稱"
              maxLength={40}
              className="h-11 w-full rounded-md border bg-card px-3 text-base"
              value={currentPage.name}
              onBlur={(event) => {
                const name = event.target.value.trim() || "未命名"
                if (name !== currentPage.name)
                  change({
                    ...config,
                    pages: pages.map((page) =>
                      page.id === currentPage.id ? { ...page, name } : page
                    ),
                  })
              }}
              onChange={(event) =>
                change({
                  ...config,
                  pages: pages.map((page) =>
                    page.id === currentPage.id
                      ? { ...page, name: event.target.value || "未命名" }
                      : page
                  ),
                })
              }
            />
          </label>
          <Button
            variant="outline"
            disabled={pages.length <= 1}
            className="rounded-md text-destructive shadow-none"
            onClick={deletePage}
          >
            <Trash2 className="size-4" />
            移除分頁，圖表移至其他頁
          </Button>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={currentPage.tooltip ?? false}
              onChange={(event) =>
                updateCurrentPage({ tooltip: event.target.checked })
              }
            />
            允許作為其他圖表的提示頁
          </label>
          <Button
            className="rounded-md shadow-none"
            onClick={() => setPageSettings(false)}
          >
            完成
          </Button>
        </DialogContent>
      </Dialog>
      {detailView && (
        <ReportDetailsDialog
          {...detailView}
          onClose={() => setDetailView(null)}
        />
      )}
      {exportView && (
        <ReportExportDialog
          config={queryConfig}
          pageId={currentPage.id}
          cardId={exportView.cardId}
          onClose={() => setExportView(null)}
        />
      )}
    </div>
  )
}

function ReportRenderFrame({
  loading,
  children,
}: {
  loading: boolean
  children: ReactNode
}) {
  const block = (event: SyntheticEvent) => {
    if (loading) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  return (
    <div
      className="relative max-w-full min-w-0"
      aria-busy={loading}
      onClickCapture={block}
      onPointerDownCapture={block}
      onKeyDownCapture={block}
      onChangeCapture={block}
    >
      {children}
      {loading && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-background/75 p-3 text-xs text-muted-foreground"
        >
          正在更新矩陣資料…
        </div>
      )}
    </div>
  )
}

function CanvasVisual({
  card,
  layout,
  filterOptions,
  data,
  editing,
  selected,
  loading,
  selections,
  onSelect,
  onPoint,
  onHover,
  onHoverEnd,
  explore,
  matrixView,
  onMatrixViewChange,
}: {
  card: ReportCard
  layout: ReportLayoutRender
  filterOptions: ReportFilterOptions
  data?: CardData
  editing: boolean
  selected: boolean
  loading: boolean
  selections: ReportSelectionPoint[]
  onSelect: ReportLayoutRender["onSelect"]
  onPoint: (sourceId: string, point: ReportSelectionPoint) => void
  onHover?: (point: ReportSelectionPoint) => void
  onHoverEnd?: () => void
  matrixView?: ReportMatrixView
  onMatrixViewChange: (view: ReportMatrixView) => void
  explore: Omit<
    ComponentProps<typeof ReportExploreControls>,
    "card" | "disabled"
  >
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    surfaceListeners,
  } = useReportCardDrag(card.id, !layout.draggable)
  const { widgetRef, widgetSize } = useReportWidgetSize(layout.fixedHeight)
  const setVisualRef = useCallback(
    (element: HTMLElement | null) => {
      setNodeRef(element)
      widgetRef(element)
    },
    [setNodeRef, widgetRef]
  )
  const tableHeight =
    card.height === "compact" ? 160 : card.height === "tall" ? 360 : 240
  const valueHeight =
    card.height === "compact" ? 64 : card.height === "tall" ? 180 : 96
  return (
    <article
      ref={setVisualRef}
      {...surfaceListeners}
      data-dragging={isDragging || undefined}
      style={
        {
          transform: CSS.Transform.toString(transform),
          transition,
          ...(layout.fixedHeight
            ? {
                height: layout.fixedHeight,
                "--report-plot-height": `${Math.max(96, layout.fixedHeight - 180)}px`,
              }
            : {}),
        } as CSSProperties
      }
      className={cn(
        "report-visual report-drag-surface min-w-0 self-start overflow-hidden bg-card",
        card.visual === "kpi" && "report-kpi",
        layout.fixedHeight && "report-fixed-visual flex flex-col",
        editing && selected
          ? "border-primary ring-1 ring-primary"
          : "border-border",
        isDragging && "z-30"
      )}
      aria-label={card.title}
      data-report-metric={card.metric}
      data-selected={editing && selected ? true : undefined}
      data-widget-size={widgetSize}
    >
      <div className="report-visual-heading flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="report-visual-title leading-snug wrap-break-word">
            <span
              ref={setActivatorNodeRef}
              {...(layout.draggable ? attributes : {})}
              onKeyDown={layout.draggable ? listeners?.onKeyDown : undefined}
              aria-label={
                layout.draggable
                  ? `移動報表：${card.title}，長按拖移或按空白鍵`
                  : undefined
              }
            >
              {card.title}
            </span>
          </h3>
          {card.visual === "kpi" ? (
            editing &&
            card.title !== METRICS[card.metric].label && (
              <p className="mt-1 text-xs text-muted-foreground">
                {METRICS[card.metric].label}
              </p>
            )
          ) : editing ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {METRICS[card.metric].label} · {DIMENSIONS[card.dimension]}
              {card.legend ? ` / ${DIMENSIONS[card.legend]}` : ""}
            </p>
          ) : null}
        </div>
        {layout.draggable && (
          <button
            type="button"
            aria-label={`調整圖表：${card.title}`}
            data-ui-demo="report-visual-edit"
            onClick={onSelect}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <Settings2 className="size-3.5" />
          </button>
        )}
      </div>
      <div
        className={
          layout.fixedHeight ? "min-h-0 flex-1 overflow-auto" : "contents"
        }
      >
        {!editing &&
          (widgetSize === "large" || !!explore.state?.steps.length) && (
            <ReportExploreControls
              card={card}
              disabled={loading || !data}
              {...explore}
            />
          )}
        {card.filters?.length || card.slicers?.length || card.date_range ? (
          <div
            className={
              widgetSize === "small"
                ? "report-widget-filter-summary mb-2"
                : "mb-3 space-y-1.5"
            }
          >
            {widgetSize === "small" && (
              <p className="text-xs text-muted-foreground">已套用單圖條件</p>
            )}
            <div className={widgetSize === "small" ? "sr-only" : undefined}>
              <ReportFilterChips
                options={filterOptions}
                filters={card.filters}
                slicers={card.slicers}
                scope="單圖"
              />
              {card.date_range && (
                <p className="text-xs text-muted-foreground">
                  單圖日期：{card.date_range.start} 至 {card.date_range.end}
                </p>
              )}
            </div>
          </div>
        ) : null}
        <div
          className="min-w-0 overflow-auto"
          style={
            layout.fixedHeight
              ? undefined
              : card.visual === "kpi"
                ? { minHeight: editing ? valueHeight : 0 }
                : card.visual === "table"
                  ? { height: tableHeight }
                  : undefined
          }
        >
          {data ? (
            <ReportRenderFrame loading={loading}>
              <ReportChart
                widgetSize={widgetSize}
                summary={!editing}
                card={card}
                data={data}
                onHoverData={editing ? undefined : onHover}
                onHoverEnd={onHoverEnd}
                onSelectData={
                  editing ? undefined : (point) => onPoint(card.id, point)
                }
                selections={selections}
                matrixView={matrixView}
                onMatrixViewChange={onMatrixViewChange}
                pointActionLabel={
                  explore.action === "drill"
                    ? "下鑽"
                    : explore.action === "page"
                      ? "跨頁分析"
                      : explore.action === "tooltip"
                        ? "查看提示頁"
                        : explore.action === "details"
                          ? "查看逐筆明細"
                          : "篩選"
                }
              />
            </ReportRenderFrame>
          ) : (
            <div
              className={cn(
                "rounded-md bg-muted/60",
                card.visual === "kpi" ? "h-16" : "h-48",
                loading && "motion-safe:animate-pulse"
              )}
              aria-label={loading ? "載入中" : "資料未載入"}
            />
          )}
        </div>
        {(widgetSize === "large" || (editing && !widgetSize)) && data?.note && (
          <p className="mt-3 border-t pt-2 text-xs leading-relaxed text-muted-foreground">
            {data.note}
          </p>
        )}
      </div>
    </article>
  )
}

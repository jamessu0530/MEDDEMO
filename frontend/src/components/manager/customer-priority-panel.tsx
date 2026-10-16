import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"

import { ApiError } from "@/api/client"
import {
  applyPriority,
  getPrioritySettings,
  previewPriority,
  savePriority,
  type MetricId,
  type PriorityPreview,
  type PriorityRow,
  type PrioritySettings,
  type PriorityStrategy,
} from "@/api/customer-priority"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import {
  METRIC_LABELS,
  metricPercent,
  metricValue,
  strategyFingerprint,
  validStrategy,
} from "@/lib/customer-priority"
import { cn } from "@/lib/utils"
import { CustomerPriorityAdvisor } from "@/components/manager/customer-priority-advisor"

const SERIES: Record<MetricId, string> = {
  revenue: "bg-sky-500",
  growth: "bg-amber-500",
  net_margin: "bg-emerald-500",
  frequency: "bg-violet-500",
  recency: "bg-rose-500",
  visit_gap: "bg-cyan-600",
}
type Preview = { fingerprint: string; data: PriorityPreview }
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "暫時無法完成，請再試一次"

export function CustomerPriorityPanel() {
  const [managerId, setManagerId] = useState<string>()
  const [settings, setSettings] = useState<PrioritySettings | null>(null)
  const [savedStrategies, setSavedStrategies] = useState<PriorityStrategy[]>([])
  const [selected, setSelected] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [repFilter, setRepFilter] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const previewAbort = useRef<AbortController | null>(null)
  const draft = settings?.strategies.find((s) => s.id === selected)
  const fingerprint =
    settings && draft ? strategyFingerprint(settings.manager_id, draft) : ""
  const currentPreview =
    preview?.fingerprint === fingerprint ? preview.data : null
  const dirty = Boolean(
    settings &&
    JSON.stringify(settings.strategies) !== JSON.stringify(savedStrategies)
  )

  useEffect(() => {
    const controller = new AbortController()
    const generation = ++latest.current
    void getPrioritySettings(managerId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted || latest.current !== generation) return
        setSettings(data)
        setSavedStrategies(data.strategies)
        setSelected(data.active_id ?? data.strategies[0].id)
        setPreview(null)
        setLoading(false)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(e))
          setLoading(false)
        }
      })
    return () => {
      controller.abort()
      previewAbort.current?.abort()
    }
  }, [managerId, attempt])

  function edit(update: (draft: PriorityStrategy) => PriorityStrategy) {
    if (!settings || !draft) return
    ++latest.current
    previewAbort.current?.abort()
    setSettings({
      ...settings,
      strategies: settings.strategies.map((s) =>
        s.id === selected ? update(s) : s
      ),
    })
    setNotice(null)
  }

  async function runPreview(strategy = draft, state = settings) {
    if (!state || !strategy || !validStrategy(strategy)) return
    const generation = ++latest.current
    previewAbort.current?.abort()
    const controller = new AbortController()
    previewAbort.current = controller
    setBusy(true)
    setError(null)
    try {
      const data = await previewPriority(
        state.manager_id,
        strategy,
        controller.signal
      )
      if (latest.current === generation)
        setPreview({
          fingerprint: strategyFingerprint(state.manager_id, strategy),
          data,
        })
    } catch (e) {
      if (!controller.signal.aborted && latest.current === generation)
        setError(errorText(e))
    } finally {
      if (latest.current === generation) setBusy(false)
    }
  }

  async function persist(activate: boolean) {
    if (!settings || !draft || !currentPreview) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const data = await savePriority(
        settings,
        activate ? selected : settings.active_id
      )
      setSettings(data)
      setSavedStrategies(data.strategies)
      const strategy = data.strategies.find((s) => s.id === selected)!
      const result = await previewPriority(data.manager_id, strategy)
      setPreview({
        fingerprint: strategyFingerprint(data.manager_id, strategy),
        data: result,
      })
      setNotice(
        activate || settings.active_id === selected
          ? "策略已啟用，之後建立的行程會使用這份設定。下方可另外套用今天尚未開始的行程。"
          : "策略已儲存。"
      )
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply(repId: string, version: number) {
    if (!settings || !draft || !currentPreview) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await applyPriority(
        settings.manager_id,
        settings.revision,
        repId,
        version
      )
      const result = await previewPriority(settings.manager_id, draft)
      setPreview({ fingerprint, data: result })
      setNotice("今天的建議已更新，業務首頁與團隊行程會顯示新路線。")
    } catch (e) {
      setError(errorText(e))
      if (e instanceof ApiError && e.status === 409) setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  function addStrategy() {
    if (!settings || !draft || settings.strategies.length >= 8) return
    const copy = structuredClone(draft)
    copy.id = crypto.randomUUID()
    copy.name = `${draft.name.slice(0, 32)}副本`
    setSettings({ ...settings, strategies: [...settings.strategies, copy] })
    setSelected(copy.id)
    setPreview(null)
    setNotice(null)
  }

  if (loading)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        載入客戶策略…
      </p>
    )
  if (!settings || !draft)
    return (
      <div role="alert" className="space-y-3">
        <p>{error}</p>
        <Button
          onClick={() => {
            setLoading(true)
            setAttempt((v) => v + 1)
          }}
        >
          重新載入
        </Button>
      </div>
    )

  const rows = preview?.data.rows ?? []
  const visibleRows = rows.filter(
    (r) =>
      (!repFilter || r.owner_id === repFilter) &&
      `${r.customer_name} ${r.area}`.includes(query)
  )
  const active = savedStrategies.find((s) => s.id === settings.active_id)
  const allValid = settings.strategies.every(validStrategy)
  const byId = new Map(rows.map((r) => [r.customer_id, r.customer_name]))

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">客戶優先策略</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {active
              ? `目前使用：${active.name}`
              : "尚未啟用經營策略，現有路線沿用原本建議。"}
          </p>
        </div>
        {settings.managers.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            主管
            <NativeSelect
              disabled={busy || dirty}
              value={settings.manager_id}
              onChange={(e) => {
                setLoading(true)
                setManagerId(e.target.value)
                setRepFilter("")
                setQuery("")
              }}
            >
              {settings.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>
      <CustomerPriorityAdvisor
        key={`${settings.manager_id}:${selected}`}
        managerId={settings.manager_id}
        strategy={draft}
        disabled={
          busy ||
          !validStrategy({
            ...draft,
            metrics: [{ metric: "revenue", weight: 1, direction: "higher" }],
          })
        }
        onUse={(suggested, baseFingerprint) => {
          if (busy || baseFingerprint !== fingerprint) return
          const next = {
            ...suggested,
            id: draft.id,
            priority_customers: draft.priority_customers,
          }
          edit(() => next)
          setNotice(
            "建議已帶入草稿。請確認下方排名，還可繼續調整，再決定是否儲存啟用。"
          )
          void runPreview(next)
        }}
      />
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}{" "}
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={() => {
              setLoading(true)
              setAttempt((v) => v + 1)
            }}
          >
            重新載入設定
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-primary/10 p-3 text-sm">
          {notice}
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1 text-sm">
              <span>策略</span>
              <NativeSelect
                className="w-full"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value)
                  setPreview(null)
                  setNotice(null)
                }}
              >
                {settings.strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {settings.active_id === s.id ? " · 啟用中" : ""}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button
              variant="outline"
              disabled={settings.strategies.length >= 8}
              onClick={addStrategy}
            >
              另存新策略
            </Button>
          </div>
          <label className="block space-y-1 text-sm">
            <span>策略名稱</span>
            <Input
              value={draft.name}
              maxLength={40}
              onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span>統計天數</span>
              <Input
                type="number"
                min={7}
                max={365}
                value={draft.days || ""}
                onChange={(e) =>
                  edit((d) => ({ ...d, days: Number(e.target.value) }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>每天建議站數</span>
              <Input
                type="number"
                min={1}
                max={8}
                value={draft.daily_limit || ""}
                onChange={(e) =>
                  edit((d) => ({ ...d, daily_limit: Number(e.target.value) }))
                }
              />
            </label>
          </div>
          <div className="space-y-4">
            <p className="text-sm font-medium">指標與相對權重</p>
            {settings.metrics.map((m) => {
              const rule = draft.metrics.find((r) => r.metric === m.id)
              const weight = rule?.weight ?? 0
              const change = (
                value: number,
                direction = rule?.direction ?? "higher"
              ) =>
                edit((d) => ({
                  ...d,
                  metrics: [
                    ...d.metrics.filter((r) => r.metric !== m.id),
                    { metric: m.id, weight: value, direction },
                  ],
                }))
              return (
                <div key={m.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor={`priority-${m.id}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        id={`priority-${m.id}`}
                        type="checkbox"
                        checked={weight > 0}
                        onChange={(e) => change(e.target.checked ? 10 : 0)}
                      />
                      {m.label}
                    </label>
                    <span className="text-sm tabular-nums">
                      {metricPercent(draft.metrics, m.id).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      aria-label={`${m.label}權重`}
                      min={0}
                      max={100}
                      step={1}
                      value={weight}
                      onChange={(e) => change(Number(e.target.value))}
                      className="min-w-0 flex-1 accent-primary"
                    />
                    <NativeSelect
                      aria-label={`${m.label}優先方向`}
                      value={rule?.direction ?? "higher"}
                      onChange={(e) =>
                        change(weight, e.target.value as "higher" | "lower")
                      }
                      className="w-32 text-xs"
                    >
                      <option value="higher">數值高的優先</option>
                      <option value="lower">數值低的優先</option>
                    </NativeSelect>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {m.description}
                  </p>
                </div>
              )
            })}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            各指標先依團隊範圍轉成 0～100
            分，再按權重加總。缺資料或整組數值相同時採中性 50
            分。分數表示這份策略的優先程度。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!validStrategy(draft)}
              onClick={() => void runPreview()}
            >
              {busy ? "處理中…" : "預覽排名"}
            </Button>
            <Button
              variant="outline"
              disabled={!currentPreview || !allValid}
              onClick={() => void persist(false)}
            >
              {settings.active_id === selected ? "更新啟用中策略" : "儲存設定"}
            </Button>
            <Button
              disabled={!currentPreview || !allValid}
              onClick={() => void persist(true)}
            >
              儲存並啟用
            </Button>
          </div>
          {dirty && (
            <p className="text-xs text-muted-foreground">
              有尚未儲存的設定。調整後請重新預覽。
            </p>
          )}
          {settings.strategies.length > 1 && (
            <Button
              variant="ghost"
              disabled={settings.active_id === selected}
              onClick={() => {
                setSettings({
                  ...settings,
                  strategies: settings.strategies.filter(
                    (s) => s.id !== selected
                  ),
                })
                setSelected(
                  settings.active_id ??
                    settings.strategies.find((s) => s.id !== selected)!.id
                )
                setPreview(null)
              }}
            >
              移除這份未啟用策略
            </Button>
          )}
          {settings.updated_by && (
            <p className="text-xs text-muted-foreground">
              第 {settings.revision} 版 · {settings.updated_by} 更新
            </p>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">評分方法與研究參考</summary>
            <p className="mt-2 leading-relaxed">
              採用可調權重的多準則評分，參考加權 RFM。直接調權重與 AHP
              的兩兩比較流程不同。
            </p>
            <a
              className="mt-2 block underline"
              href="https://ieeexplore.ieee.org/document/10825251/"
              target="_blank"
              rel="noreferrer"
            >
              IEEE BigData 2024：RFMI 客戶分群
            </a>
            <a
              className="mt-1 block underline"
              href="https://doi.org/10.3390/math9161836"
              target="_blank"
              rel="noreferrer"
            >
              2021：依商業目標調整 RFM 權重
            </a>
          </details>
        </fieldset>
        <div className="min-w-0 space-y-5">
          {!preview ? (
            <div className="rounded-2xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
              設定重視的指標後，按「預覽排名」查看實際團隊客戶。
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="font-semibold">客戶排名</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {preview.data.date} · 共 {rows.length} 家
                    {!currentPreview && " · 設定已改，請重新預覽"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input
                    aria-label="搜尋客戶"
                    placeholder="搜尋客戶或地區"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-40"
                  />
                  <NativeSelect
                    aria-label="篩選業務"
                    value={repFilter}
                    onChange={(e) => setRepFilter(e.target.value)}
                  >
                    <option value="">全部業務</option>
                    {preview.data.routes.map((r) => (
                      <option key={r.rep_id} value={r.rep_id}>
                        {r.rep_name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                主管指定優先納入每日名單；實際走訪順序仍會考慮約定時間與車程。
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {draft.metrics
                  .filter((m) => m.weight > 0)
                  .map((m) => (
                    <span className="flex items-center gap-1" key={m.metric}>
                      <span
                        className={cn("size-2 rounded-sm", SERIES[m.metric])}
                      />
                      {METRIC_LABELS[m.metric]}
                    </span>
                  ))}
              </div>
              <div
                className={cn(
                  "max-h-[38rem] space-y-2 overflow-y-auto pr-1",
                  !currentPreview && "opacity-65"
                )}
              >
                {visibleRows.slice(0, 50).map((row) => (
                  <RankRow
                    key={row.customer_id}
                    row={row}
                    draft={draft}
                    disabled={busy}
                    expanded={expanded === row.customer_id}
                    onExpand={() =>
                      setExpanded(
                        expanded === row.customer_id ? null : row.customer_id
                      )
                    }
                    onChange={(reason, until, enabled) =>
                      edit((d) => ({
                        ...d,
                        priority_customers: [
                          ...d.priority_customers.filter(
                            (c) => c.customer_id !== row.customer_id
                          ),
                          ...(enabled
                            ? [{ customer_id: row.customer_id, reason, until }]
                            : []),
                        ],
                      }))
                    }
                  />
                ))}
                {!visibleRows.length && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    沒有符合的客戶。
                  </p>
                )}
                {visibleRows.length > 50 && (
                  <p className="text-xs text-muted-foreground">
                    顯示前 50 家，可用搜尋或業務篩選找到其他客戶。
                  </p>
                )}
              </div>
            </>
          )}
          {draft.priority_customers.some((p) => !byId.has(p.customer_id)) && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">已指定的客戶</h3>
              {draft.priority_customers
                .filter((p) => !byId.has(p.customer_id))
                .map((p) => (
                  <div
                    key={p.customer_id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {p.customer_id} · {p.reason}
                    </span>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        edit((d) => ({
                          ...d,
                          priority_customers: d.priority_customers.filter(
                            (c) => c.customer_id !== p.customer_id
                          ),
                        }))
                      }
                    >
                      移除
                    </Button>
                  </div>
                ))}
            </div>
          )}
          {currentPreview && settings.active_id === selected && !dirty && (
            <div className="space-y-3 border-t pt-5">
              <h3 className="font-semibold">套用今天的建議</h3>
              {currentPreview.routes.map((r) => (
                <div
                  key={r.rep_id}
                  className="space-y-2 rounded-2xl border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      className="text-sm font-medium underline"
                      to={`/manager?rep=${r.rep_id}`}
                    >
                      {r.rep_name}
                    </Link>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || Boolean(r.blocked)}
                      onClick={() => void apply(r.rep_id, r.version)}
                    >
                      更新今天建議
                    </Button>
                  </div>
                  <p className="text-sm">
                    {r.suggested_ids
                      .map((id) => byId.get(id) ?? id)
                      .join("、") || "今天沒有可建議的客戶"}
                  </p>
                  {r.blocked && (
                    <p className="text-xs text-muted-foreground">{r.blocked}</p>
                  )}
                  {r.priority_overflow > 0 && (
                    <p className="text-xs text-muted-foreground">
                      指定客戶超過剩餘站數，依計算分數取前幾家。
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RankRow({
  row,
  draft,
  disabled,
  expanded,
  onExpand,
  onChange,
}: {
  row: PriorityRow
  draft: PriorityStrategy
  disabled: boolean
  expanded: boolean
  onExpand: () => void
  onChange: (reason: string, until: string | null, enabled: boolean) => void
}) {
  const pin = draft.priority_customers.find(
    (p) => p.customer_id === row.customer_id
  )
  const change =
    row.previous_rank === null ? null : row.previous_rank - row.rank
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="w-6 pt-1 text-sm text-muted-foreground tabular-nums">
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={onExpand}
              aria-expanded={expanded}
              className="min-h-8 text-left text-sm font-semibold"
            >
              {row.customer_name}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {row.owner_name}
              </span>
            </button>
            <span className="text-sm tabular-nums">
              {row.score.toFixed(1)} 分
              {change !== null && change !== 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {change > 0 ? `↑${change}` : `↓${-change}`}
                </span>
              )}
            </span>
          </div>
          <div
            className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={row.parts
              .filter((p) => p.weight > 0)
              .map(
                (p) =>
                  `${METRIC_LABELS[p.metric]} ${p.contribution.toFixed(1)} 分`
              )
              .join("、")}
          >
            {row.parts.map((p) => (
              <span
                key={p.metric}
                style={{ width: `${p.contribution}%` }}
                className={SERIES[p.metric]}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              營收 {metricValue("revenue", row.values.revenue)} · 成長{" "}
              {metricValue("growth", row.values.growth)}
            </span>
            <label className="flex min-h-8 items-center gap-2 text-xs">
              <input
                type="checkbox"
                disabled={disabled}
                checked={Boolean(pin)}
                onChange={(e) =>
                  onChange(
                    pin?.reason ?? "主管重點維繫客戶",
                    pin?.until ?? null,
                    e.target.checked
                  )
                }
              />
              主管指定
            </label>
          </div>
        </div>
      </div>
      {pin && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem]">
          <Input
            aria-label={`${row.customer_name}指定原因`}
            placeholder="指定原因"
            disabled={disabled}
            value={pin.reason}
            maxLength={160}
            onChange={(e) => onChange(e.target.value, pin.until, true)}
          />
          <Input
            aria-label={`${row.customer_name}指定有效期限`}
            type="date"
            disabled={disabled}
            value={pin.until ?? ""}
            onChange={(e) => onChange(pin.reason, e.target.value || null, true)}
          />
        </div>
      )}
      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-3 text-xs">
          <p>{row.reason}</p>
          {row.parts.map((p) => (
            <div className="flex justify-between gap-3" key={p.metric}>
              <span>
                {METRIC_LABELS[p.metric]} · {metricValue(p.metric, p.value)}
              </span>
              <span className="tabular-nums">
                {p.normalized.toFixed(1)} × {p.weight.toFixed(1)}% ={" "}
                {p.contribution.toFixed(1)} 分
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

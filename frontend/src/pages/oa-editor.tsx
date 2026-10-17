import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { ClipboardCheck, Save, Sparkles } from "@/components/icons"
import {
  getOaCatalog,
  getOaCustomers,
  getOaForm,
  prefillOa,
  saveOaDraft,
  type LegacyPayload,
  type OaCatalog,
  type OaTemplate,
  type OaCustomer,
} from "@/api/oa"
import { SearchSelect } from "@/components/ui/search-select"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { OaDemoButton } from "@/components/ui-demo/oa-demo-button"
import { useAuth } from "@/lib/auth"
import { pendingOa } from "@/lib/manager-counts"
import { fillOaBlanks, oaMissing } from "@/lib/oa-legacy"
import { useAskPageContext } from "@/ask/use-page-context"
import { oaEditorContext } from "@/ask/oa-page-help"

export function OaEditorPage() {
  const { code, formId } = useParams()
  return (
    <OaEditor
      key={formId ?? code}
      code={code}
      id={formId ? Number(formId) : undefined}
    />
  )
}

function OaEditor({ code, id }: { code?: string; id?: number }) {
  const navigate = useNavigate()
  const user = useAuth()?.user
  const [catalog, setCatalog] = useState<OaCatalog | null>(null)
  const [template, setTemplate] = useState<OaTemplate | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [sources, setSources] = useState<Record<string, string>>({})
  const [purpose, setPurpose] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const working = useRef(false)
  const prefillController = useRef<AbortController | null>(null)

  useEffect(() => {
    window.scrollTo({ top: 0 })
    const controller = new AbortController()
    async function load() {
      try {
        const [data, form] = await Promise.all([
          getOaCatalog(controller.signal),
          id ? getOaForm(id, controller.signal) : Promise.resolve(null),
        ])
        if (form && (form.kind !== "legacy" || !form.can_edit))
          throw new Error("這張單目前不能編輯，請返回申請單查看")
        const payload = form?.payload as LegacyPayload | null
        const selected = data.templates.find(
          (item) => item.code === (payload?.template_code ?? code)
        )
        if (!selected || selected.query_only)
          throw new Error("找不到可建立的表單")
        let initial = payload?.fields ?? {}
        if (!form) {
          const known = await prefillOa(
            selected.code,
            "known",
            null,
            "",
            controller.signal
          )
          initial = known.fields
          if (!controller.signal.aborted) setSources(known.sources)
        }
        if (controller.signal.aborted) return
        setCatalog(data)
        setTemplate(selected)
        setFields(initial)
        setPurpose(form?.purpose ?? "")
        setCustomerId(form?.customer_id ?? "")
        setCustomerName(form?.customer_name ?? "")
        setReady(true)
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "無法載入表單")
      }
    }
    void load()
    return () => {
      controller.abort()
      prefillController.current?.abort()
    }
  }, [code, id, attempt])

  const missing =
    template && catalog
      ? oaMissing(template, catalog.common_fields, fields, purpose, customerId)
      : []

  useAskPageContext(
    template && catalog
      ? oaEditorContext(
          template,
          catalog.common_fields,
          fields,
          purpose,
          customerId
        )
      : {},
    ready
  )

  async function fill(mode: "known" | "text") {
    if (!template || working.current) return
    working.current = true
    const controller = new AbortController()
    prefillController.current = controller
    setBusy(mode)
    setError("")
    setMessage("")
    try {
      const result = await prefillOa(
        template.code,
        mode,
        customerId || null,
        text,
        controller.signal
      )
      if (controller.signal.aborted) return
      const added = Object.fromEntries(
        Object.entries(result.sources).filter(([key]) => !fields[key]?.trim())
      )
      setFields((current) => fillOaBlanks(current, result.fields))
      setSources((current) => ({ ...current, ...added }))
      setPurpose((current) => (current.trim() ? current : result.purpose))
      setMessage(result.message + " 已填寫的內容會保留。")
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "帶入失敗，請再試一次")
    } finally {
      working.current = false
      if (!controller.signal.aborted) setBusy("")
    }
  }

  async function save(submit: boolean) {
    if (!template || working.current) return
    working.current = true
    setBusy(submit ? "submit" : "save")
    setError("")
    try {
      const form = await saveOaDraft(
        {
          template_code: template.code,
          customer_id: customerId || null,
          fields,
          purpose,
          submit,
        },
        id
      )
      if (submit) void pendingOa.refresh()
      navigate(`/oa/forms/${form.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗，請再試一次")
    } finally {
      working.current = false
      setBusy("")
    }
  }

  return (
    <div className="min-h-svh pb-32 lg:pb-0">
      <PageHeader
        title={template?.title ?? "OA 表單"}
        subtitle={id ? "編輯草稿" : "建立申請"}
        backTo={id ? `/oa/forms/${id}` : "/oa/apps"}
        trailing={<OaDemoButton disabled={!ready || Boolean(busy)} />}
      />
      {!ready && !error && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          載入表單中…
        </p>
      )}
      {!ready && error && (
        <div className="p-6 text-sm">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              setError("")
              setAttempt((n) => n + 1)
            }}
          >
            重新載入
          </Button>
        </div>
      )}
      {ready && template && catalog && (
        <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:px-8">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="rounded-2xl border bg-muted/50 p-4 text-sm leading-relaxed">
              <p className="font-semibold">
                {template.display_code ? `${template.display_code} · ` : ""}
                OA 申請表單
              </p>
              <p className="mt-1 text-muted-foreground">
                填妥申請資料，核對後送主管簽核。
              </p>
              {template.sap_origin && (
                <p className="mt-2 font-medium text-amber-700 dark:text-amber-400">
                  PR／PO 須由 SAP 起單；此處可先整理申請資料，無法代建 SAP
                  單據。
                </p>
              )}
            </div>
            <section className="rounded-2xl border-2 bg-card p-4 shadow-lip sm:p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <Sparkles className="size-5 text-primary" />
                助理幫你填
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                貼上申請內容，助理只整理有提供的資料；每個欄位都能修改。未提供的資料會保留空白。
              </p>
              <Textarea
                aria-label="申請內容"
                data-ui-demo="oa-assistant-content"
                className="mt-3"
                rows={3}
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={Boolean(busy)}
                placeholder={`依欄位名稱輸入：${template.fields
                  .slice(0, 3)
                  .map((field) => `${field.label}：`)
                  .join("；")}`}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  className="min-h-11"
                  disabled={Boolean(busy) || !text.trim()}
                  onClick={() => void fill("text")}
                >
                  <Sparkles />
                  {busy === "text" ? "整理中…" : "依內容預填空白欄位"}
                </Button>
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void fill("known")}
                  data-ui-demo="oa-fill-known"
                >
                  帶入帳號資料
                </Button>
              </div>
              {message && (
                <p role="status" className="mt-3 text-sm text-primary">
                  {message}
                </p>
              )}
            </section>
            <section className="rounded-2xl border-2 bg-card p-4 shadow-lip sm:p-5">
              <h2 className="mb-4 font-semibold">申請資料</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                申請人：{user?.acting_as?.name ?? user?.name} ·{" "}
                {user?.acting_as?.id ?? user?.id}
                <span className="ml-2 text-xs">依登入身分帶入</span>
              </p>
              <fieldset
                disabled={Boolean(busy)}
                className="grid min-w-0 gap-4 sm:grid-cols-2"
              >
                <div
                  data-ui-demo="oa-customer"
                  className="min-w-0 sm:col-span-2"
                >
                  <OaCustomerSelect
                    label={`客戶${template.needs_customer ? "（必填）" : "（選填）"}`}
                    value={customerId}
                    selectedName={customerName}
                    disabled={Boolean(busy)}
                    onSelect={(customer) => {
                      setCustomerId(customer.id)
                      setCustomerName(customer.name)
                    }}
                  />
                  {customerId && (
                    <button
                      className="mt-1 text-xs text-muted-foreground underline"
                      type="button"
                      onClick={() => {
                        setCustomerId("")
                        setCustomerName("")
                      }}
                    >
                      清除客戶
                    </button>
                  )}
                </div>
                {[...catalog.common_fields, ...template.fields].map((field) => (
                  <label
                    key={field.key}
                    data-ui-demo="oa-form-field"
                    className={
                      field.type === "textarea"
                        ? "flex min-w-0 flex-col gap-1.5 sm:col-span-2"
                        : "flex min-w-0 flex-col gap-1.5"
                    }
                  >
                    <span className="text-sm font-medium">
                      {field.label}
                      {field.required && (
                        <span className="ml-1 text-destructive">*</span>
                      )}
                    </span>
                    {field.type === "textarea" ? (
                      <Textarea
                        rows={3}
                        value={fields[field.key] ?? ""}
                        maxLength={2000}
                        onChange={(e) => {
                          setFields((v) => ({
                            ...v,
                            [field.key]: e.target.value,
                          }))
                          setSources((v) => ({ ...v, [field.key]: "手動填寫" }))
                        }}
                      />
                    ) : (
                      <Input
                        type={field.type}
                        min={field.type === "number" ? "0.01" : undefined}
                        step={field.type === "number" ? "any" : undefined}
                        maxLength={2000}
                        value={fields[field.key] ?? ""}
                        onChange={(e) => {
                          setFields((v) => ({
                            ...v,
                            [field.key]: e.target.value,
                          }))
                          setSources((v) => ({ ...v, [field.key]: "手動填寫" }))
                        }}
                      />
                    )}
                    {sources[field.key] && (
                      <span className="text-xs leading-relaxed break-words text-muted-foreground">
                        {sources[field.key]}
                      </span>
                    )}
                  </label>
                ))}
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-sm font-medium">
                    申請目的／說明
                    <span className="ml-1 text-destructive">*</span>
                  </span>
                  <Textarea
                    rows={4}
                    maxLength={2000}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="說明申請原因、用途與需要協助的事項"
                    data-ui-demo="oa-purpose"
                  />
                </label>
              </fieldset>
            </section>
          </div>
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
            <section
              id="oa-review"
              className="scroll-mt-20 rounded-2xl border-2 bg-card p-5 shadow-lip"
            >
              <h2 className="flex items-center gap-2 font-semibold">
                <ClipboardCheck className="size-5 text-primary" />
                送出前確認
              </h2>
              <p data-ui-demo="oa-missing" className="mt-3 text-sm font-medium">
                {missing.length
                  ? `還缺 ${missing.length} 項資料`
                  : "必填資料已齊全"}
              </p>
              {missing.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {missing.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  請再核對金額、日期、單號與申請內容。
                </p>
              )}
              <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                簽核流程：申請人 → 直屬主管。退回後可修改再送。
              </p>
              {error && (
                <p
                  role="alert"
                  className="mt-3 hidden text-sm text-destructive lg:block"
                >
                  {error}
                </p>
              )}
              <div
                data-ui-demo="oa-submit-area"
                className="mt-4 hidden flex-col gap-3 lg:flex"
              >
                <Button
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void save(false)}
                  data-ui-demo="oa-save-draft"
                >
                  <Save />
                  {busy === "save" ? "儲存中…" : "儲存草稿"}
                </Button>
                <Button
                  disabled={Boolean(busy) || missing.length > 0}
                  onClick={() => void save(true)}
                >
                  <ClipboardCheck />
                  {busy === "submit" ? "送出中…" : "送出申請"}
                </Button>
              </div>
            </section>
            <p className="px-2 text-xs leading-relaxed text-muted-foreground">
              缺少正式欄位、附件或簽核規則？回到「我的應用」可複製待補資料清單給業務。
            </p>
          </aside>
        </main>
      )}
      {ready && template && (
        <div
          data-page-footer
          aria-label="表單操作"
          className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 pt-1 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
        >
          <a
            href="#oa-review"
            className="flex min-h-8 items-center justify-between gap-2 text-xs text-muted-foreground"
          >
            <span>
              {missing.length
                ? `還缺 ${missing.length} 項資料`
                : "必填資料已齊全"}
            </span>
            <span className="text-primary underline">查看送出前確認</span>
          </a>
          {error && (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <div data-ui-demo="oa-submit-area" className="grid grid-cols-2 gap-3">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => void save(false)}
              data-ui-demo="oa-save-draft"
            >
              <Save />
              {busy === "save" ? "儲存中…" : "儲存草稿"}
            </Button>
            <Button
              className="min-h-11"
              disabled={Boolean(busy) || missing.length > 0}
              onClick={() => void save(true)}
            >
              <ClipboardCheck />
              {busy === "submit" ? "送出中…" : "送出申請"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function OaCustomerSelect({
  label,
  value,
  selectedName,
  onSelect,
  disabled,
}: {
  label: string
  value: string
  selectedName: string
  onSelect: (customer: OaCustomer) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<OaCustomer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      getOaCustomers(query, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setItems(data)
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setError(err instanceof Error ? err.message : "客戶沒有載入")
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, attempt])
  return (
    <SearchSelect
      label={label}
      value={value}
      remote
      disabled={disabled}
      placeholder="請選擇客戶"
      searchPlaceholder="搜尋客戶名稱、代碼或地區"
      options={items.map((item) => ({
        value: item.id,
        label: item.name,
        description: `${item.region} · ${item.city}${item.area}`,
        meta: item.id,
      }))}
      selectedOptions={value ? [{ value, label: selectedName }] : []}
      onValueChange={(id) => {
        const item = items.find((entry) => entry.id === id)
        if (item) onSelect(item)
      }}
      loading={loading}
      error={error}
      onRetry={() => {
        setError("")
        setLoading(true)
        setAttempt((n) => n + 1)
      }}
      onQueryChange={(next) => {
        setQuery(next)
        setError("")
        setLoading(true)
      }}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setLoading(true)
          setError("")
        }
      }}
    />
  )
}

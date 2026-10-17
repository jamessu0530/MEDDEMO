import { useEffect, useState } from "react"
import { Link } from "react-router"
import { ArrowUpRight, Check, Copy, FileText, Search } from "@/components/icons"
import { getOaCatalog, type OaCatalog } from "@/api/oa"
import { OaNav } from "@/components/oa-nav"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OaDemoButton } from "@/components/ui-demo/oa-demo-button"
import { businessGapText } from "@/lib/oa-legacy"
import { cn } from "@/lib/utils"
import { useAskPageContext } from "@/ask/use-page-context"

export function OaAppsPage() {
  const [catalog, setCatalog] = useState<OaCatalog | null>(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("全部")
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  useEffect(() => {
    window.scrollTo({ top: 0 })
    const controller = new AbortController()
    getOaCatalog(controller.signal)
      .then(setCatalog)
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "表單沒有載入")
      })
    return () => controller.abort()
  }, [attempt])
  const items =
    catalog?.templates.filter(
      (item) =>
        (category === "全部" || item.category === category) &&
        `${item.code} ${item.title} ${item.description}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
    ) ?? []
  useAskPageContext(
    {
      title: "OA 表單中心",
      facts: [
        `表單分類：${category}`,
        `表單搜尋：${query.trim() || "無"}`,
        `目前顯示 ${items.length} 個表單入口，共 ${catalog?.templates.length ?? 0} 個入口`,
      ],
    },
    Boolean(catalog)
  )
  return (
    <div className="min-h-svh">
      <PageHeader
        title="OA 表單中心"
        subtitle="我的應用"
        backTo="/oa/forms"
        trailing={<OaDemoButton disabled={!catalog} />}
      />
      <OaNav />
      <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8">
        <div className="rounded-2xl border bg-primary/5 p-5">
          <p className="font-semibold">從熟悉的表單開始，讓助理先幫你填</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            選表單 → 帶入帳號資料或貼上申請內容 → 核對缺漏 →
            存草稿或送主管簽核。
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            未提供的欄位保留空白。各表單的附件、權限與簽核規則可向業務窗口確認。
          </p>
        </div>
        <label className="relative block">
          <Search className="absolute top-3.5 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="搜尋 OA 表單"
            data-ui-demo="oa-template-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋表單名稱、代碼或用途"
            className="pl-10"
          />
        </label>
        <div
          data-ui-demo="oa-template-categories"
          className="flex flex-wrap gap-2"
          aria-label="表單分類"
        >
          {[
            "全部",
            ...new Set(catalog?.templates.map((item) => item.category)),
          ].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className={cn(
                "min-h-11 rounded-full border px-4 py-2 text-sm",
                category === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground"
              )}
            >
              {value}
            </button>
          ))}
        </div>
        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
            <Button
              variant="outline"
              className="ml-3"
              onClick={() => {
                setError("")
                setAttempt((n) => n + 1)
              }}
            >
              重新載入
            </Button>
          </div>
        )}
        {!catalog && !error && (
          <p className="py-10 text-center text-muted-foreground">載入表單中…</p>
        )}
        {catalog && (
          <p className="text-xs text-muted-foreground">
            共 {items.length} 個入口
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.code}
              className="flex flex-col gap-3 rounded-2xl border-2 bg-card p-5 shadow-lip"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-lg bg-muted px-2 py-1 text-xs font-medium">
                  {item.display_code || "OA 表單"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.category}
                </span>
              </div>
              <h2 className="flex items-start gap-2 font-semibold">
                <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
                {item.title}
              </h2>
              <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                {item.description}
              </p>
              {item.sap_origin && (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  正式流程須由 SAP 起單
                </p>
              )}
              <Button asChild variant="outline" className="mt-1 w-full">
                <Link
                  data-ui-demo={
                    item.query_only ? undefined : "oa-create-template"
                  }
                  to={
                    item.query_only
                      ? "/oa/forms?application=expense"
                      : `/oa/new/${item.code}`
                  }
                >
                  {item.query_only ? "查詢報銷清單" : "建立表單"}
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
            </article>
          ))}
        </div>
        {catalog && !items.length && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            沒有符合的表單，試試其他名稱或分類。
          </p>
        )}
        {catalog && (
          <details className="rounded-2xl border-2 bg-card p-5" open>
            <summary className="cursor-pointer font-semibold">
              請業務協助補齊的資料
            </summary>
            <p className="mt-3 text-sm text-muted-foreground">
              這份清單可複製給業務窗口，確認後才能對齊正式系統。
            </p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {catalog.business_gaps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
            <Button
              variant="outline"
              className="mt-4"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    businessGapText(catalog.business_gaps)
                  )
                  setCopied(true)
                  setCopyError(false)
                } catch {
                  setCopyError(true)
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "已複製" : "複製給業務"}
            </Button>
            {copyError && (
              <textarea
                readOnly
                aria-label="待補資料文字"
                className="mt-3 h-48 w-full rounded-xl border p-3 text-sm"
                value={businessGapText(catalog.business_gaps)}
                onFocus={(e) => e.target.select()}
              />
            )}
          </details>
        )}
      </main>
    </div>
  )
}

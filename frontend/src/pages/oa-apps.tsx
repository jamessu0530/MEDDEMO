import { useEffect, useState } from "react"
import { Link } from "react-router"
import { ArrowUpRight, FileText, Search } from "@/components/icons"
import { getOaCatalog, type OaCatalog } from "@/api/oa"
import { OaNav } from "@/components/oa-nav"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useAskPageContext } from "@/ask/use-page-context"

export function OaAppsPage() {
  const [catalog, setCatalog] = useState<OaCatalog | null>(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("全部")
  const [attempt, setAttempt] = useState(0)
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
      />
      <OaNav />
      <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-muted-foreground md:size-6" />
          <Input
            aria-label="搜尋 OA 表單"
            data-ui-demo="oa-template-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋表單名稱、代碼或用途"
            className="h-14 rounded-2xl pr-4 pl-14 text-base md:h-16 md:text-lg"
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
              {item.sap_origin && (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">SAP 起單</span>
              )}
              <Button asChild variant="outline" className="mt-auto w-full">
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
            沒有符合的表單。
          </p>
        )}
      </main>
    </div>
  )
}

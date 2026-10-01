import { useEffect, useState } from "react"
import { ChevronRight, FileText, GraduationCap } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { ApiError } from "@/api/client"
import { CUSTOMER_TYPE_LABEL, type Customer } from "@/api/customers"
import { getFirstWeek, getFirstWeekStatus, type FirstWeek, type FirstWeekTask } from "@/api/first-week"
import type { MethodCard } from "@/api/methods"
import { MethodCardItem } from "@/components/method-card"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth"
import { countDone, dayLabel, readDone, setDone } from "@/lib/first-week"
import { formatMoney } from "@/lib/format"
import { replaceCard } from "@/lib/methods"
import { cn } from "@/lib/utils"

type LoadState =
  | { status: "loading" }
  // denied：後端說這個帳號沒有這一頁（主管與 IT），直接顯示它那一句，重新載入也一樣
  | { status: "error"; denied: string | null }
  | { status: "ready"; data: FirstWeek }

const TYPES: Customer["type"][] = ["chain", "independent", "clinic"]
const GRADES = ["A", "B", "C"]

function documentPath(sourceName: string) {
  return `/documents/${encodeURIComponent(sourceName)}`
}

/**
 * 新人第一週：你在哪一區、主管是誰、賣什麼、先認識哪幾家客戶、第一週每天做什麼。
 * 數字是後端現查的，每天做什麼與必讀文件是設定檔裡人寫的，方法卡是主管寫的，整頁沒有 AI 生成的內容。
 * 勾選進度只存在這支手機（lib/first-week.ts）。業務帳號都打得開，不是新人也能從帳號設定回來看。
 */
export function FirstWeekPage() {
  const navigate = useNavigate()
  const userId = useAuth()?.user.id ?? null
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [done, setDoneIds] = useState<string[]>(() => (userId ? readDone(userId) : []))

  useEffect(() => {
    const controller = new AbortController()
    getFirstWeek(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: "error", denied: error instanceof ApiError && error.status === 403 ? error.message : null })
      })
    return () => controller.abort()
  }, [attempt])

  const data = state.status === "ready" ? state.data : null
  const taskIds = data ? data.days.flatMap((day) => day.tasks.map((task) => task.id)) : []

  function toggle(taskId: string, checked: boolean) {
    if (userId) setDoneIds(setDone(userId, done, taskId, checked))
  }

  // 方法卡按完回饋，換掉那一張；整頁其餘的內容不必重新載入
  function methodChanged(next: MethodCard) {
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", data: { ...current.data, methods: replaceCard(current.data.methods, next) } }
        : current
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="新人第一週" subtitle={(data && dayLabel(data)) ?? undefined} backTo="/" />
      <main className="flex flex-1 flex-col gap-6 px-4 pt-4 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
        {state.status === "error" && state.denied && (
          <Notice text={state.denied} action={{ label: "回首頁", onClick: () => navigate("/", { replace: true }) }} />
        )}
        {state.status === "error" && !state.denied && (
          <Notice
            text="連不上伺服器，新人第一週沒有載入。"
            action={{
              label: "重新載入",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
            secondary={{ label: "回首頁", onClick: () => navigate("/") }}
          />
        )}
        {data && (
          <>
            <ProfileSection data={data} />
            <ProductLines data={data} />
            <KeyCustomers data={data} />

            {/* 還沒有掛「新人必看」的方法卡就不顯示這一區 */}
            {data.methods.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">主管教的做法</h2>
                <p className="text-xs text-muted-foreground">主管標了「新人必看」的方法卡裡，最多人說有幫上的三張。</p>
                {/* 這一頁不是在哪一家客戶看的，回饋不帶客戶，跟在方法卡頁按的是同一筆 */}
                {data.methods.map((method) => (
                  <MethodCardItem key={method.id} card={method} onChanged={methodChanged} />
                ))}
                <Link to="/methods" className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border-2 bg-card px-4 shadow-lip press">
                  <span className="text-sm font-medium">看全部方法卡</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </section>
            )}

            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold">第一週每天做什麼</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  完成 {countDone(taskIds, done)}／{taskIds.length}
                </span>
              </div>
              {data.days.map((day) => (
                <article key={day.day} className="rounded-2xl border-2 bg-card shadow-lip">
                  <h3 className="border-b px-4 py-2.5 text-sm font-medium">
                    第 {day.day} 天 · {day.title}
                  </h3>
                  <ul className="divide-y">
                    {day.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        checked={done.includes(task.id)}
                        onToggle={(checked) => toggle(task.id, checked)}
                      />
                    ))}
                  </ul>
                </article>
              ))}
              <p className="text-xs text-muted-foreground">做完就打勾。勾選只記在這支手機裡，換一支手機要重新勾。</p>
            </section>

            {data.documents.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">必讀文件</h2>
                <ul className="divide-y rounded-2xl border-2 bg-card shadow-lip">
                  {data.documents.map((doc) => (
                    <li key={doc.source_name}>
                      <Link to={documentPath(doc.source_name)} className="flex min-h-14 items-center gap-3 px-4 active:bg-muted">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">{doc.title}</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

/** 你的資料：人員編號與到職日來自 SAP 人員主檔，哪一區與主管來自組織樹，客戶數現查 */
function ProfileSection({ data }: { data: FirstWeek }) {
  const { employee, customers } = data
  const day = dayLabel(data)
  return (
    <section className="rounded-2xl border-2 bg-card p-4 shadow-lip">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">你的資料</h2>
        {employee.employee_no && <span className="text-[11px] text-muted-foreground">來自 SAP 人員主檔</span>}
      </div>
      {/* 自建與第三方登入的帳號沒有人員主檔，下面列的是代理的那位示範業務的轄區與客戶 */}
      {employee.proxy_of && (
        <p className="mt-2 rounded-xl bg-primary/10 px-3 py-2 text-xs leading-relaxed text-primary">
          你看的是示範業務{employee.proxy_of}的資料。
        </p>
      )}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {employee.employee_no && <Row label="人員編號" value={employee.employee_no} />}
        {/* 第幾天只有新人寫；老員工只留到職日 */}
        {employee.hire_date && (
          <Row label="到職日" value={`${employee.hire_date.replaceAll("-", "/")}${day ? `（${day}）` : ""}`} />
        )}
        <Row label="營業所" value={employee.region} />
        <Row label="直屬主管" value={employee.manager_name ?? "—"} />
        {customers.total > 0 && (
          <>
            <Row label="轄區縣市" value={employee.cities.join("、")} />
            <Row label="名下客戶" value={`${customers.total} 家`} />
            <Row label="依類型" value={TYPES.map((type) => `${CUSTOMER_TYPE_LABEL[type]} ${customers.by_type[type] ?? 0}`).join("、")} />
            <Row label="依等級" value={GRADES.map((grade) => `${grade} 級 ${customers.by_grade[grade] ?? 0}`).join("、")} />
          </>
        )}
      </dl>
      {customers.total === 0 && <p className="mt-3 text-sm text-muted-foreground">名下還沒有客戶，等主管分配。</p>}
    </section>
  )
}

/** 你賣什麼：每條產品線有幾個品項、同一區近 90 天進貨金額最高的三個 */
function ProductLines({ data }: { data: FirstWeek }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">你賣什麼</h2>
      <p className="text-xs text-muted-foreground">
        每條產品線列{data.employee.region}近 90 天進貨金額最高的三個品項。
      </p>
      {data.product_lines.map((line) => (
        <article key={line.category} className="rounded-2xl border-2 bg-card px-4 pt-3 pb-1 shadow-lip">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-medium">{line.category}</h3>
            <span className="text-xs text-muted-foreground">{line.sku_count} 個品項</span>
          </div>
          {line.top.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">這一區近 90 天沒有進這條產品線的貨。</p>
          ) : (
            <ol className="mt-1 divide-y">
              {line.top.map((item, index) => (
                <li key={item.sku} className="flex items-start gap-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug font-medium">{item.name}</p>
                    {item.aliases.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">口語叫法：{item.aliases.join("、")}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-muted-foreground">建議售價</p>
                    <p className="text-sm font-medium tabular-nums">{formatMoney(item.unit_price)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </article>
      ))}
      {/* 沒有進行中的促銷就不顯示這一列 */}
      {data.promotion && (
        <Link to="/promotions" className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border-2 bg-card px-4 shadow-lip press">
          <span className="text-sm font-medium">這個月的促銷：{data.promotion.item_count} 個品項</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      )}
    </section>
  )
}

/** 先認識這五家：名下 A 級客戶裡近 90 天進貨金額最高的，不足五家用 B 級補 */
function KeyCustomers({ data }: { data: FirstWeek }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">先認識這五家</h2>
      <p className="text-xs text-muted-foreground">名下 A 級客戶裡近 90 天進貨金額最高的，不足五家用 B 級補。</p>
      {data.key_customers.length === 0 ? (
        <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          {data.customers.total === 0 ? "名下還沒有客戶，等主管分配。" : "名下還沒有 A 級或 B 級的客戶。"}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.key_customers.map((customer) => (
            <li key={customer.id}>
              <Link
                to={`/customers/${customer.id}`}
                className="flex items-center gap-2 rounded-xl border-2 bg-card py-3 pr-2 pl-4 shadow-lip press"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="leading-snug font-medium">{customer.name}</p>
                    <Badge variant="secondary">{customer.grade} 級</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {CUSTOMER_TYPE_LABEL[customer.type]} · {customer.city} · 近 90 天進貨 {formatMoney(customer.amount_last_90d)}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 第一週的一件事：左邊打勾，右邊點了去 App 裡對應的頁面或打開那份文件 */
function TaskRow({ task, checked, onToggle }: { task: FirstWeekTask; checked: boolean; onToggle: (checked: boolean) => void }) {
  const to = task.to ?? (task.doc ? documentPath(task.doc) : null)
  const text = <span className={cn("flex-1 text-sm leading-relaxed", checked && "text-muted-foreground line-through")}>{task.text}</span>
  return (
    <li className="flex items-stretch">
      {/* 整個左邊一格都點得到，手指不必對準那個小方框 */}
      <label className="flex w-12 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`做完了：${task.text}`}
          className="size-5 accent-primary"
        />
      </label>
      {to ? (
        <Link to={to} className="flex min-h-14 flex-1 items-center gap-2 py-3 pr-3 active:bg-muted">
          {text}
          {task.doc ? (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
        </Link>
      ) : (
        <div className="flex min-h-14 flex-1 items-center py-3 pr-4">{text}</div>
      )}
    </li>
  )
}

/**
 * 首頁（今日路線上方）的入口卡：新人才顯示，寫到職第幾天與完成幾件。
 * 問不到 status（沒訊號、伺服器出錯）就不顯示，今日路線照常，不另外提示。
 */
export function FirstWeekEntry({ userId }: { userId: string }) {
  const [card, setCard] = useState<{ day: string | null; done: number; total: number } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getFirstWeekStatus(controller.signal)
      .then((status) => {
        if (!status.is_newcomer) return
        setCard({ day: dayLabel(status), done: countDone(status.task_ids, readDone(userId)), total: status.task_ids.length })
      })
      .catch(() => {
        // 這張卡只是入口，載不到就算了
      })
    return () => controller.abort()
  }, [userId])

  if (!card) return null
  return (
    <Link
      to="/first-week"
      className="mb-3 flex min-h-14 items-center gap-3 rounded-2xl border-2 border-primary/30 bg-primary/10 px-4 py-2.5 shadow-lip-primary-soft press"
    >
      <GraduationCap className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">新人第一週</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {card.day && `${card.day} · `}完成 {card.done}／{card.total}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-primary" />
    </Link>
  )
}

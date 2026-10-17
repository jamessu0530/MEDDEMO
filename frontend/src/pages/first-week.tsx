import { openAssistant } from "@/ask/assistant-window"
import { useEffect, useState } from "react"
import { ChevronRight, FileText, GraduationCap } from "@/components/icons"
import { Link, useNavigate } from "react-router"

import { ApiError } from "@/api/client"
import { CUSTOMER_TYPE_LABEL, type Customer } from "@/api/customers"
import {
  getFirstWeek,
  type FirstWeek,
  type FirstWeekTask,
} from "@/api/first-week"
import { getCourse, type Course } from "@/api/learning"
import type { MethodCard } from "@/api/methods"
import { MethodCardItem } from "@/components/method-card"
import { CoursePath } from "@/components/learning/course-path"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { useAuth } from "@/lib/auth"
import { dayLabel } from "@/lib/first-week"
import { formatMoney } from "@/lib/format"
import { replaceCard } from "@/lib/methods"

type LoadState =
  | { status: "loading" }
  // denied：後端說這個帳號沒有這一頁（主管與 IT），直接顯示它那一句，重新載入也一樣
  | { status: "error"; denied: string | null }
  | { status: "ready"; data: FirstWeek; course: Course }

const TYPES: Customer["type"][] = ["chain", "independent", "clinic", "outlet"]

function documentPath(sourceName: string) {
  return `/documents/${encodeURIComponent(sourceName)}`
}

/**
 * 新人第一週：你在哪一區、主管是誰、賣什麼、先認識哪幾家客戶、第一週每天做什麼。
 * 數字是後端現查的，每天做什麼與必讀文件是設定檔裡人寫的，方法卡是主管寫的，整頁沒有 AI 生成的內容。
 * 操作課程進度跟帳號保存；原本的人員資料、文件和現場清單放在下方供參考。
 */
export function FirstWeekPage() {
  const navigate = useNavigate()
  const userId = useAuth()?.user.id ?? null
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getFirstWeek(controller.signal), getCourse(controller.signal)])
      .then(([data, course]) => setState({ status: "ready", data, course }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          denied:
            error instanceof ApiError && error.status === 403
              ? error.message
              : null,
        })
      })
    return () => controller.abort()
  }, [attempt, userId])

  const data = state.status === "ready" ? state.data : null

  // 方法卡按完回饋，換掉那一張；整頁其餘的內容不必重新載入
  function methodChanged(next: MethodCard) {
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            data: {
              ...current.data,
              methods: replaceCard(current.data.methods, next),
            },
          }
        : current
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="新人第一週"
        subtitle={(data && dayLabel(data)) ?? undefined}
        backTo="/"
      />
      <main className="flex flex-1 flex-col gap-6 px-4 pt-4 pb-10">
        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            載入中…
          </p>
        )}
        {state.status === "error" && state.denied && (
          <Notice
            text={state.denied}
            action={{
              label: "回首頁",
              onClick: () => navigate("/", { replace: true }),
            }}
          />
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
            {state.status === "ready" && (
              <CoursePath
                course={state.course}
                onCourseChange={(course) => {
                  setState((current) =>
                    current.status === "ready"
                      ? { ...current, course }
                      : current
                  )
                  openAssistant()
                }}
              />
            )}
            <details className="group rounded-2xl border-2 bg-card shadow-lip">
              <summary className="cursor-pointer px-4 py-4 text-sm font-semibold">
                我的轄區、產品與第一週參考資料
              </summary>
              <div className="flex flex-col gap-6 border-t px-3 py-4">
                <ProfileSection data={data} />
                <ProductLines data={data} />
                <KeyCustomers data={data} />

                {/* 還沒有掛「新人必看」的方法卡就不顯示這一區 */}
                {data.methods.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-base font-semibold">主管教的做法</h2>
                    <p className="text-xs text-muted-foreground">
                      主管標了「新人必看」的方法卡裡，最多人說有幫上的三張。
                    </p>
                    {/* 這一頁不是在哪一家客戶看的，回饋不帶客戶，跟在方法卡頁按的是同一筆 */}
                    {data.methods.map((method) => (
                      <MethodCardItem
                        key={method.id}
                        card={method}
                        onChanged={methodChanged}
                      />
                    ))}
                    <Link
                      to="/methods"
                      className="flex min-h-14 press items-center justify-between gap-3 rounded-2xl border-2 bg-card px-4 shadow-lip"
                    >
                      <span className="text-sm font-medium">看全部方法卡</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </section>
                )}

                <section className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-base font-semibold">第一週每天做什麼</h2>
                  </div>
                  {data.days.map((day) => (
                    <article
                      key={day.day}
                      className="rounded-2xl border-2 bg-card shadow-lip"
                    >
                      <h3 className="border-b px-4 py-2.5 text-base font-medium">
                        第 {day.day} 天 · {day.title}
                      </h3>
                      <ul className="divide-y">
                        {day.tasks.map((task) => (
                          <TaskRow key={task.id} task={task} />
                        ))}
                      </ul>
                    </article>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    這份清單供實際工作參考；上方操作課程完成後會自動記錄進度。
                  </p>
                </section>

                {data.documents.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-base font-semibold">必讀文件</h2>
                    <ul className="divide-y rounded-2xl border-2 bg-card shadow-lip">
                      {data.documents.map((doc) => (
                        <li key={doc.source_name}>
                          <Link
                            to={documentPath(doc.source_name)}
                            className="flex min-h-14 items-center gap-3 px-4 active:bg-muted"
                          >
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 text-sm">{doc.title}</span>
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </details>
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
        <h2 className="text-base font-semibold">你的資料</h2>
        {employee.employee_no && (
          <span className="text-xs text-muted-foreground">
            來自 SAP 人員主檔
          </span>
        )}
      </div>
      {/* 自建與第三方登入的帳號沒有人員主檔，下面列的是代理的那位示範業務的轄區與客戶 */}
      {employee.proxy_of && (
        <p className="mt-2 rounded-xl bg-primary/10 px-3 py-2 text-xs leading-relaxed text-primary">
          你看的是示範業務{employee.proxy_of}的資料。
        </p>
      )}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {employee.employee_no && (
          <Row label="人員編號" value={employee.employee_no} />
        )}
        {/* 第幾天只有新人寫；老員工只留到職日 */}
        {employee.hire_date && (
          <Row
            label="到職日"
            value={`${employee.hire_date.replaceAll("-", "/")}${day ? `（${day}）` : ""}`}
          />
        )}
        <Row label="營業所" value={employee.region} />
        <Row label="直屬主管" value={employee.manager_name ?? "—"} />
        {customers.total > 0 && (
          <>
            <Row label="通路縣市" value={employee.cities.join("、")} />
            <Row label="共用客戶" value={`${customers.total} 家`} />
            <Row
              label="依類型"
              value={TYPES.map(
                (type) =>
                  `${CUSTOMER_TYPE_LABEL[type]} ${customers.by_type[type] ?? 0}`
              ).join("、")}
            />
          </>
        )}
      </dl>
      {customers.total === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          目前還沒有客戶資料，可從客戶資料頁查看。
        </p>
      )}
    </section>
  )
}

/** 你賣什麼：每條產品線有幾個品項、同一區近 90 天進貨金額最高的三個 */
function ProductLines({ data }: { data: FirstWeek }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">你賣什麼</h2>
      <p className="text-xs text-muted-foreground">
        每條產品線列{data.employee.region}近 90 天進貨金額最高的三個品項。
      </p>
      {data.product_lines.map((line) => (
        <article
          key={line.category}
          className="rounded-2xl border-2 bg-card px-4 pt-3 pb-1 shadow-lip"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-medium">{line.category}</h3>
            <span className="text-xs text-muted-foreground">
              {line.sku_count} 個品項
            </span>
          </div>
          {line.top.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              這一區近 90 天沒有進這條產品線的貨。
            </p>
          ) : (
            <ol className="mt-1 divide-y">
              {line.top.map((item, index) => (
                <li key={item.sku} className="flex items-start gap-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug font-medium">
                      {item.name}
                    </p>
                    {item.aliases.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        口語叫法：{item.aliases.join("、")}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">
                      建議售價
                    </p>
                    <p className="text-sm font-medium tabular-nums">
                      {formatMoney(item.unit_price)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </article>
      ))}
      {/* 沒有進行中的促銷就不顯示這一列 */}
      {data.promotion && (
        <Link
          to="/products?view=promotions"
          className="flex min-h-14 press items-center justify-between gap-3 rounded-2xl border-2 bg-card px-4 shadow-lip"
        >
          <span className="text-sm font-medium">
            這個月的促銷：{data.promotion.item_count} 個品項
          </span>
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
      <h2 className="text-base font-semibold">先認識這五家</h2>
      <p className="text-xs text-muted-foreground">
        先認識共用客戶的近期進貨與拜訪紀錄，也可以自行搜尋其他通路。
      </p>
      {data.key_customers.length === 0 ? (
        <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          {data.customers.total === 0
            ? "目前還沒有客戶資料，可從客戶資料頁查看。"
            : "目前沒有可顯示的客戶。"}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.key_customers.map((customer) => (
            <li key={customer.id}>
              <Link
                to={`/customers/${customer.id}`}
                className="flex press items-center gap-2 rounded-xl border-2 bg-card py-3 pr-2 pl-4 shadow-lip"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="leading-snug font-medium">{customer.name}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {CUSTOMER_TYPE_LABEL[customer.type]} · {customer.city} · 近
                    90 天進貨 {formatMoney(customer.amount_last_90d)}
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

/** 現場參考清單：點開 App 裡對應的頁面或文件，課程進度另外由答案核對。 */
function TaskRow({ task }: { task: FirstWeekTask }) {
  const to = task.to ?? (task.doc ? documentPath(task.doc) : null)
  const text = (
    <span className="flex-1 text-sm leading-relaxed">{task.text}</span>
  )
  return (
    <li className="flex items-stretch">
      {to ? (
        <Link
          to={to}
          className="flex min-h-14 flex-1 items-center gap-2 p-3 active:bg-muted"
        >
          {text}
          {task.doc ? (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
        </Link>
      ) : (
        <div className="flex min-h-14 flex-1 items-center p-3">{text}</div>
      )}
    </li>
  )
}

/**
 * 首頁課程入口：只顯示給新人，進度與課程地圖取同一份帳號紀錄。
 */
export function FirstWeekEntry({ userId }: { userId: string }) {
  const [card, setCard] = useState<Course | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getCourse(controller.signal)
      .then((status) => {
        if (!status.is_newcomer) return
        setCard(status)
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
      className="mb-3 flex min-h-14 press items-center gap-3 rounded-2xl border-2 border-primary/30 bg-primary/10 px-4 py-2.5 shadow-lip-primary-soft"
    >
      <GraduationCap className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {card.demo_skipped
            ? "Demo · AI 問答已開啟，可繼續新人課程"
            : card.ai_unlocked
              ? "新人課程完成 · AI 問答已解鎖"
              : "新人闖關 · 完成後解鎖 AI 問答"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          完成 {card.completed.length}／{card.lessons.length} 關 · {card.xp} XP
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-primary" />
    </Link>
  )
}

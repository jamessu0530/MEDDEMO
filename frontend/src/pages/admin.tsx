import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { ChevronRight, Inbox, Settings, UserPlus, Users } from "lucide-react"
import { Link, useNavigate } from "react-router"

import {
  changeManager,
  changeRole,
  createAccount,
  deactivateAccount,
  getOrgChart,
  moveManager,
  reactivateAccount,
  type AssignableRole,
  type OrgChart,
  type OrgMember,
} from "@/api/admin"
import { ChannelsLink } from "@/components/channels-link"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { SkinToggle } from "@/components/skin-toggle"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; chart: OrgChart }
type Action =
  "manager" | "unit" | "promote" | "demote" | "deactivate" | "reactivate"

const ROLE_LABEL = { sales: "業務", manager: "主管", it: "IT" } as const
// 跟後端 services/auth.py 一致；這裡先擋，錯誤訊息不必等伺服器
const MIN_PASSWORD = 8

const ACTION_LABEL: Record<Action, string> = {
  manager: "換直屬主管",
  unit: "調到別區",
  promote: "升為主管",
  demote: "改為業務",
  deactivate: "停用帳號",
  reactivate: "重新啟用",
}

/** 組織管理（只有 IT）：看整棵組織樹，換主管、調區、改角色、開帳號、停用。改完馬上生效 */
export function AdminPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<OrgMember | null>(null)
  const [creating, setCreating] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getOrgChart(controller.signal)
      .then((chart) => setState({ status: "ready", chart }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  // 後端回傳整張更新後的組織圖；最新一筆異動紀錄就是剛剛做的事，拿來當提示
  function applied(chart: OrgChart, note?: string) {
    setState({ status: "ready", chart })
    setSelected(null)
    setCreating(false)
    const detail = chart.log[0]?.detail
    setFlash(detail ? `${detail}。${note ?? ""}` : null)
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="組織管理"
        subtitle="IT"
        trailing={
          <>
            <SkinToggle className="size-11" />
            <ChannelsLink />
            <Link
              to="/settings"
              aria-label="帳號設定"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <Settings className="size-5" />
            </Link>
          </>
        }
      />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-10">
        <div className="grid grid-cols-2 gap-2">
          <QuickLink
            to="/manager"
            icon={<Inbox className="size-4" />}
            label="主管端"
          />
          <QuickLink
            to="/customers"
            icon={<Users className="size-4" />}
            label="客戶清單"
          />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          改組織馬上生效：誰看得到誰的資料、風險通報與申請單（出差單、優惠、合約）送給誰，都跟著這棵樹走。
        </p>

        {flash && (
          <p className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm leading-relaxed text-primary">
            {flash}
          </p>
        )}

        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            載入中…
          </p>
        )}
        {state.status === "error" && (
          <Notice
            text="連不上伺服器，組織圖沒有載入。"
            action={{
              label: "重新載入",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
            secondary={{
              label: "回主管端",
              onClick: () => navigate("/manager"),
            }}
          />
        )}
        {state.status === "ready" && (
          <>
            <Button className="h-11 gap-1.5" onClick={() => setCreating(true)}>
              <UserPlus className="size-4" />
              新增帳號
            </Button>
            <OrgTree chart={state.chart} onSelect={setSelected} />
            <ChangeLog chart={state.chart} />
            {selected && (
              <PersonDialog
                key={selected.id}
                person={selected}
                chart={state.chart}
                onClose={() => setSelected(null)}
                onApplied={applied}
              />
            )}
            {creating && (
              <CreateAccountDialog
                chart={state.chart}
                onClose={() => setCreating(false)}
                onApplied={(chart) =>
                  applied(
                    chart,
                    "初始密碼請自己告訴他，他登入後可以在帳號設定改。"
                  )
                }
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

function QuickLink({
  to,
  icon,
  label,
}: {
  to: string
  icon: ReactNode
  label: string
}) {
  return (
    <Link
      to={to}
      className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border bg-card text-sm font-medium"
    >
      {icon}
      {label}
    </Link>
  )
}

/** 全國 → 區 → 主管 → 業務。停用的人留在原位、淡色顯示（他的歷史紀錄照舊給原本的團隊看） */
function OrgTree({
  chart,
  onSelect,
}: {
  chart: OrgChart
  onSelect: (person: OrgMember) => void
}) {
  const regions = chart.units.filter((unit) => unit.kind === "region")
  const it = chart.users.filter((user) => user.role === "it")
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">全國</h2>
        <div className="rounded-2xl border bg-card">
          {it.map((person) => (
            <div
              key={person.id}
              className="flex min-h-14 items-center px-4 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {person.name}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {person.id}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  IT · 全公司看得到也動得了，帳號不在這裡改
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
      {regions.map((region) => {
        const managers = chart.users.filter(
          (user) => user.role === "manager" && user.unit_id === region.id
        )
        return (
          <section key={region.id} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{region.name}</h2>
            {managers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                這一區還沒有主管。
              </p>
            )}
            {managers.map((manager) => {
              const reports = chart.users.filter(
                (user) =>
                  user.role === "sales" && user.manager_id === manager.id
              )
              return (
                <div
                  key={manager.id}
                  className="overflow-hidden rounded-2xl border bg-card"
                >
                  <PersonRow person={manager} onSelect={onSelect} />
                  <ul className="divide-y border-t bg-muted/30">
                    {reports.map((rep) => (
                      <li key={rep.id} className="pl-4">
                        <PersonRow person={rep} onSelect={onSelect} />
                      </li>
                    ))}
                    {reports.length === 0 && (
                      <li className="px-8 py-3 text-xs text-muted-foreground">
                        底下還沒有業務
                      </li>
                    )}
                  </ul>
                </div>
              )
            })}
          </section>
        )
      })}
    </>
  )
}

function PersonRow({
  person,
  onSelect,
}: {
  person: OrgMember
  onSelect: (person: OrgMember) => void
}) {
  const details: string[] = [ROLE_LABEL[person.role]]
  if (person.role === "sales") details.push(`${person.customer_count} 家客戶`)
  if (!person.active) details.push("已停用")
  return (
    <button
      type="button"
      onClick={() => onSelect(person)}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left",
        !person.active && "opacity-50"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {person.name}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {person.id}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{details.join(" · ")}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function ChangeLog({ chart }: { chart: OrgChart }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">異動紀錄</h2>
      {chart.log.length === 0 ? (
        <p className="text-xs text-muted-foreground">還沒有異動。</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {chart.log.map((entry) => (
            <li key={entry.id} className="px-4 py-2.5">
              <p className="text-sm leading-relaxed">{entry.detail}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatDateTime(entry.created_at)} · {entry.actor_name}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type ActionItem = { action: Action; reason?: string }

/** 這個人現在能做哪些操作。做不了的不藏起來，寫出原因；更細的規則（例如示範業務不能停用）由後端擋，訊息照樣顯示 */
function actionsFor(person: OrgMember, chart: OrgChart): ActionItem[] {
  if (person.role === "sales") {
    return person.active
      ? [{ action: "manager" }, { action: "promote" }, { action: "deactivate" }]
      : [{ action: "manager" }, { action: "reactivate" }]
  }
  if (!person.active) return [{ action: "reactivate" }]
  const reports = chart.users.filter((user) => user.manager_id === person.id)
  const active = reports.filter((user) => user.active).length
  const inactive = reports.length - active
  return [
    { action: "unit" },
    {
      action: "demote",
      // 停用的屬下也算：他們接在這位主管後面，主管一變成業務，樹就長到第五層
      reason: reports.length
        ? `底下還有 ${reports.length} 位業務${inactive ? `（其中 ${inactive} 位已停用）` : ""}，先把他們換到別的主管底下。`
        : undefined,
    },
    {
      action: "deactivate",
      reason: active
        ? `底下還有 ${active} 位在職的業務，先把他們換到別的主管底下。`
        : undefined,
    },
  ]
}

function PersonDialog({
  person,
  chart,
  onClose,
  onApplied,
}: {
  person: OrgMember
  chart: OrgChart
  onClose: () => void
  onApplied: (chart: OrgChart) => void
}) {
  const [action, setAction] = useState<Action | null>(null)
  const [target, setTarget] = useState("")
  const [successor, setSuccessor] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const managers = chart.users.filter(
    (user) =>
      user.role === "manager" &&
      user.active &&
      user.id !== person.id &&
      user.id !== person.manager_id
  )
  const regions = chart.units.filter(
    (unit) => unit.kind === "region" && unit.id !== person.unit_id
  )
  const successors = chart.users.filter(
    (user) => user.role === "sales" && user.active && user.id !== person.id
  )
  const team = chart.users.filter(
    (user) => user.manager_id === person.id
  ).length
  const needsTarget =
    action === "manager" ||
    action === "unit" ||
    action === "promote" ||
    action === "demote"
  const needsSuccessor =
    (action === "promote" || action === "deactivate") &&
    person.customer_count > 0

  function choose(next: Action | null) {
    setAction(next)
    setTarget("")
    setSuccessor("")
    setError(null)
  }

  function send() {
    switch (action) {
      case "manager":
        return changeManager(person.id, target)
      case "unit":
        return moveManager(person.id, target)
      case "promote":
        return changeRole(person.id, {
          role: "manager",
          unit_id: target,
          successor_id: successor || undefined,
        })
      case "demote":
        return changeRole(person.id, { role: "sales", manager_id: target })
      case "deactivate":
        return deactivateAccount(person.id, successor || undefined)
      default:
        return reactivateAccount(person.id)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onApplied(await send())
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有改成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action ? `${ACTION_LABEL[action]}：${person.name}` : person.name}
          </DialogTitle>
          <DialogDescription>
            {person.id} · {person.region} · {ROLE_LABEL[person.role]}
            {person.role === "sales" && ` · ${person.customer_count} 家客戶`}
            {!person.active && " · 已停用"}
          </DialogDescription>
        </DialogHeader>

        {action === null ? (
          <div className="flex flex-col gap-2">
            {actionsFor(person, chart).map(({ action: item, reason }) =>
              reason ? (
                <div key={item} className="rounded-xl bg-muted px-3 py-2.5">
                  <p className="text-sm font-medium text-muted-foreground">
                    {ACTION_LABEL[item]}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {reason}
                  </p>
                </div>
              ) : (
                <Button
                  key={item}
                  variant="outline"
                  className="h-11 justify-between"
                  onClick={() => choose(item)}
                >
                  {ACTION_LABEL[item]}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Button>
              )
            )}
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {action === "manager" && (
              <Field
                label="新的直屬主管"
                htmlFor="target"
                hint="他還沒簽完的申請單（出差單、優惠、合約）會改送給新主管；轄區跟著新主管。"
              >
                <PeoplePicker
                  id="target"
                  value={target}
                  onChange={setTarget}
                  people={managers}
                />
              </Field>
            )}
            {action === "unit" && (
              <Field
                label="調到哪一區"
                htmlFor="target"
                hint={team ? `底下 ${team} 位業務跟著調。` : undefined}
              >
                <NativeSelect
                  id="target"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">選一區</option>
                  {regions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {action === "promote" && (
              <Field
                label="帶哪一區"
                htmlFor="target"
                hint="主管沒有自己的路線，名下的客戶要先交給一位業務。"
              >
                <NativeSelect
                  id="target"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">選一區</option>
                  {chart.units
                    .filter((unit) => unit.kind === "region")
                    .map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            )}
            {action === "demote" && (
              <Field label="直屬主管" htmlFor="target">
                <PeoplePicker
                  id="target"
                  value={target}
                  onChange={setTarget}
                  people={managers}
                />
              </Field>
            )}
            {needsSuccessor && (
              <Field
                label={`誰接手他的 ${person.customer_count} 家客戶`}
                htmlFor="successor"
                hint="過去的拜訪、報價、申請單仍記在他名下。"
              >
                <PeoplePicker
                  id="successor"
                  value={successor}
                  onChange={setSuccessor}
                  people={successors}
                />
              </Field>
            )}
            {action === "deactivate" && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                停用後就登不進來，已經登入的裝置下一個動作就會被登出。他留在組織裡原本的位置，歷史紀錄照舊看得到。
              </p>
            )}
            {action === "reactivate" && (
              <p className="text-xs text-muted-foreground">
                重新啟用後就能用原本的密碼登入。
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={busy}
                onClick={() => choose(null)}
              >
                返回
              </Button>
              <Button
                type="submit"
                variant={action === "deactivate" ? "destructive" : "default"}
                className="h-11"
                disabled={
                  busy ||
                  (needsTarget && !target) ||
                  (needsSuccessor && !successor)
                }
              >
                {ACTION_LABEL[action]}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

function PeoplePicker({
  id,
  value,
  onChange,
  people,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  people: OrgMember[]
}) {
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">選一位</option>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name}（{person.region}）
        </option>
      ))}
    </NativeSelect>
  )
}

function CreateAccountDialog({
  chart,
  onClose,
  onApplied,
}: {
  chart: OrgChart
  onClose: () => void
  onApplied: (chart: OrgChart) => void
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<AssignableRole>("sales")
  const [position, setPosition] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const managers = chart.users.filter(
    (user) => user.role === "manager" && user.active
  )
  const regions = chart.units.filter((unit) => unit.kind === "region")

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password.length < MIN_PASSWORD)
      return setError(`初始密碼至少要 ${MIN_PASSWORD} 碼`)
    setBusy(true)
    setError(null)
    try {
      const place =
        role === "sales" ? { manager_id: position } : { unit_id: position }
      onApplied(
        await createAccount({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          ...place,
        })
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有新增成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增帳號</DialogTitle>
          <DialogDescription>
            公司帳號用 Email 與密碼登入。初始密碼請自己告訴對方。
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div
            className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm"
            role="tablist"
          >
            {(["sales", "manager"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={role === value}
                onClick={() => {
                  setRole(value)
                  setPosition("")
                }}
                className={cn(
                  "h-9 rounded-md",
                  role === value
                    ? "bg-card font-medium shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                {ROLE_LABEL[value]}
              </button>
            ))}
          </div>
          <Field label="姓名" htmlFor="account-name">
            <Input
              id="account-name"
              className="h-11"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Email" htmlFor="account-email">
            <Input
              id="account-email"
              className="h-11"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field
            label="初始密碼"
            htmlFor="account-password"
            hint={`至少 ${MIN_PASSWORD} 碼，他登入後可以在帳號設定改。`}
          >
            {/* 不遮起來：IT 要看得到自己打了什麼，才能告訴對方 */}
            <Input
              id="account-password"
              className="h-11"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {role === "sales" ? (
            <Field label="直屬主管" htmlFor="position">
              <PeoplePicker
                id="position"
                value={position}
                onChange={setPosition}
                people={managers}
              />
            </Field>
          ) : (
            <Field label="帶哪一區" htmlFor="position">
              <NativeSelect
                id="position"
                value={position}
                onChange={(event) => setPosition(event.target.value)}
              >
                <option value="">選一區</option>
                {regions.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="h-11"
              disabled={busy || !name.trim() || !email.trim() || !position}
            >
              新增
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from "react"
import {
  Download,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Users,
} from "@/components/icons"
import * as api from "@/api/planner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  disableCalendarPush,
  enableCalendarPush,
  pushSupported,
} from "@/lib/calendar-push"
import { message } from "@/lib/planner"

type Props = {
  workspace: api.CalendarWorkspace
  onClose: () => void
  onChanged: () => void
}
export function CalendarManager({ workspace, onClose, onChanged }: Props) {
  const [selected, setSelected] = useState(
    workspace.calendars.find((c) => c.status === "accepted")?.id ?? "new"
  )
  const [notice, setNotice] = useState("")
  const calendar = workspace.calendars.find(
    (c) => c.id === selected && c.status === "accepted"
  )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="planner-dialog max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>日曆與設定</DialogTitle>
          <DialogDescription>
            管理分類、共享權限、外部連接與通知。
          </DialogDescription>
        </DialogHeader>
        <div className="planner-form grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <nav className="flex flex-col gap-1" aria-label="日曆設定選單">
            {workspace.calendars
              .filter((c) => c.status === "accepted")
              .map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-left text-sm ${c.id === selected ? "bg-muted font-semibold" : "hover:bg-muted/50"}`}
                  onClick={() => {
                    setSelected(c.id)
                    setNotice("")
                  }}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: c.color }}
                  />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            <Button
              variant="ghost"
              className="justify-start text-sm"
              onClick={() => {
                setSelected("new")
                setNotice("")
              }}
            >
              <Plus />
              新增日曆
            </Button>
            <Button
              variant="ghost"
              className="justify-start text-sm"
              onClick={() => {
                setSelected("connect")
                setNotice("")
              }}
            >
              連接外部日曆
            </Button>
            <Button
              variant="ghost"
              className="justify-start text-sm"
              onClick={() => {
                setSelected("notifications")
                setNotice("")
              }}
            >
              通知設定
            </Button>
          </nav>
          <div className="min-w-0">
            {notice && (
              <p role="status" className="mb-3 rounded-xl bg-muted p-3 text-sm">
                {notice}
              </p>
            )}
            {selected === "new" ? (
              <NewCalendar
                onSaved={(c) => {
                  onChanged()
                  setSelected(c.id)
                  setNotice("日曆已建立")
                }}
              />
            ) : selected === "connect" ? (
              <ConnectCalendar
                onSaved={() => {
                  onChanged()
                  setNotice("外部日曆已連接並完成首次同步")
                }}
              />
            ) : selected === "notifications" ? (
              <NotificationSettings workspace={workspace} />
            ) : (
              calendar && (
                <CalendarSettings
                  key={calendar.id}
                  calendar={calendar}
                  onChanged={onChanged}
                  onNotice={setNotice}
                  onDeleted={() => {
                    onChanged()
                    setSelected("new")
                    setNotice("日曆已移除")
                  }}
                />
              )
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewCalendar({
  onSaved,
}: {
  onSaved: (calendar: api.CalendarCollection) => void
}) {
  const [name, setName] = useState("")
  const [color, setColor] = useState("#3B82F6")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError("")
        try {
          onSaved(await api.saveCalendar({ name, color }))
        } catch (err) {
          setError(message(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <h3 className="font-semibold">新增分類日曆</h3>
      <label className="planner-field">
        名稱
        <input
          autoFocus
          required
          maxLength={80}
          placeholder="例如：工作、私人、家庭"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="planner-field">
        顏色
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button disabled={busy || !name.trim()}>
        {busy ? "建立中…" : "建立日曆"}
      </Button>
    </form>
  )
}

function CalendarSettings({
  calendar,
  onChanged,
  onNotice,
  onDeleted,
}: {
  calendar: api.CalendarCollection
  onChanged: () => void
  onNotice: (text: string) => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(calendar.name)
  const [color, setColor] = useState(calendar.color)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [feed, setFeed] = useState("")
  const owner = calendar.role === "owner"
  async function run(action: () => Promise<unknown>, notice = "設定已儲存") {
    setBusy(true)
    setError("")
    try {
      await action()
      onChanged()
      if (notice) onNotice(notice)
    } catch (err) {
      setError(message(err))
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => api.saveCalendar({ name, color }, calendar.id))
        }}
      >
        <label className="planner-field">
          名稱
          <input
            value={name}
            disabled={!owner}
            required
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="planner-field">
          顏色
          <input
            type="color"
            value={color}
            disabled={!owner}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        {owner && <Button disabled={busy}>儲存設定</Button>}
      </form>
      <section className="space-y-2 border-t pt-4">
        <h3 className="font-semibold">匯入與匯出</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                async () =>
                  api.downloadCalendarFile(
                    await api.exportCalendar(calendar.id),
                    `${calendar.name}.ics`
                  ),
                "已匯出 ICS 檔案"
              )
            }
          >
            <Download />
            匯出 ICS
          </Button>
          {calendar.can_edit && (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-xl border-2 px-3 py-2 text-sm hover:bg-muted">
              <Upload className="size-4" />
              匯入 ICS
              <input
                type="file"
                accept=".ics,text/calendar"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file)
                    void run(async () => {
                      if (file.size > 2 * 1024 * 1024)
                        throw new Error("檔案上限為 2 MB")
                      const result = await api.importCalendar(calendar.id, file)
                      onNotice(`已匯入 ${result.imported} 個行程系列`)
                    }, "")
                  e.target.value = ""
                }}
              />
            </label>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          ICS 檔案可與 Apple、Google 等行事曆交換；重複匯入相同 UID
          會更新原行程。
        </p>
      </section>
      {owner && (
        <section className="space-y-2 border-t pt-4">
          <h3 className="font-semibold">提供唯讀訂閱</h3>
          <p className="text-xs text-muted-foreground">
            持有連結的人可讀取這本日曆的全部行程。可隨時撤銷，或重設連結使舊連結失效。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.enableCalendarFeed(calendar.id)
                  setFeed(`${window.location.origin}${result.path}`)
                }, "訂閱連結已產生")
              }
            >
              {calendar.feed_enabled ? "重設訂閱連結" : "產生訂閱連結"}
            </Button>
            {calendar.feed_enabled && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.disableCalendarFeed(calendar.id)
                    setFeed("")
                  }, "訂閱連結已撤銷")
                }
              >
                撤銷訂閱
              </Button>
            )}
          </div>
          {feed && (
            <div className="flex gap-2">
              <input
                aria-label="唯讀訂閱連結"
                readOnly
                value={feed}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void run(
                    () => navigator.clipboard.writeText(feed),
                    "連結已複製"
                  )
                }
              >
                複製
              </Button>
            </div>
          )}
        </section>
      )}
      {owner && calendar.source !== "local" && (
        <section className="space-y-2 border-t pt-4">
          <h3 className="font-semibold">外部同步</h3>
          <p className="text-xs text-muted-foreground">
            {calendar.source === "caldav" ? "CalDAV 雙向同步" : "ICS 唯讀訂閱"}{" "}
            ·{" "}
            {calendar.synced_at
              ? `上次同步 ${new Date(calendar.synced_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`
              : "尚未同步"}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => api.syncCalendar(calendar.id), "日曆已同步")
            }
          >
            <RefreshCw />
            立即同步
          </Button>
          {calendar.sync_error && (
            <div className="space-y-2 rounded-xl bg-muted p-3">
              <p className="text-sm text-destructive">{calendar.sync_error}</p>
              {calendar.source === "caldav" &&
                calendar.sync_error.includes("修改") && (
                  <>
                    <p className="text-xs">
                      以下選擇會套用到這本日曆所有衝突行程。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.syncCalendar(calendar.id, "remote"),
                            "已採用外部版本"
                          )
                        }
                      >
                        捨棄本機變更，採用外部
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.syncCalendar(calendar.id, "local"),
                            "已保留本機版本並同步"
                          )
                        }
                      >
                        保留本機，更新外部
                      </Button>
                    </div>
                  </>
                )}
            </div>
          )}
        </section>
      )}
      {owner && <Sharing calendar={calendar} />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <section className="space-y-2 border-t pt-4">
        {owner ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={() => setConfirmDelete(!confirmDelete)}
            >
              <Trash2 />
              {calendar.source === "local" ? "刪除日曆" : "移除外部連接"}
            </Button>
            {confirmDelete && (
              <div className="space-y-2 rounded-xl border border-destructive/30 p-3">
                <p className="text-sm">
                  {calendar.source === "local"
                    ? "這本日曆及其中行程都會刪除。"
                    : "只移除此系統中的連接與副本，外部服務上的日曆會保留。"}
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.deleteCalendar(calendar.id)
                      onDeleted()
                    }, "")
                  }
                >
                  確認移除
                </Button>
              </div>
            )}
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.respondCalendar(calendar.id, "declined")
                onDeleted()
              }, "")
            }
          >
            退出共享日曆
          </Button>
        )}
      </section>
    </div>
  )
}

function Sharing({ calendar }: { calendar: api.CalendarCollection }) {
  const [members, setMembers] = useState<api.CalendarMember[]>([])
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<api.CalendarPerson[]>([])
  const [role, setRole] = useState<"reader" | "editor">("reader")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    api
      .getMembers(calendar.id)
      .then((data) => active && setMembers(data.members))
      .catch((e) => active && setError(message(e)))
    return () => {
      active = false
    }
  }, [calendar.id, revision])
  useEffect(() => {
    if (query.trim().length < 2) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      api
        .findCalendarPeople(query.trim(), controller.signal)
        .then((data) => setPeople(data.people))
        .catch((e) => {
          if (!controller.signal.aborted) setError(message(e))
        })
    }, 250)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [query])
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError("")
    try {
      await action()
      setRevision((r) => r + 1)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <Users className="size-4" />
        共享日曆
      </h3>
      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {m.name}
              <span className="ml-1 text-xs text-muted-foreground">
                {m.status === "pending"
                  ? "待接受"
                  : m.status === "declined"
                    ? "已拒絕"
                    : ""}
              </span>
            </span>
            {m.role === "owner" ? (
              <span className="text-xs text-muted-foreground">擁有者</span>
            ) : (
              <>
                <select
                  aria-label={`${m.name}的權限`}
                  className="!w-28"
                  value={m.role}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      api.shareCalendar(
                        calendar.id,
                        m.user_id,
                        e.target.value as "reader" | "editor"
                      )
                    )
                  }
                >
                  <option value="reader">可檢視</option>
                  <option value="editor">可編輯</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`移除${m.name}`}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api.removeCalendarMember(calendar.id, m.user_id)
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      <label className="planner-field">
        邀請站內使用者
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPeople([])
          }}
          placeholder="搜尋姓名或 Email（至少兩字）"
        />
      </label>
      <select
        aria-label="邀請權限"
        value={role}
        onChange={(e) => setRole(e.target.value as "reader" | "editor")}
      >
        <option value="reader">可檢視</option>
        <option value="editor">可編輯</option>
      </select>
      {query.trim().length >= 2 && (
        <ul className="max-h-40 overflow-y-auto">
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={busy}
                className="flex w-full items-center justify-between gap-2 rounded-xl p-2 text-left text-sm hover:bg-muted"
                onClick={() =>
                  void run(() => api.shareCalendar(calendar.id, p.id, role))
                }
              >
                <span>
                  {p.name}
                  <span className="block text-xs text-muted-foreground">
                    {p.email}
                  </span>
                </span>
                <Plus className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

function ConnectCalendar({ onSaved }: { onSaved: () => void }) {
  const [body, setBody] = useState<api.ConnectionBody>({
    name: "外部日曆",
    color: "#10B981",
    source: "ics",
    url: "",
    username: "",
    password: "",
  })
  const [discovered, setDiscovered] = useState<{ name: string; url: string }[]>(
    []
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const patch = (value: Partial<api.ConnectionBody>) =>
    setBody((current) => ({ ...current, ...value }))
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        void run(async () => {
          await api.connectCalendar(body)
          setBody({ ...body, password: "" })
          onSaved()
        })
      }}
    >
      <h3 className="font-semibold">連接外部日曆</h3>
      <label className="planner-field">
        連接方式
        <select
          value={body.source}
          onChange={(e) => {
            patch({
              source: e.target.value as "ics" | "caldav",
              url:
                e.target.value === "caldav" ? "https://caldav.icloud.com/" : "",
            })
            setDiscovered([])
          }}
        >
          <option value="ics">ICS 唯讀訂閱</option>
          <option value="caldav">CalDAV 雙向同步</option>
        </select>
      </label>
      <label className="planner-field">
        顯示名稱
        <input
          required
          maxLength={80}
          value={body.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label className="planner-field">
        網址
        <input
          required
          value={body.url}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder={
            body.source === "ics"
              ? "貼上 .ics 或 webcal 訂閱網址"
              : "CalDAV 伺服器或日曆集合網址"
          }
        />
      </label>
      {body.source === "ics" ? (
        <>
          <p className="text-xs text-muted-foreground">
            支援 Apple 公開行事曆、Google 秘密 ICS
            網址與節日訂閱。每五分鐘檢查更新，可隨時手動同步。
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              patch({
                name: "台灣節日",
                url: "https://calendar.google.com/calendar/ical/zh.taiwan%23holiday%40group.v.calendar.google.com/public/basic.ics",
              })
            }
          >
            填入台灣節日訂閱
          </Button>
        </>
      ) : (
        <>
          <label className="planner-field">
            帳號
            <input
              autoComplete="username"
              required
              value={body.username}
              onChange={(e) => patch({ username: e.target.value })}
            />
          </label>
          <label className="planner-field">
            App 專用密碼
            <input
              type="password"
              autoComplete="new-password"
              required
              value={body.password}
              onChange={(e) => patch({ password: e.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            iCloud 請使用 Apple 帳號與 App
            專用密碼。先取得日曆清單，再選擇一本連接；Google 可使用上方 ICS
            訂閱。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !body.username || !body.password}
            onClick={() =>
              void run(async () =>
                setDiscovered((await api.discoverCalendars(body)).calendars)
              )
            }
          >
            取得日曆清單
          </Button>
          {discovered.length > 0 && (
            <ul className="space-y-1">
              {discovered.map((c) => (
                <li key={c.url}>
                  <button
                    type="button"
                    className={`w-full rounded-xl border p-2 text-left text-sm ${c.url === body.url ? "border-primary bg-muted" : ""}`}
                    onClick={() => patch({ url: c.url, name: c.name })}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <label className="planner-field">
        顏色
        <input
          type="color"
          value={body.color}
          onChange={(e) => patch({ color: e.target.value })}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button disabled={busy || !body.url}>
        {busy ? "連接與同步中…" : "連接日曆"}
      </Button>
    </form>
  )
}

function NotificationSettings({
  workspace,
}: {
  workspace: api.CalendarWorkspace
}) {
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<unknown>, text: string) {
    setBusy(true)
    try {
      await action()
      setNotice(text)
    } catch (e) {
      setNotice(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-4">
      <h3 className="font-semibold">行程通知</h3>
      <p className="text-sm">
        每個行程可以設定多次提醒。登入期間，站內提醒會在任何頁面出現。
      </p>
      <div className="space-y-2 rounded-xl border p-3">
        <h4 className="font-medium">背景推播</h4>
        <p className="text-xs text-muted-foreground">
          啟用後，即使關閉日曆頁面也能收到通知。iPhone
          需將網站加入主畫面，並從主畫面開啟。
        </p>
        {!pushSupported() ? (
          <p className="text-xs text-muted-foreground">
            目前瀏覽器尚無法啟用背景推播。
          </p>
        ) : !workspace.push_public_key ? (
          <p className="text-xs text-muted-foreground">
            伺服器尚未設定背景推播，站內提醒可正常使用。
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => enableCalendarPush(workspace.push_public_key!),
                  "已開啟此裝置的背景通知"
                )
              }
            >
              開啟此裝置通知
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(disableCalendarPush, "已關閉此裝置的背景通知")
              }
            >
              關閉通知
            </Button>
          </div>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </section>
  )
}

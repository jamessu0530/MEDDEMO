import { useState, type FormEvent } from "react"

import { getOrgChart, reassignCustomer, type OrgMember } from "@/api/admin"
import type { Customer } from "@/api/customers"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"

/** IT 在客戶檔案頁換這家客戶的負責人（backend/app/api/admin.py）。只換負責人，過去的拜訪、報價仍記在原本的人名下 */
export function ReassignOwner({
  customer,
  onDone,
}: {
  customer: Customer
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  // 在職的業務；打開對話框時才向組織管理要，客戶檔案本身用不到
  const [reps, setReps] = useState<OrgMember[] | null>(null)
  const [target, setTarget] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function show() {
    setOpen(true)
    setTarget("")
    setError(null)
    if (reps) return
    try {
      const chart = await getOrgChart()
      setReps(
        chart.users.filter((user) => user.role === "sales" && user.active)
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "業務名單沒有載入，請再試一次"
      )
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !target) return
    setBusy(true)
    setError(null)
    try {
      await reassignCustomer(customer.id, target)
      setOpen(false)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有換成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">負責業務</p>
          <p className="text-sm font-medium">{customer.owner_name}</p>
        </div>
        <Button variant="outline" className="h-11 shrink-0 px-4" onClick={show}>
          換負責人
        </Button>
      </section>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>換負責人</DialogTitle>
            <DialogDescription>
              {customer.name}改由誰負責？過去的拜訪、報價與出差單仍記在
              {customer.owner_name}名下。
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-owner">新的負責業務</Label>
              <NativeSelect
                id="new-owner"
                value={target}
                disabled={!reps}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">{reps ? "選一位" : "載入中…"}</option>
                {reps
                  ?.filter((rep) => rep.id !== customer.owner_id)
                  .map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.name}（{rep.region}）
                    </option>
                  ))}
              </NativeSelect>
            </div>
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
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" className="h-11" disabled={busy || !target}>
                換負責人
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

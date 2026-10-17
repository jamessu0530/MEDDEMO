import { ClipboardList, Plus, Users } from "@/components/icons"
import { Link } from "react-router"

import { SalesToolbar } from "@/components/sales-toolbar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"

/** 銷售各分頁共用頁首與操作位置，查商品時也能直接新增訂單。 */
export function SalesHeader({
  title = "銷售",
  createDisabled = false,
  onCreate,
}: {
  title?: string
  createDisabled?: boolean
  onCreate: () => void
}) {
  const user = useAuth()?.user
  return (
    <>
      {user?.role === "sales" && (
        <div className="mb-3 lg:hidden">
          <SalesToolbar user={user} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="size-6" />
          </span>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/customers">
              <Users className="size-4" />
              客戶資料
            </Link>
          </Button>
          <Button
            data-ui-demo="new-order"
            disabled={createDisabled}
            onClick={onCreate}
          >
            <Plus className="size-4" />
            新增訂單
          </Button>
        </div>
      </div>
    </>
  )
}

import { useEffect, useState } from "react"
import { useNavigate } from "react-router"

import { ApiError } from "@/api/client"
import { getVehicles, type Vehicles } from "@/api/vehicles"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { RideCollection } from "@/components/rides/collection"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  // 主管、IT 沒有自己的路線，也就沒有圖鑑：直接顯示後端那一句
  | { status: "denied"; message: string }
  | { status: "ready"; vehicles: Vehicles }

/** 座騎圖鑑：七個縣市 × 四種交通方式，熊熊滾騎過的有顏色，沒騎過的是灰色剪影 */
export function RidesPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getVehicles(controller.signal)
      .then((vehicles) => setState({ status: "ready", vehicles }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 403) setState({ status: "denied", message: error.message })
        else setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="座騎圖鑑" subtitle="熊熊滾騎過的座騎" backTo="/" />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入圖鑑中…</p>}
        {state.status === "error" && (
          <Notice
            text="圖鑑暫時載入不了"
            action={{
              label: "重試",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
          />
        )}
        {state.status === "denied" && (
          <Notice text={state.message} action={{ label: "去主管端", onClick: () => navigate("/manager") }} />
        )}
        {state.status === "ready" && <RideCollection vehicles={state.vehicles} />}
      </main>
    </div>
  )
}

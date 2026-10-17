import type { Me } from "@/api/me"
import { MonthlySales, TopCustomers } from "@/components/me/sales-charts"

export default function Performance({ me }: { me: Me }) {
  return (
    <>
      <section className="rounded-2xl border bg-card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">賣最多的藥局</h2>
          <span className="text-xs text-muted-foreground">近一年進貨</span>
        </div>
        <TopCustomers items={me.top_customers} />
      </section>
      <section className="rounded-2xl border bg-card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">每月業績</h2>
          <span className="text-xs text-muted-foreground">近六個月</span>
        </div>
        <MonthlySales months={me.monthly} />
      </section>
    </>
  )
}

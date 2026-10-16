import { useEffect, useState } from "react"
import { getOrderCustomers, type OrderCustomer } from "@/api/orders"
import { SearchSelect } from "@/components/ui/search-select"

export function CustomerSelect({
  label,
  value,
  selected,
  onSelect,
  disabled,
}: {
  label: string
  value: string
  selected?: { name: string; address?: string | null }
  onSelect: (customer: OrderCustomer) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("")
  const [customers, setCustomers] = useState<OrderCustomer[]>([])
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      getOrderCustomers(controller.signal, query.trim())
        .then((items) => {
          if (!controller.signal.aborted) setCustomers(items)
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setError(err instanceof Error ? err.message : "客戶沒有載入")
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, retry])
  function search(text: string) {
    setQuery(text)
    setLoading(true)
    setError("")
  }
  return (
    <SearchSelect
      label={label}
      value={value}
      remote
      disabled={disabled}
      placeholder="請選擇客戶"
      searchPlaceholder="搜尋名稱、地址或電話（支援錯字）"
      options={customers.map((customer) => ({
        value: customer.id,
        label: customer.name,
        description:
          customer.address ||
          `${customer.city || customer.region}${customer.area || ""}`,
        meta: [customer.id, customer.phone].filter(Boolean).join(" · "),
      }))}
      selectedOptions={
        value && selected
          ? [
              {
                value,
                label: selected.name,
                description: selected.address || undefined,
              },
            ]
          : []
      }
      onValueChange={(id) => {
        if (id === value) return
        const customer = customers.find((item) => item.id === id)
        if (customer) onSelect(customer)
      }}
      loading={loading}
      error={error}
      onRetry={() => {
        search(query)
        setRetry((n) => n + 1)
      }}
      onQueryChange={search}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setLoading(true)
          setError("")
        }
      }}
    />
  )
}

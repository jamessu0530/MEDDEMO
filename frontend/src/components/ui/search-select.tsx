import { useEffect, useId, useRef, useState } from "react"
import { Check, ChevronDown, Search, X } from "@/components/icons"
import { Popover } from "radix-ui"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/ui/search-field"
import { cn } from "@/lib/utils"
import {
  searchOptions,
  toggleSelection,
  toggleSelectionPage,
  type SelectionOption,
} from "@/lib/selection"

type Common = {
  label: string
  options: SelectionOption[]
  placeholder?: string
  searchPlaceholder?: string
  selectedOptions?: SelectionOption[]
  disabled?: boolean
  loading?: boolean
  error?: string
  onRetry?: () => void
  onQueryChange?: (query: string) => void
  onOpenChange?: (open: boolean) => void
  remote?: boolean
  emptyText?: string
  className?: string
}
type Props = Common &
  (
    | {
        multiple: true
        value: string[]
        onValueChange: (value: string[]) => void
        maximum?: number
      }
    | {
        multiple?: false
        value: string
        onValueChange: (value: string) => void
      }
  )

export function SearchSelect(props: Props) {
  const { label, options, disabled, loading, error } = props
  const id = useId(),
    input = useRef<HTMLInputElement | null>(null),
    list = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("")
  const [draft, setDraft] = useState<string[]>([]),
    [selectedOnly, setSelectedOnly] = useState(false)
  const [count, setCount] = useState(60),
    [active, setActive] = useState(0)
  const values = props.multiple ? props.value : props.value ? [props.value] : []
  const current = props.multiple && open ? draft : values
  const selected = new Set(current)
  const known = new Map(
    [...options, ...(props.selectedOptions ?? [])].map((option) => [
      option.value,
      option,
    ])
  )
  const chosen = current.map(
    (value) => known.get(value) ?? { value, label: value }
  )
  const matches = props.remote ? options : searchOptions(options, query)
  const filtered = selectedOnly ? searchOptions(chosen, query) : matches
  const shown = filtered.slice(0, count)
  const maximum = props.multiple ? (props.maximum ?? 500) : 1
  const available = shown.filter(
    (option) =>
      !option.disabled &&
      (selected.has(option.value) || current.length < maximum)
  )
  const highlighted =
    !loading && !error
      ? available[Math.min(active, available.length - 1)]
      : undefined
  const pageKeys = shown
    .filter((option) => !option.disabled)
    .map((option) => option.value)
  const allPage =
    pageKeys.length > 0 && pageKeys.every((value) => selected.has(value))
  const pageAddCount = Math.min(
    maximum - current.length,
    pageKeys.filter((value) => !selected.has(value)).length
  )

  useEffect(() => {
    if (open)
      list.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" })
  }, [active, open])

  function changeOpen(next: boolean) {
    setOpen(next)
    setQuery("")
    setCount(60)
    setActive(0)
    setSelectedOnly(false)
    if (next && props.multiple) setDraft([...props.value])
    props.onQueryChange?.("")
    props.onOpenChange?.(next)
  }
  function choose(option: SelectionOption) {
    if (option.disabled || loading || error) return
    if (props.multiple)
      setDraft((keys) => toggleSelection(keys, option.value, maximum))
    else {
      props.onValueChange(option.value)
      changeOpen(false)
    }
  }
  const display = values.map((value) => known.get(value)?.label ?? value)
  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={`${id}-panel`}
          disabled={disabled}
          className={cn(
            "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl border-2 border-input bg-card px-3 py-2 text-left text-sm shadow-sm transition-colors outline-none hover:border-primary/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60",
            props.className
          )}
        >
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate",
                !display.length && "text-muted-foreground"
              )}
            >
              {display.length
                ? display.slice(0, 2).join("、")
                : (props.placeholder ?? `請選擇${label}`)}
            </span>
            {!props.multiple &&
              values.length > 0 &&
              known.get(values[0])?.description && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {known.get(values[0])?.description}
                </span>
              )}
          </span>
          {props.multiple && values.length > 0 && (
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {values.length}
            </span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-slot="search-select-content"
          id={`${id}-panel`}
          role="dialog"
          aria-label={`選擇${label}`}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            input.current?.focus()
          }}
          className="z-[70] flex max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[max(20rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border-2 bg-popover text-popover-foreground shadow-xl outline-none"
        >
          <div className="shrink-0 border-b p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{label}</span>
              <span className="text-xs text-muted-foreground">
                {props.multiple ? `已選 ${current.length}／${maximum}` : "單選"}
              </span>
            </div>
            <SearchField
              ref={input}
              aria-label={`搜尋${label}`}
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
              aria-controls={`${id}-list`}
              aria-activedescendant={
                highlighted
                  ? `${id}-option-${shown.indexOf(highlighted)}`
                  : undefined
              }
              value={query}
              loading={loading}
              placeholder={props.searchPlaceholder ?? "搜尋名稱或編號"}
              onValueChange={(value) => {
                setQuery(value)
                setActive(0)
                setCount(60)
                props.onQueryChange?.(value)
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault()
                  setActive((index) =>
                    available.length
                      ? (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          available.length) %
                        available.length
                      : 0
                  )
                } else if (event.key === "Enter") {
                  event.preventDefault()
                  if (highlighted) choose(highlighted)
                }
              }}
            />
            {props.multiple && (
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOnly(false)
                    setActive(0)
                  }}
                  aria-pressed={!selectedOnly}
                  className={cn(
                    "min-h-9 rounded-md",
                    !selectedOnly && "bg-card font-medium shadow-sm"
                  )}
                >
                  全部選項
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOnly(true)
                    setActive(0)
                  }}
                  aria-pressed={selectedOnly}
                  className={cn(
                    "min-h-9 rounded-md",
                    selectedOnly && "bg-card font-medium shadow-sm"
                  )}
                >
                  已選項目（{current.length}）
                </button>
              </div>
            )}
          </div>
          {props.multiple && current.length > 0 && !selectedOnly && (
            <div className="flex max-h-24 shrink-0 flex-wrap gap-1.5 overflow-auto border-b bg-primary/5 px-3 py-2">
              {chosen.slice(0, 5).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-label={`取消${option.label}`}
                  onClick={() =>
                    setDraft((keys) => toggleSelection(keys, option.value))
                  }
                  className="flex min-h-8 max-w-full items-center gap-1 rounded-lg border border-primary/15 bg-card px-2 text-xs text-primary"
                >
                  <span className="truncate">{option.label}</span>
                  <X aria-hidden="true" className="size-3 shrink-0" />
                </button>
              ))}
              {chosen.length > 5 && (
                <button
                  type="button"
                  onClick={() => setSelectedOnly(true)}
                  className="min-h-8 text-xs text-primary"
                >
                  查看全部 {chosen.length} 項
                </button>
              )}
            </div>
          )}
          <div
            className="min-h-0 flex-1 overflow-auto p-1.5"
            aria-busy={loading}
          >
            {error ? (
              <div
                role="alert"
                className="space-y-3 px-4 py-7 text-center text-sm"
              >
                <p>{error}</p>
                {props.onRetry && (
                  <Button variant="outline" onClick={props.onRetry}>
                    重新載入
                  </Button>
                )}
              </div>
            ) : loading ? (
              <p
                role="status"
                className="px-4 py-8 text-center text-sm text-muted-foreground"
              >
                正在搜尋{label}…
              </p>
            ) : (
              <>
                <div
                  ref={list}
                  id={`${id}-list`}
                  role="listbox"
                  aria-label={`${label}選項`}
                  aria-multiselectable={props.multiple || undefined}
                >
                  {shown.map((option, index) => {
                    const checked = selected.has(option.value),
                      blocked =
                        option.disabled ||
                        (!checked &&
                          current.length >= maximum &&
                          props.multiple)
                    return (
                      <button
                        key={option.value}
                        id={`${id}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={checked}
                        disabled={blocked}
                        tabIndex={-1}
                        data-active={highlighted?.value === option.value}
                        onMouseMove={() =>
                          setActive(
                            Math.max(
                              0,
                              available.findIndex(
                                (item) => item.value === option.value
                              )
                            )
                          )
                        }
                        onClick={() => choose(option)}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none disabled:cursor-not-allowed disabled:opacity-45",
                          checked ? "bg-primary/8" : "hover:bg-muted",
                          highlighted?.value === option.value &&
                            "ring-1 ring-primary/30 ring-inset"
                        )}
                      >
                        {props.multiple && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border",
                              checked
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input bg-card"
                            )}
                          >
                            {checked && <Check className="size-3" />}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium break-words">
                            {option.label}
                          </span>
                          {option.description && (
                            <span className="mt-0.5 block text-xs break-words text-muted-foreground">
                              {option.description}
                            </span>
                          )}
                          {option.meta && (
                            <span className="mt-1 block text-[11px] text-muted-foreground">
                              {option.meta}
                            </span>
                          )}
                        </span>
                        {!props.multiple && checked && (
                          <Check
                            aria-hidden="true"
                            className="size-4 shrink-0 text-primary"
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
                {!shown.length && (
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <Search
                      aria-hidden="true"
                      className="size-6 text-muted-foreground"
                    />
                    <p className="text-sm">
                      {selectedOnly
                        ? "沒有符合的已選項目"
                        : (props.emptyText ?? "沒有符合的選項")}
                    </p>
                  </div>
                )}
                {filtered.length > count && (
                  <button
                    type="button"
                    onClick={() => setCount((size) => size + 60)}
                    className="min-h-11 w-full rounded-lg text-xs font-medium text-primary hover:bg-muted"
                  >
                    顯示更多
                  </button>
                )}
              </>
            )}
          </div>
          {props.multiple && (
            <div className="shrink-0 border-t bg-muted/30 px-3 py-2.5">
                <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                  <button
                    type="button"
                    className="min-h-8 text-primary disabled:text-muted-foreground"
                    disabled={
                      !pageKeys.length ||
                      loading ||
                      !!error ||
                      (!allPage && pageAddCount === 0)
                    }
                    onClick={() =>
                      setDraft((keys) =>
                        toggleSelectionPage(keys, pageKeys, maximum)
                      )
                    }
                  >
                    {allPage
                      ? `取消本頁 ${pageKeys.length} 項`
                      : `選取本頁 ${pageAddCount} 項`}
                  </button>
                  <button
                    type="button"
                    className="min-h-8 text-muted-foreground disabled:opacity-40"
                    disabled={!current.length}
                    onClick={() => setDraft([])}
                  >
                    清除全部
                  </button>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => changeOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => {
                      if (props.multiple) props.onValueChange(draft)
                      changeOpen(false)
                    }}
                  >
                    套用 {current.length} 項
                  </Button>
                </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

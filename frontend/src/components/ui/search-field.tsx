import { useId, type ComponentProps } from "react"
import { LoaderCircle, Search, X } from "@/components/icons"
import { cn } from "@/lib/utils"

type Props = Omit<ComponentProps<"input">, "onChange" | "value" | "size"> & {
  value: string
  onValueChange: (value: string) => void
  loading?: boolean
  containerClassName?: string
}

export function SearchField({
  value,
  onValueChange,
  loading,
  className,
  containerClassName,
  ...props
}: Props) {
  const id = useId()
  return (
    <div
      className={cn("relative flex min-w-0 items-center", containerClassName)}
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground"
      />
      <input
        id={id}
        type="search"
        autoComplete="off"
        maxLength={100}
        {...props}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          "h-11 w-full min-w-0 rounded-xl border-2 border-input bg-background pr-20 pl-10 text-base transition-colors outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:opacity-50 sm:text-sm [&::-webkit-search-cancel-button]:appearance-none",
          className
        )}
      />
      <div className="absolute right-1.5 flex items-center gap-0.5">
        {loading && (
          <LoaderCircle
            aria-hidden="true"
            className="mx-1 size-4 animate-spin text-primary"
          />
        )}
        {value && (
          <button
            type="button"
            aria-label={`清除${props["aria-label"] ?? "搜尋"}`}
            disabled={props.disabled}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            onClick={(event) => {
              onValueChange("")
              event.currentTarget
                .closest("div.relative")
                ?.querySelector("input")
                ?.focus()
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}

import { cn } from "@/lib/utils"

/** 開關（鎖住、習慣的啟用）。整顆 44px 高好按；旁邊的說明文字由呼叫端放，label 給讀螢幕的人 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex h-11 w-14 shrink-0 items-center justify-center outline-none disabled:opacity-50"
    >
      <span
        className={cn(
          "relative h-7 w-12 rounded-full transition-colors group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
          checked ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
            checked && "translate-x-5"
          )}
        />
      </span>
    </button>
  )
}

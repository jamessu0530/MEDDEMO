import * as React from "react"
import { cn } from "cn"

/** 原生下拉選單，外觀跟 Input 一致。手機上原生的選單最好點，也不必多裝一個元件 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-11 w-full min-w-0 rounded-xl border-2 border-input bg-card shadow-lip px-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }

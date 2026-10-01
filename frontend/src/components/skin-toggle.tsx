import { Moon, Sun } from "lucide-react"

import { changeSkin } from "@/ink/ink"
import { useSkin } from "@/lib/skin"
import { cn } from "@/lib/utils"

/**
 * 頁首的深色、淺色切換：淺色是紫色那一組，深色是黑灰底。淺色時顯示月亮、深色時顯示太陽，按了換成另一個。
 * 換的時候跟設定頁一樣，用噴漆從按的位置把整個畫面染過去（ink/ink.ts 的 changeSkin）。
 */
export function SkinToggle({ className }: { className?: string }) {
  const dark = useSkin() === "dark"
  return (
    <button
      type="button"
      aria-label={dark ? "換成淺色" : "換成深色"}
      onClick={() => changeSkin(dark ? "light" : "dark")}
      className={cn("flex shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted", className)}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}

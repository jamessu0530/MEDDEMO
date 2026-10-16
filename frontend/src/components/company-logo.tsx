import { cn } from "@/lib/utils"

import "./company-logo.css"

/** 中化製藥官方關係企業頁提供的中化裕民商標；來源記錄在 public/brand/README.md。 */
export function CompanyLogo({ className, intro = false }: { className?: string; intro?: boolean }) {
  return (
    <img
      src="/brand/cenra-healthcare.png"
      alt="中化裕民 CENRA+ Healthcare"
      width={259}
      height={83}
      draggable={false}
      className={cn("company-logo h-auto w-32 max-w-full shrink-0 object-contain", intro && "company-logo--intro", className)}
    />
  )
}

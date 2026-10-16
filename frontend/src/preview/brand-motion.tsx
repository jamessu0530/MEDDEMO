import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import { CompanyLogo } from "@/components/company-logo"
import { Button } from "@/components/ui/button"
import "../index.css"

export function BrandMotionPreview() {
  const [take, setTake] = useState(0)
  return (
    <main className="mx-auto flex min-h-svh max-w-4xl flex-col justify-center gap-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-muted-foreground">中化裕民</p>
          <h1 className="mt-1 text-xl font-semibold">CENRA+ Healthcare 商標動畫</h1>
        </div>
        <Button variant="outline" onClick={() => setTake((value) => value + 1)}>預覽淡入</Button>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-label="淺色背景" className="flex min-h-64 flex-col items-center justify-center gap-8 rounded-3xl border bg-white p-8">
          <CompanyLogo key={`light-${take}`} intro className="w-72" />
          <p className="text-sm text-[#6e6a78]">中化裕民</p>
        </section>
        <section aria-label="深色背景" className="flex min-h-64 flex-col items-center justify-center gap-8 rounded-3xl border border-[#302a3b] bg-[#18151f] p-8">
          <CompanyLogo key={`dark-${take}`} intro className="w-72" />
          <p className="text-sm text-[#b8b0c8]">中化裕民</p>
        </section>
      </div>
      <p className="text-center text-xs text-muted-foreground">僅登入時輕微淡入一次，平常保持靜態。</p>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><BrandMotionPreview /></StrictMode>)

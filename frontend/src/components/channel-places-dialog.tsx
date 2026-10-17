import { useState } from "react"
import { ChevronDown, Search } from "@/components/icons"

import type { Channel } from "@/api/channels"
import { UnreadDot } from "@/components/channels-link"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { GEOGRAPHY_SOURCE, placeDirectory } from "@/lib/channel-geography"
import { cn } from "@/lib/utils"

/** 全台共用地點按縣市展開，行政區資料與示範組織分區分別呈現。 */
export function ChannelPlacesDialog({ channels, selectedId, onSelect, onClose }: {
  channels: Channel[]
  selectedId: number | null
  onSelect: (channel: Channel) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const directory = placeDirectory(channels, query)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(
    placeDirectory(channels).cities.filter((city) => city.districts.some((district) => district.channels.some((channel) => channel.id === selectedId))).map((city) => city.code)
  ))
  const choose = (channel: Channel) => { onSelect(channel); onClose() }
  const toggle = (code: string) => setExpanded((previous) => {
    const next = new Set(previous)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    return next
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85svh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>全台地點頻道</DialogTitle>
          <DialogDescription>22 縣市・368 個鄉鎮市區，選擇地點開始討論。</DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <Search aria-hidden className="absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input aria-label="搜尋縣市或鄉鎮市區" placeholder="搜尋縣市或鄉鎮市區，例如：桃園、板橋" value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 pl-9 text-sm" />
        </label>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {directory.cities.length === 0 && directory.other.length === 0 && <p role="status" className="py-8 text-center text-muted-foreground">找不到這個地點，試試完整的縣市或行政區名稱。</p>}
          <div className="grid items-start gap-2 sm:grid-cols-2">
            {directory.cities.map((city) => {
              const open = query.trim().length > 0 || expanded.has(city.code)
              const controls = `county-${city.code}`
              return (
                <section key={city.code} className="overflow-hidden rounded-xl border bg-card">
                  <button type="button" aria-expanded={open} aria-controls={controls} onClick={() => toggle(city.code)} className="flex min-h-12 w-full items-center gap-2 px-3 text-left hover:bg-muted">
                    <span className="flex-1 font-semibold">{city.name}</span>
                    <span className="text-xs text-muted-foreground">{city.total} 區</span>
                    {city.unread > 0 && <UnreadDot count={city.unread} />}
                    <ChevronDown aria-hidden className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                  </button>
                  {open && (
                    <div id={controls} className="grid grid-cols-2 gap-1 border-t p-2">
                      {city.districts.map((district) => district.channels.length > 0 ? district.channels.map((channel, index) => (
                        <button key={channel.id} type="button" aria-current={channel.id === selectedId ? "page" : undefined} onClick={() => choose(channel)} className={cn("flex min-h-10 items-center gap-1 rounded-lg px-2 text-left text-sm hover:bg-muted", channel.id === selectedId && "bg-primary/10 font-semibold text-primary")}>
                          <span className="min-w-0 flex-1">{district.name}{index > 0 && <span className="block text-xs text-muted-foreground">來源地點 {index + 1}</span>}</span>
                          {channel.unread > 0 && <UnreadDot count={channel.unread} />}
                        </button>
                      )) : <span key={district.code} className="px-2 py-2 text-sm text-muted-foreground">{district.name}<span className="block text-xs">頻道待建立</span></span>)}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
          {directory.other.length > 0 && (
            <section className="mt-4 rounded-xl border p-3">
              <h3 className="font-semibold">來源地點待核對</h3>
              <p className="mt-1 text-xs text-muted-foreground">原始通路名單的地名尚未對上現行行政區，保留原頻道供查閱。</p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {directory.other.map((channel) => <button key={channel.id} type="button" onClick={() => choose(channel)} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-left text-sm hover:bg-muted"><span className="flex-1">{channel.name}</span>{channel.unread > 0 && <UnreadDot count={channel.unread} />}</button>)}
              </div>
            </section>
          )}
        </div>
        <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          依<a href={GEOGRAPHY_SOURCE.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">內政部行政區清單</a>建置（{GEOGRAPHY_SOURCE.retrieved_on}）。這是地點分類；公司業務責任區尚待確認，北、中、南區目前沿用示範組織。
        </p>
      </DialogContent>
    </Dialog>
  )
}

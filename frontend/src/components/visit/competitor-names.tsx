import type { Visit } from "@/api/visits"

/** 競品欄位：一家一行，這家客戶以前確認過的拜訪從沒提過的標「首次」（原型「AI 抽出欄位」畫面） */
export function CompetitorNames({ visit }: { visit: Visit }) {
  const competitors = visit.fields.competitor ?? []
  return (
    <span className="flex flex-col gap-1">
      {competitors.map((competitor, index) => (
        <span key={`${competitor.name}-${index}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>{competitor.detail ? `${competitor.name}（${competitor.detail}）` : competitor.name}</span>
          {visit.first_competitors.includes(competitor.name) && (
            <span className="shrink-0 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-normal text-destructive">
              首次
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

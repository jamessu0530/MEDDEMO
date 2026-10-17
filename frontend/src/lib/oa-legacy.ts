import type { OaField, OaTemplate } from "@/api/oa"

export function oaMissing(
  template: OaTemplate,
  common: OaField[],
  fields: Record<string, string>,
  purpose: string,
  customerId: string
) {
  return [
    ...(template.needs_customer && !customerId ? ["客戶"] : []),
    ...[...common, ...template.fields]
      .filter((f) => f.required && !fields[f.key]?.trim())
      .map((f) => f.label),
    ...(!purpose.trim() ? ["申請目的／說明"] : []),
  ]
}

/** 自動帶入只補空白，保留業務已修改的內容。 */
export function fillOaBlanks(
  current: Record<string, string>,
  incoming: Record<string, string>
) {
  return {
    ...incoming,
    ...Object.fromEntries(
      Object.entries(current).filter(([, value]) => value.trim())
    ),
  }
}

export function businessGapText(items: string[]) {
  return `OA 串接待補資料\n請業務協助向各表單窗口確認：\n${items.map((item, i) => `${i + 1}. ${item}`).join("\n")}`
}

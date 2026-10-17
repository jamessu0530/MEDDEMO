import { requestedPageDemoPath } from "@/lib/page-demo"
import { requestedUiDemo } from "@/lib/ui-demo"

/** 明確叫助理示範時在本機啟動；一般訊息、查詢與附檔仍沿用頻道送出流程。 */
export function requestedChannelDemo(
  body: string,
  pagePath: string,
  hasFiles = false
) {
  if (hasFiles) return null
  const text = body.trim()
  const mention = /^[@＠](?:熊熊滾|熊熊|ai|ａｉ)(?=$|\s|[，,:：])/i
  if (!mention.test(text)) return null
  const question = text.replace(mention, "").replace(/^[\s，,:：]+/, "")
  const kind = requestedUiDemo(question, pagePath)
  if (!kind) return null
  return {
    kind,
    path:
      kind === "page-tour"
        ? (requestedPageDemoPath(question, pagePath) ?? pagePath)
        : undefined,
  }
}

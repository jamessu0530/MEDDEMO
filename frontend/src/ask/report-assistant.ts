import { adjustReport, type ReportAdjustment } from "@/api/reports"
import type { AskPageContext } from "@/ask/page-context"
import { onAuthChange, readUser } from "@/lib/auth"
import type { ReportConfig } from "@/lib/reports"

type ReportEditor = {
  config: ReportConfig
  available: boolean
  onApply: (config: ReportConfig) => void
}
type ReportAssistantState = {
  editing: boolean
  busy: boolean
  proposal: ReportAdjustment | null
}

/** The report editor lends its draft to the shared assistant while mounted. */
export function createReportAssistant() {
  let editor: ReportEditor | null = null
  let owner: symbol | null = null
  let base = ""
  let followup = false
  let controller: AbortController | null = null
  let state: ReportAssistantState = {
    editing: false,
    busy: false,
    proposal: null,
  }
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<ReportAssistantState>) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }
  const reset = () => {
    controller?.abort()
    controller = null
    editor = null
    owner = null
    base = ""
    followup = false
    publish({ editing: false, busy: false, proposal: null })
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    connect(initial: ReportEditor) {
      reset()
      const token = Symbol("report-editor")
      owner = token
      editor = initial
      base = JSON.stringify(initial.config)
      publish({ editing: true })
      return {
        update(next: ReportEditor) {
          if (owner !== token) return false
          editor = next
          const key = JSON.stringify(next.config)
          if (key === base) return true
          controller?.abort()
          controller = null
          base = key
          followup = false
          publish({ busy: false, proposal: null })
          return true
        },
        disconnect() {
          if (owner === token) reset()
        },
      }
    },
    handles(question: string, page?: AskPageContext) {
      if (!editor || page?.path.split("?")[0].replace(/\/$/, "") !== "/reports")
        return false
      // Clarifications and proposals accept refinements. Data questions still
      // use the shared query flow while a proposal is waiting for confirmation.
      return (
        /新增|加入|增加|刪除|移除|清空|刪掉|拿掉|改成|換成|改為|換為|變成|調整|修改|變更|放大|縮小|移動|排列|排序|順序|改名|更名|隱藏|只看|切換|[大小寬高矮]一點|改.{0,8}(圖|表|色|大小|名稱)|加.{0,6}(圖|表|卡)/.test(
          question
        ) ||
        (followup &&
          !/多少|幾[次家筆張個]|為什麼|原因|如何|怎麼|是什麼|代表|解釋|分析/.test(
            question
          ))
      )
    },
    async ask(question: string): Promise<string> {
      if (!editor) return "請先開啟報表編輯，再輸入調整需求。"
      if (!editor.available) return "AI 報表調整尚未設定，你仍可手動調整報表。"
      const request = new AbortController()
      controller?.abort()
      controller = request
      const startingOwner = owner
      const startingBase = base
      const config = state.proposal?.config ?? editor.config
      publish({ busy: true, proposal: null })
      try {
        const result = await adjustReport(question, config, request.signal)
        if (
          request.signal.aborted ||
          owner !== startingOwner ||
          base !== startingBase
        )
          return "報表已變更或離開編輯，請依目前的報表重新提出調整。"
        followup = true
        publish({ proposal: result.config ? result : null })
        return result.message
      } catch (error) {
        if (request.signal.aborted)
          return "報表已變更或離開編輯，請依目前的報表重新提出調整。"
        throw error
      } finally {
        if (controller === request) {
          controller = null
          publish({ busy: false })
        }
      }
    },
    apply() {
      if (!editor || state.busy || !state.proposal?.config) return
      const config = state.proposal.config
      followup = false
      publish({ proposal: null })
      editor.onApply(config)
    },
    dismiss() {
      followup = false
      publish({ proposal: null })
    },
    reset,
  }
}

export const reportAssistant = createReportAssistant()
let account = readUser()?.id
onAuthChange(() => {
  const next = readUser()?.id
  if (account !== next) reportAssistant.reset()
  account = next
})

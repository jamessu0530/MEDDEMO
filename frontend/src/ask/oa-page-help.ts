import type { OaField, OaFormDetail, OaTemplate } from "@/api/oa"
import type { AskPageContext, PageDetails } from "@/ask/page-context"
import { OA_STATUS_LABEL } from "@/lib/approval"
import { oaMissing } from "@/lib/oa-legacy"

/** 共用助理只帶入已載入的欄位名稱與缺漏，不夾帶銀行、電話或憑證等填寫內容。 */
export function oaEditorContext(
  template: OaTemplate,
  common: OaField[],
  fields: Record<string, string>,
  purpose: string,
  customerId: string
): PageDetails {
  const missing = oaMissing(template, common, fields, purpose, customerId)
  return {
    title: `${template.title} · 填寫`,
    facts: [
      `表單名稱：${template.title}`,
      `缺少必填資料：${missing.join("、") || "無"}`,
      `必填欄位：${[...common, ...template.fields]
        .filter((f) => f.required)
        .map((f) => f.label)
        .join("、")}、申請目的／說明`,
      `SAP 起單限制：${template.sap_origin ? "PR／PO 須由 SAP 起單，此處可先整理申請資料" : "此表單可儲存草稿與送主管簽核"}`,
      "簽核流程：申請人 → 直屬主管；缺件可先存草稿，核對後自行送出。",
    ],
    suggestions: [
      "這張表單還缺什麼資料？",
      "這張表單怎麼預填？",
      "怎麼儲存草稿和送簽？",
    ],
  }
}

export function oaFormContext(form: OaFormDetail): PageDetails {
  return {
    title: `${form.kind_label} · 申請明細`,
    facts: [
      `表單名稱：${form.kind_label}`,
      `申請文號：${form.form_no}`,
      `申請狀態：${OA_STATUS_LABEL[form.status]}`,
      `缺少必填資料：${form.missing.join("、") || "無"}`,
      `目前簽核：${
        form.steps
          .filter((step) => step.status === "pending")
          .map((step) => step.title)
          .join("、") || "目前沒有等待簽核的關卡"
      }`,
      `可編輯草稿：${form.can_edit ? "可以" : "不可以"}`,
    ],
    suggestions: [
      "這張申請現在是什麼狀態？",
      "這張表單還缺什麼資料？",
      "退回的表單怎麼補件？",
    ],
  }
}

/** 已知介面操作與缺件直接依當下畫面回答；公司規定、金額及檔案仍交給原本的 AI 查詢。 */
export function oaPageHelp(
  question: string,
  page?: AskPageContext
): string | null {
  if (!page || !/^\/oa(?:\/|$)/.test(page.path)) return null
  const q = question.replace(/[\s？?！!。，,]/g, "")
  const fact = (prefix: string) =>
    page.facts.find((line) => line.startsWith(prefix))?.slice(prefix.length)
  if (
    /^(?:這張(?:表單|申請單|申請)?|目前表單|我)?還?缺(?:什麼|哪些)(?:資料|欄位|必填資料|必填欄位)?$/.test(
      q
    )
  ) {
    const missing = fact("缺少必填資料：")
    if (!missing)
      return "先開啟要填寫的表單，載入後就能依目前畫面列出尚缺的欄位。"
    return missing === "無"
      ? "依目前畫面，必填資料已填齊。請再核對金額、日期與申請內容，並確認已備妥附件。"
      : `依目前畫面，還缺：${missing}。可以先儲存草稿，補齊後再由你送出申請。`
  }
  if (/^這張申請現在是什麼狀態$/.test(q)) {
    const status = fact("申請狀態：")
    return status
      ? `目前是「${status}」。${fact("目前簽核：") || ""}${status === "已退回" ? (fact("可編輯草稿：") === "可以" ? "，可按「補件後重新送出」修改。" : "，請申請人補件後重新送出。") : "。"}`
      : "申請明細載入後，才能確認這張單目前的狀態。"
  }
  if (/^(?:這張表單|OA表單)?怎麼預填$/.test(q))
    return "在表單的「助理幫你填」貼上申請內容，再按「依內容預填空白欄位」。可用「欄位名稱：值」輸入；預填只補空白，保留你已修改的內容。也能按「帶入帳號資料」補入已有資料；未提供的欄位會保留空白。核對後再儲存或送簽。"
  if (/^怎麼儲存草稿和送簽$/.test(q))
    return "手機底部有「儲存草稿」和「送出申請」。缺件時可先存草稿；點缺件提示查看要補的欄位，補齊並核對後再按送出。送出後由直屬主管簽核。"
  if (/^退回的表單怎麼補件$/.test(q))
    return "在「我的申請單」選「已退回」，打開自己的申請後按「補件後重新送出」。核對主管意見、補齊資料再送簽，原有意見和活動日誌會保留。"
  if (/^怎麼查詢我的申請進度$/.test(q))
    return "打開「我的申請單」，依草稿、審核中、已退回、已駁回或已批准篩選。手機可展開「搜尋與篩選」找表單，點進明細查看簽核流程、意見與活動日誌。"
  if (/^怎麼建立OA表單$/.test(q))
    return "到「我的應用」搜尋表單名稱或代碼，按「建立表單」，帶入資料、核對缺件後儲存草稿或送簽。費用報銷清單是查詢入口；正式 PR／PO 須由 SAP 起單。"
  if (/^有哪些OA表單可以用$/.test(q))
    return "表單中心有財務與帳款、採購與供應商、業務與行銷、報廢與資產四類，共 21 個入口。可以搜尋名稱或代碼；其中 20 種可填寫，費用報銷清單用來查詢。"
  if (/^請業務提供哪些資料$/.test(q))
    return "請業務提供完整空白表單與填寫範例、公司與人員代碼、角色權限、簽核順序與門檻、附件規範，以及 OA／SSO 和 SAP PR／PO 測試介面。表單中心下方可按「複製給業務」取得清單。"
  return null
}

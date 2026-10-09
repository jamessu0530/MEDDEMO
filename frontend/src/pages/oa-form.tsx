import { useParams } from "react-router"

import { OaFormView } from "@/components/oa-form-view"
import { PageHeader } from "@/components/page-header"
import { canManage, useAuth } from "@/lib/auth"

/** 一張申請單單獨一頁：業務看自己的申請單、手機的主管端點進來；電腦版的主管端在右欄打開同樣的內容 */
export function OaFormPage() {
  const { formId } = useParams()
  const user = useAuth()?.user
  const backTo = user && canManage(user.role) ? "/manager?view=oa" : "/oa/forms"
  return (
    <div className="flex min-h-svh flex-col">
      <OaFormView
        id={Number(formId)}
        backTo={backTo}
        header={(form) => <PageHeader title={form?.kind_label ?? "申請單"} subtitle={form?.form_no} backTo={backTo} />}
      />
    </div>
  )
}

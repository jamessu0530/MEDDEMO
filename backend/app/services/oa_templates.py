"""依使用者提供的 OA 入口截圖建的模擬欄位；未取得原表單與正式簽核規則。"""

from __future__ import annotations

from typing import Any


def field(key: str, label: str, sample: str, kind: str = "text", *, required: bool = True) -> dict[str, Any]:
    return {"key": key, "label": label, "type": kind, "required": required, "sample": sample}


def template(code: str, title: str, category: str, description: str, fields: list[dict], *, customer: bool = False, sap: bool = False, query: bool = False) -> dict:
    return {
        "code": code, "title": title, "category": category, "description": description,
        "display_code": code.split("-")[0] if code.startswith(("6005-", "A042-")) else code if code.isdecimal() else "",
        "needs_customer": customer, "sap_origin": sap, "query_only": query,
        "fields": fields,
        "sample_purpose": "",
    }


TEMPLATES = [
    template("6071", "供應商建立請求（裕民）", "採購與供應商", "申請建立供應商公司代碼資料", [
        field("supplier", "供應商名稱", ""), field("tax_id", "統一編號", ""),
        field("contact", "聯絡人", ""), field("phone", "聯絡電話", ""),
        field("payment_terms", "付款條件", ""), field("bank_reference", "銀行資料／附件說明", ""),
    ]),
    template("6099", "領取票據申請書（裕民）", "財務與帳款", "客戶申請退回票據", [
        field("bill_no", "票據號碼", ""), field("amount", "票面金額", "", "number"),
        field("due_date", "票據到期日", "", "date"), field("recipient", "領取人", ""),
    ], customer=True),
    template("6014", "業務員專案申請單", "業務與行銷", "業務專案與活動申請", [
        field("project_name", "專案名稱", ""), field("start_date", "開始日期", "", "date"),
        field("end_date", "結束日期", "", "date"), field("amount", "申請預算", "", "number"),
        field("expected_result", "預期效益", ""),
    ]),
    template("6062", "暫收放行（裕民）", "財務與帳款", "未沖帳或未知款項的暫收放行申請", [
        field("order_no", "訂單編號", ""), field("amount", "暫收金額", "", "number"),
        field("receipt_date", "收款日期", "", "date"), field("reconcile_date", "預計沖帳日", "", "date"),
    ], customer=True),
    template("6061", "交易／倒帳報告系統（裕民）", "財務與帳款", "客戶交易與倒帳異常申請", [
        field("issue_type", "異常類型", ""), field("amount", "異常金額", "", "number"),
        field("occurred_date", "發生日期", "", "date"), field("action_plan", "處理計畫", "", "textarea"),
    ], customer=True),
    template("6064", "裕民採購資訊紀錄", "採購與供應商", "由 PM 提出物料採購價格新增或更新", [
        field("material", "物料編號／名稱", ""), field("supplier", "供應商名稱", ""),
        field("unit_price", "採購單價", "", "number"), field("effective_date", "生效日期", "", "date"),
    ]),
    template("1037", "成品報廢申請單", "報廢與資產", "成品報廢（中化、裕民、生醫）", [
        field("material", "品號／品名", ""), field("batch", "批號", ""),
        field("quantity", "報廢數量", "", "number"), field("warehouse", "庫別", ""),
        field("disposal_reason", "報廢原因", ""),
    ]),
    template("6005-loan", "暫借款（裕民）", "財務與帳款", "交際費等暫借款申請", [
        field("amount", "暫借金額", "", "number"), field("needed_date", "需款日期", "", "date"),
        field("settlement_date", "預計核銷日", "", "date"), field("expense_type", "費用類型", ""),
    ]),
    template("A042-pr", "CENRA ERP PR 請購表單", "採購與供應商", "PR 須由 SAP 起單，可先整理申請資料", [
        field("sap_no", "SAP 請購單號", ""), field("material", "請購品項", ""),
        field("quantity", "請購數量", "", "number"), field("amount", "預估金額", "", "number"),
        field("needed_date", "需求日期", "", "date"),
    ], sap=True),
    template("A042-po", "CENRA ERP PO 採購表單", "採購與供應商", "PO 須由 SAP 起單，可先整理申請資料", [
        field("sap_no", "SAP 採購單號", ""), field("supplier", "供應商名稱", ""),
        field("material", "採購品項", ""), field("quantity", "採購數量", "", "number"),
        field("amount", "採購金額", "", "number"),
    ], sap=True),
    template("6005-deposit", "保證金（裕民）", "財務與帳款", "保證金申請", [
        field("amount", "保證金金額", "", "number"), field("recipient", "受款對象", ""),
        field("needed_date", "付款日期", "", "date"), field("refund_date", "預計退還日", "", "date"),
    ]),
    template("material-scrap", "原材料半製品報廢", "報廢與資產", "原材料與半製品報廢申請", [
        field("material", "物料編號／名稱", ""), field("batch", "批號", ""),
        field("quantity", "報廢數量", "", "number"), field("unit", "數量單位", ""),
        field("disposal_reason", "報廢原因", ""),
    ]),
    template("A042-asset-add", "固定資產增加", "報廢與資產", "固定資產新增登錄", [
        field("asset", "資產名稱", ""), field("amount", "取得金額", "", "number"),
        field("acquired_date", "取得日期", "", "date"), field("custodian", "保管人", ""),
        field("location", "放置地點", ""),
    ]),
    template("A042-asset-transfer", "固定資產移轉", "報廢與資產", "固定資產跨單位或保管人移轉", [
        field("asset_no", "資產編號", ""), field("from_unit", "原保管單位", ""),
        field("to_unit", "新保管單位", ""), field("custodian", "新保管人", ""),
        field("transfer_date", "移轉日期", "", "date"),
    ]),
    template("A042-asset-loss", "固定資產減損", "報廢與資產", "固定資產減損申請", [
        field("asset_no", "資產編號", ""), field("book_value", "帳面價值", "", "number"),
        field("amount", "減損金額", "", "number"), field("assessment", "減損評估依據", "", "textarea"),
    ]),
    template("expense", "費用報銷申請單", "財務與帳款", "業務費用與小額支出核銷", [
        field("sales_code", "外勤代號", ""), field("expense_type", "費用類型", ""),
        field("expense_date", "費用日期", "", "date"), field("amount", "總金額", "", "number"),
        field("receipt_no", "憑證／發票號碼", ""), field("details", "費用明細", "", "textarea"),
    ]),
    template("expense-list", "費用報銷清單", "財務與帳款", "查詢已建立的費用報銷申請", [], query=True),
    template("welfare-loan", "暫借款（福委會）", "財務與帳款", "福委會活動暫借款申請", [
        field("activity_name", "活動名稱", ""), field("amount", "暫借金額", "", "number"),
        field("needed_date", "需款日期", "", "date"), field("settlement_date", "預計核銷日", "", "date"),
    ]),
    template("6119", "統一發票、收款傳票補印", "財務與帳款", "發票或收款傳票補印申請", [
        field("document_type", "補印類型", ""), field("document_no", "原單據號碼", ""),
        field("document_date", "原單據日期", "", "date"), field("copies", "補印份數", "", "number"),
    ], customer=True),
    template("business-card", "名片申請", "業務與行銷", "申請製作或補印名片", [
        field("printed_name", "名片姓名", ""), field("job_title", "職稱", ""),
        field("phone", "聯絡電話", ""), field("email", "電子信箱", ""),
        field("quantity", "申請盒數", "", "number"), field("needed_date", "需求日期", "", "date"),
    ]),
    template("6039", "行銷資源申請單_營業單", "業務與行銷", "交際用品、補送贈品等行銷資源申請", [
        field("resource_type", "種類", ""), field("material", "申請品項", ""),
        field("quantity", "申請數量", "", "number"), field("needed_date", "需求日期", "", "date"),
        field("delivery", "交付方式／地址", ""),
    ], customer=True),
]

TEMPLATE_BY_CODE = {item["code"]: item for item in TEMPLATES}
COMMON_FIELDS = [field("company", "公司", ""), field("business_unit", "事業單位／部門", "")]

# 截圖只證實入口、名稱和 PR/PO 限制，以下是提供給業務／資訊窗口的待確認項目。
BUSINESS_GAPS = [
    "每種表單的空白表、完整欄位、必填條件、下拉選項，以及一份去識別化的已填範例。",
    "公司、事業單位、員工／外勤代號、職稱與主管對照；PM、財務、福委會等申請權限。",
    "各表單的簽核順序、金額門檻、代理人、退回補件規則；目前由直屬主管簽核。",
    "發票、票據、供應商銀行資料、報廢照片等附件清單、格式與大小限制。",
    "OA／OutSystem 的 API 或測試環境、SSO、表單代碼、狀態與請求編號對照、可回寫欄位。",
    "SAP PR／PO 的起單與回傳介面、單號及欄位映射；確認既有 SAP 起單限制。",
]

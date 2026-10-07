"""客戶相關 API：客戶清單、客戶檔案（FR-2）、談判卡（FR-3）、開報價與續約申請。"""

import dataclasses
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.api.methods import MethodCardOut
from app.db import get_session
from app.models import AppUser, Customer, Product, SalesTransaction, SapQuotationDraft, Visit
from app.pricing import supply_price
from app.services import approvals, customer_profile, negotiation, writeback
from app.services.scope import SHARING_LEVEL, Scope

router = APIRouter(prefix="/api/customers", tags=["customers"])
SessionDep = Annotated[Session, Depends(get_session)]


class CustomerItem(BaseModel):
    id: str
    name: str
    type: str
    region: str
    grade: str
    # 負責業務。IT 在客戶檔案頁換負責人時，要知道現在是誰
    owner_id: str
    owner_name: str
    last_visit_date: date | None


class ProfileStats(BaseModel):
    amount_last_90d: float
    amount_prev_90d: float
    avg_order_amount_last_90d: float | None
    avg_order_amount_before: float | None
    interval_last_90d: float | None
    interval_before: float | None
    interval_alert: bool
    ar_outstanding: float
    ar_max_age_days: int | None
    last_order_date: date | None
    last_visit_date: date | None


class MonthlyInterval(BaseModel):
    month: str
    gap_days: float | None


class OpenQuote(BaseModel):
    quote_no: str
    visit_id: str | None
    date: date
    items: str
    amount: float
    # draft：可以送給客戶；pending_approval：折扣還在等簽核
    status: str


class Commitment(BaseModel):
    visit_id: str
    visit_date: date
    by: str
    text: str
    due: date | None
    overdue: bool


class Complaint(BaseModel):
    visit_id: str
    visit_date: date
    text: str


class Competitor(BaseModel):
    name: str
    mentions: int
    last_date: date
    detail: str | None


class CustomerProfile(BaseModel):
    customer: CustomerItem
    today: date
    highlights: list[str]
    stats: ProfileStats
    intervals: list[MonthlyInterval]
    open_quotes: list[OpenQuote]
    commitments: list[Commitment]
    complaints: list[Complaint]
    competitors: list[Competitor]


class Festival(BaseModel):
    name: str
    date: date
    days_left: int
    categories: list[str]
    note: str


class Campaign(BaseModel):
    festival_name: str
    festival_date: date
    apply_by: date
    days_to_apply: int
    fee_cap: float
    missed: list[str]


class ShelfItem(BaseModel):
    sku: str
    name: str
    orders_per_month: float
    region_orders_per_month: float | None


class Shelf(BaseModel):
    items: list[ShelfItem]
    scoped: bool


class Gap(BaseModel):
    sku: str
    name: str
    peers_with: int
    peers_total: int


class Margin(BaseModel):
    listing_fee_rate: float
    channel_reward_rate: float
    net_margin_rate: float
    region_net_margin_rate: float | None
    summary: str


class Tip(BaseModel):
    reason: str
    doc_title: str
    section: str
    content: str
    source_name: str


class Deal(BaseModel):
    sku: str
    name: str
    group_name: str
    deal: str
    deal_price: float
    unit_deal_price: float
    list_price: float
    unit_profit: float
    profit_rate: float
    smallest_deal_price: float


class Deals(BaseModel):
    items: list[Deal]
    scoped: bool
    promotion_name: str | None


class Terms(BaseModel):
    supply_rate: float
    channel_reward_rate: float | None
    payment_days: int
    ar_max_age_days: int | None
    free_discount_pct: float
    amount_last_90d: float
    avg_order_amount: float | None


class NegotiationCard(BaseModel):
    customer: CustomerItem
    # customer＝顧客導向（連鎖）：campaign、shelf、gaps、margin；cost＝成本導向（獨立藥局與診所）：deals、terms。
    # 不屬於這個導向的欄位是 null
    orientation: Literal["customer", "cost"]
    festival: Festival | None
    campaign: Campaign | None
    shelf: Shelf | None
    gaps: list[Gap] | None
    margin: Margin | None
    deals: Deals | None
    terms: Terms | None
    tips: list[Tip]
    # 主管教的做法：照這家的情況帶出來的方法卡，最多兩張；my_feedback 是登入者在這家客戶按過什麼
    methods: list[MethodCardOut]


def _customer_query(scope: Scope):
    """客戶清單一列的內容。上次拜訪只算已確認的紀錄；還在處理或草稿中的不算。

    清單本身是全公司共用的，但「上次拜訪」是從拜訪紀錄算出來的，拜訪紀錄在別的地方都停在
    團隊層級——同一個欄位不該因為換了一支 API 就看得更遠，所以看不到這家客戶拜訪的人拿到 NULL，
    其他欄位照常。過濾寫在 SQL 裡而不是撈回來再抹掉，日期不會先離開資料庫。
    """
    last_visit = func.max(cast(func.timezone("Asia/Taipei", Visit.visited_at), Date))
    # 沒有 else，條件不成立就是 NULL
    visible_last_visit = case((scope.customers_at(SHARING_LEVEL["visit_record"]), last_visit))
    return (
        select(
            Customer.id, Customer.name, Customer.type, Customer.region, Customer.grade,
            Customer.owner_user_id.label("owner_id"), AppUser.name.label("owner_name"),
            visible_last_visit.label("last_visit_date"),
        )
        .join(AppUser, AppUser.id == Customer.owner_user_id)
        .outerjoin(Visit, (Visit.customer_id == Customer.id) & Visit.status.in_(("confirmed", "synced")))
        .group_by(Customer.id, AppUser.name)
        .order_by(Customer.id)
    )


def _load(session: Session, customer_id: str, user: AppUser, level: int) -> tuple[Customer, CustomerItem]:
    """看不到的客戶跟不存在一樣回 404，不透露這個編號是別人的客戶。

    level 是這次要求的資料屬於哪一種共享層級，由呼叫端從 SHARING_LEVEL 取（services/scope.py）：
    客戶本身全公司共用，檔案、議價卡與報價是負責人自己的。
    """
    scope = Scope.for_user(user)
    row = session.execute(
        _customer_query(scope).where(Customer.id == customer_id, scope.customers_at(level))
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "找不到這家客戶")
    return session.get(Customer, customer_id), CustomerItem(**row._mapping)


@router.get("", response_model=list[CustomerItem])
def list_customers(session: SessionDep, user: CurrentUser, q: str | None = None):
    """業務開始口述前先選客戶；q 以客戶名稱做部分比對。客戶清單全國共享（services/scope.py）。"""
    scope = Scope.for_user(user)
    stmt = _customer_query(scope).where(scope.customers_at(SHARING_LEVEL["customer_basic"]))
    if q:
        stmt = stmt.where(Customer.name.contains(q, autoescape=True))
    return [CustomerItem(**row._mapping) for row in session.execute(stmt)]


@router.get("/{customer_id}", response_model=CustomerItem)
def get_customer(session: SessionDep, customer_id: str, user: CurrentUser):
    return _load(session, customer_id, user, SHARING_LEVEL["customer_basic"])[1]


@router.get("/{customer_id}/profile", response_model=CustomerProfile)
def get_profile(session: SessionDep, customer_id: str, user: CurrentUser):
    """客戶檔案：交易概況、待處理事項、競品紀錄放在同一頁（FR-2）。

    停在 customer_profile：內容是近 90 天進貨金額、帳齡、未結報價、承諾與客訴，是負責人自己的
    經營資料，不是客戶清單那種「這家店叫什麼名字」的共用資訊。
    """
    customer, item = _load(session, customer_id, user, SHARING_LEVEL["customer_profile"])
    profile = customer_profile.build_profile(session, customer)
    data = dataclasses.asdict(profile)
    data.pop("signals")
    return CustomerProfile(customer=item, **data)


@router.get("/{customer_id}/negotiation", response_model=NegotiationCard)
def get_negotiation_card(session: SessionDep, customer_id: str, user: CurrentUser):
    """談判卡：每種客戶都有，圍繞下一個節慶（FR-3）。連鎖是顧客導向，獨立藥局與診所是成本導向。

    數字來自交易資料與當期促銷，節慶那一句話是設定檔裡人寫的，切入點是內部文件的原文段落，方法卡是主管寫的原文。
    """
    customer, item = _load(session, customer_id, user, SHARING_LEVEL["customer_profile"])
    profile = customer_profile.build_profile(session, customer)
    card = negotiation.negotiation_card(session, customer, profile, user)
    return NegotiationCard(customer=item, **dataclasses.asdict(card))


# ── 開報價（原型客戶檔案的「開報價」）────────────────────────────────

# 報價頁列這家客戶近半年進過的品項，跟談判卡看的時間窗一樣
QUOTE_ITEM_DAYS = customer_profile.TOP_SKU_DAYS
# 一張報價最多幾項：這家客戶常進的品項大約 10～15 項，再多多半是誤操作
MAX_QUOTE_LINES = 20


class QuoteItemOption(BaseModel):
    sku: str
    name: str
    spec: str
    unit: str
    unit_price: int
    usual_qty: int


class QuoteLineInput(BaseModel):
    sku: str
    qty: int = Field(gt=0)


# 申請理由最多幾個字：一兩句話講客戶的進貨金額與競品條件
REASON_MAX_LENGTH = 500


class QuoteInput(BaseModel):
    items: list[QuoteLineInput] = Field(min_length=1, max_length=MAX_QUOTE_LINES)
    # 整張報價一個折扣，套在標準供貨價上
    discount_pct: float = 0
    reason: str | None = Field(default=None, max_length=REASON_MAX_LENGTH)


class QuoteLine(BaseModel):
    sku: str
    name: str
    qty: int
    # 折扣後的單價，到分
    unit_price: float
    amount: float


class WaitingFor(BaseModel):
    step: str
    name: str


class Approval(BaseModel):
    """送出之後的簽核結果：系統核准了，或是現在等誰簽。"""

    form_id: int
    form_no: str
    status: str
    auto_approved: bool
    probability: float | None
    waiting_for: WaitingFor | None


class Quote(BaseModel):
    quote_no: str
    customer_id: str
    items: list[QuoteLine]
    amount: int
    discount_pct: float
    # draft：可以送給客戶；pending_approval：折扣超過業務的權限，等簽核
    status: str
    # 折扣在業務的權限內就沒有申請單
    approval: Approval | None
    created_at: datetime


@router.get("/{customer_id}/quote-items", response_model=list[QuoteItemOption])
def quote_items(session: SessionDep, customer_id: str, user: CurrentUser):
    """開報價時可以選的品項：這家客戶近半年進過的，照進貨金額排序。數量預設是平常一次進多少。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    today = customer_profile.app_today(session)
    rows = session.execute(
        select(
            Product.sku, Product.name, Product.spec, Product.unit, Product.unit_price,
            func.round(func.avg(SalesTransaction.qty)).label("usual_qty"),
        )
        .join(SalesTransaction, SalesTransaction.sku == Product.sku)
        .where(
            SalesTransaction.customer_id == customer.id,
            SalesTransaction.date > today - timedelta(days=QUOTE_ITEM_DAYS),
        )
        .group_by(Product.sku)
        .order_by(func.sum(SalesTransaction.amount).desc())
    ).all()
    return [
        QuoteItemOption(
            sku=r.sku, name=r.name, spec=r.spec, unit=r.unit,
            unit_price=supply_price(r.unit_price, customer.type), usual_qty=int(r.usual_qty or 1),
        )
        for r in rows
    ]


def _next_quote_no(session: Session, today: date) -> str:
    prefix = f"Q{today:%Y%m%d}-"
    count = session.scalar(
        select(func.count(func.distinct(SapQuotationDraft.quote_no))).where(SapQuotationDraft.quote_no.like(f"{prefix}%"))
    )
    return f"{prefix}{(count or 0) + 1:04d}"


def _oa_must_be_up(what: str) -> None:
    """要開申請單的動作受模擬 OA 的開關影響：OA 停機時整件事都不做，不留下一張送不出去的報價。"""
    if writeback.is_mock_down("oa"):
        raise HTTPException(503, f"OA 暫時連不上，{what}，請稍後再試")


def _discount_level(body: QuoteInput) -> tuple[str | None, str]:
    """檢查折扣與理由，回傳（最高要簽到哪一級, 整理過的理由）。"""
    pct = body.discount_pct
    if not 0 <= pct <= approvals.DISCOUNT_MAX:
        raise HTTPException(422, f"折扣要在 0～{approvals.DISCOUNT_MAX:g}% 之間")
    if (pct / approvals.DISCOUNT_STEP) % 1:
        raise HTTPException(422, f"折扣每 {approvals.DISCOUNT_STEP:g}% 一格")
    reason = (body.reason or "").strip()
    level = approvals.discount_level(pct)
    if level and not reason:
        raise HTTPException(422, f"折扣超過 {approvals.DISCOUNT_FREE:g}% 要送簽核，請寫申請理由")
    return level, reason


@router.post("/{customer_id}/quotes", status_code=201, response_model=Quote)
def create_quote(session: SessionDep, customer_id: str, body: QuoteInput, user: CurrentUser):
    """在客戶檔案直接開 SAP 報價草稿，不必先有一次拜訪。

    折扣在業務的權限（3%）內就直接開；超過的報價先停在等簽核，同一個交易裡開優惠申請單，
    模型有把握就由系統核准、報價立刻可以送出（services/approvals.py）。
    """
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    skus = [line.sku for line in body.items]
    if len(set(skus)) != len(skus):
        raise HTTPException(422, "同一個品項只能列一次")
    products = {p.sku: p for p in session.scalars(select(Product).where(Product.sku.in_(skus)))}
    if missing := [sku for sku in skus if sku not in products]:
        raise HTTPException(422, f"找不到品項：{'、'.join(missing)}")
    level, reason = _discount_level(body)
    # 跟拜訪回寫一樣受模擬系統開關影響：展示「SAP 停機」時這裡也開不成
    if writeback.is_mock_down("sap"):
        raise HTTPException(503, "SAP 暫時連不上，報價草稿沒有開成，請稍後再試")
    if level:
        _oa_must_be_up("這個折扣要送簽核，報價沒有開成")

    today = customer_profile.app_today(session)
    # 折扣每 0.5% 一格，用整數算才不會有浮點數的尾差：405 元打 97 折是 392.85
    keep = Decimal(200 - round(body.discount_pct * 2)) / 200
    supply = {sku: supply_price(products[sku].unit_price, customer.type) for sku in skus}
    prices = {sku: (Decimal(price) * keep).quantize(Decimal("0.01"), ROUND_HALF_UP) for sku, price in supply.items()}
    # 整張報價的金額到元，四捨五入（跟畫面上金額的進位方式一樣）
    amount = int(sum(prices[line.sku] * line.qty for line in body.items).quantize(Decimal("1"), ROUND_HALF_UP))
    form = None
    for _attempt in range(3):  # 兩個人同時開報價可能拿到同一個單號，撞到唯一限制就換下一號
        quote_no = _next_quote_no(session, today)
        lines = [
            SapQuotationDraft(
                quote_no=quote_no, visit_id=None, created_by=user.id, line_no=n, customer_id=customer.id,
                sku=line.sku, qty=line.qty, unit_price=prices[line.sku], amount=prices[line.sku] * line.qty,
                discount_pct=body.discount_pct, status="pending_approval" if level else "draft",
            )
            for n, line in enumerate(body.items, start=1)
        ]
        session.add_all(lines)
        try:
            session.flush()
            if level:
                form = approvals.submit(
                    session, kind="discount", customer=customer,
                    # 申請人記客戶的負責人，跟出差單一樣：自建帳號、主管代開的單都在負責人的申請匣裡
                    applicant=session.get(AppUser, customer.owner_user_id),
                    payload={
                        "quote_no": quote_no, "discount_pct": body.discount_pct,
                        "list_amount": sum(supply[line.sku] * line.qty for line in body.items), "amount": amount,
                        "cost": round(sum(products[line.sku].unit_cost * line.qty for line in body.items)),
                        "reason": reason,
                    },
                )
            session.commit()
            break
        except IntegrityError:
            session.rollback()
    else:
        raise HTTPException(409, "報價單號衝突，請再送一次")

    items = [
        QuoteLine(
            sku=l.sku, name=products[l.sku].name, qty=l.qty, unit_price=float(l.unit_price), amount=float(l.amount),
        )
        for l in lines
    ]
    return Quote(
        quote_no=quote_no, customer_id=customer.id, items=items, amount=amount, discount_pct=body.discount_pct,
        # 系統核准的話，報價在同一個交易裡已經變成可以送出
        status=lines[0].status, approval=approvals.approval_out(session, form) if form else None,
        created_at=lines[0].created_at,
    )


# ── 連鎖續約（合約申請單）────────────────────────────────────────

# 費率的合理範圍：內部文件寫上架費 5%～8%、通路獎勵 3%～5%，這裡收到 20% 為止，擋掉把 8 打成 80 這種誤填
CONTRACT_RATE_MAX = 0.2


class Contract(BaseModel):
    contract_end_date: date | None
    days_left: int | None
    # 到期前 3 個月要啟動續約協商（《連鎖通路合約條件》），客戶檔案頁把這一列標出來
    ending_soon: bool
    listing_fee_rate: float
    channel_reward_rate: float
    # 還沒簽完的續約申請；同一家客戶同時只能有一張
    pending_form_id: int | None
    # 現在能不能送續約申請：要在到期前 3 個月內（或已經過期），而且沒有還沒簽完的申請
    can_request: bool
    # 離到期還太久時的說明；其他情況是 null
    blocked_reason: str | None


class ContractRequestInput(BaseModel):
    term_months: Literal[12, 24]
    listing_fee_rate: float = Field(ge=0, le=CONTRACT_RATE_MAX)
    channel_reward_rate: float = Field(ge=0, le=CONTRACT_RATE_MAX)
    reason: str = Field(default="", max_length=REASON_MAX_LENGTH)


def _load_chain(session: Session, customer_id: str, user: AppUser) -> Customer:
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    if customer.type != "chain":
        raise HTTPException(409, "只有連鎖客戶有通路合約")
    return customer


def _contract(session: Session, customer: Customer) -> dict[str, Any]:
    today = customer_profile.app_today(session)
    terms = approvals.contract_terms(session, customer, today)
    days_left = terms["days_left"]
    pending = approvals.pending_contract(session, customer.id)
    blocked = approvals.renewal_block(customer, today)
    return terms | {
        "ending_soon": days_left is not None and days_left <= customer_profile.CONTRACT_NOTICE_DAYS,
        "pending_form_id": pending,
        "can_request": pending is None and blocked is None,
        "blocked_reason": blocked,
    }


@router.get("/{customer_id}/contract", response_model=Contract)
def get_contract(session: SessionDep, customer_id: str, user: CurrentUser):
    """目前的合約條件。系統沒有合約表：到期日在客戶主檔，費率從近 90 天的交易算出來。"""
    return _contract(session, _load_chain(session, customer_id, user))


@router.post("/{customer_id}/contract-requests", status_code=201, response_model=Approval)
def create_contract_request(session: SessionDep, customer_id: str, body: ContractRequestInput, user: CurrentUser):
    """送續約申請：照原費率由區處主管核准（模型有把握就由系統核准），費率有調整要再送業務處長。"""
    customer = _load_chain(session, customer_id, user)
    if approvals.pending_contract(session, customer.id):
        raise HTTPException(409, "這家客戶已經有一張還沒簽完的續約申請")
    today = customer_profile.app_today(session)
    if blocked := approvals.renewal_block(customer, today):
        raise HTTPException(409, blocked)
    reason = body.reason.strip()
    payload = approvals.contract_payload(
        session, customer, today, term_months=body.term_months,
        # 費率到 0.1 個百分點，跟帶出來的目前費率同一個精度，沒改的才比得出「沒改」
        listing_fee_rate=round(body.listing_fee_rate, 3), channel_reward_rate=round(body.channel_reward_rate, 3),
        reason=reason,
    )
    listing, reward = payload["listing_fee_rate"], payload["channel_reward_rate"]
    changed = approvals.contract_level(listing["from"], listing["to"], reward["from"], reward["to"]) != "manager"
    if changed and not reason:
        raise HTTPException(422, "費率有調整要送業務處長，請寫申請理由")
    _oa_must_be_up("續約申請沒有送出")
    form = approvals.submit(
        session, kind="contract", customer=customer, applicant=session.get(AppUser, customer.owner_user_id), payload=payload,
    )
    session.commit()
    return approvals.approval_out(session, form)

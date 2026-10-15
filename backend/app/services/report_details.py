"""在相同報表範圍與權限下讀取原始資料列；CSV 不受圖表排行或分頁截斷。"""

from __future__ import annotations

import csv
import datetime as dt
import io
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Product, Receivable, SalesTransaction, Visit
from app.services import reports
from app.services.scope import Scope


class DetailsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: reports.ReportQuery
    card_id: str = Field(min_length=1, max_length=48, pattern=reports.SLUG_PATTERN)
    point: reports.ReportSelectionPoint | None = None
    selection_scope: Literal["chart", "selected"] = "chart"
    page: int = Field(default=1, ge=1, le=1000000, strict=True)
    page_size: int = Field(default=25, ge=1, le=100, strict=True)
    sort_by: Literal["date", "amount", "net_margin", "customer", "product", "owner", "order", "due_date"] = "date"
    sort_direction: Literal["asc", "desc"] = "desc"

    @model_validator(mode="after")
    def valid_source(self) -> Self:
        card = next((item for item in self.config.cards if item.id == self.card_id), None)
        if card is None:
            raise ValueError("明細來源需為目前報表中的圖表")
        if self.point:
            if not reports.valid_point_for_card(card, self.point):
                raise ValueError("明細條件需對應來源圖的主分組與圖例")
        return self


class DetailsColumn(BaseModel):
    key: str
    label: str
    kind: Literal["text", "date", "datetime", "currency", "number"] = "text"
    sort_key: str | None = None


class DetailsRow(BaseModel):
    id: str
    values: dict[str, str | float | int | None]


class ReportDetails(BaseModel):
    card_id: str
    title: str
    as_of: dt.date
    start: dt.date
    end: dt.date
    metric: reports.Metric
    total: float | None
    total_rows: int
    page: int
    page_size: int
    columns: list[DetailsColumn]
    rows: list[DetailsRow]
    note: str


class DetailSortNotAllowed(ValueError):
    pass


def _col(key, label, kind="text", sort_key=None):
    return DetailsColumn(key=key, label=label, kind=kind, sort_key=sort_key)


def _query(session: Session, user: AppUser, body: DetailsInput):
    config = body.config
    card = next(item for item in config.cards if item.id == body.card_id)
    if body.point and body.point.metric:
        card = card.model_copy(update={"metric": body.point.metric})
    point_filters = body.point.filters if body.point else []
    reports.validate_owner(session, user, config, {item.key for item in point_filters if item.dimension == "owner"})
    today = reports.app_today(session)
    start, end = reports.period_bounds(config.period, today, config.date_range)
    start, end = reports.card_bounds(card, config, start, end, point_filters)
    # 醒目提示可在完整範圍與聯動子集之間切換；單圖不受影響模式保留其語意。
    if card.interaction == "highlight":
        if body.selection_scope == "chart":
            config = config.model_copy(update={"selection_groups": []})
        card = card.model_copy(update={"interaction": "filter"})
    query, aggregate, _, owner_col, _, ignored = reports._base_query(
        card, config, Scope.for_user(user), start, end, today, point_filters)
    total = reports._number(session.scalar(query.with_only_columns(aggregate)))
    count = int(session.scalar(query.with_only_columns(func.count())) or 0)
    query = query.join(AppUser, AppUser.id == owner_col)
    customer_columns = [Customer.id.label("customer_id"), Customer.name.label("customer"), AppUser.name.label("owner")]
    columns = [_col("customer", "客戶", sort_key="customer"), _col("owner", "目前負責業務", sort_key="owner")]
    sort = {"customer": Customer.name, "owner": AppUser.name}
    if card.metric in reports.SALES_METRICS:
        margin = SalesTransaction.amount - SalesTransaction.cost - SalesTransaction.listing_fee - SalesTransaction.channel_reward
        query = query.join(Product, Product.sku == SalesTransaction.sku)
        fields = [SalesTransaction.id.label("_id"), SalesTransaction.order_no.label("order"), SalesTransaction.date.label("date"),
            *customer_columns, Product.sku.label("sku"), Product.name.label("product"), SalesTransaction.qty.label("quantity"),
            SalesTransaction.amount.label("amount"), SalesTransaction.cost.label("cost"), SalesTransaction.listing_fee.label("listing_fee"),
            SalesTransaction.channel_reward.label("channel_reward"), margin.label("net_margin")]
        columns = [_col("order", "訂單編號", sort_key="order"), _col("date", "交易日期", "date", "date"), *columns,
            _col("sku", "商品編號"), _col("product", "商品", sort_key="product"), _col("quantity", "數量", "number"),
            _col("amount", "業績（元）", "currency", "amount"), _col("cost", "成本（元）", "currency"),
            _col("listing_fee", "上架費（元）", "currency"), _col("channel_reward", "通路獎勵（元）", "currency"),
            _col("net_margin", "淨毛利（元）", "currency", "net_margin")]
        sort.update(date=SalesTransaction.date, amount=SalesTransaction.amount, net_margin=margin,
            product=Product.name, order=SalesTransaction.order_no)
        identity = SalesTransaction.id
        note = "一列是一個訂單品項；淨毛利＝業績－成本－上架費－通路獎勵。業務依目前客戶負責人顯示。"
        if card.metric == "order_count":
            note += " 訂單數以客戶及訂單編號去重，與品項筆數不同。"
        elif card.metric == "avg_order_value":
            note += " 平均客單價以此範圍品項業績加總除以去重訂單數；不平均各筆金額。"
        elif card.metric == "net_margin_rate":
            note += " 淨毛利率以此範圍淨毛利加總除以業績加總；分母為零時無法計算。"
    elif card.metric == "visits":
        fields = [Visit.id.label("_id"), Visit.visited_at.label("date"), *customer_columns,
            case({"confirmed": "已確認", "synced": "已同步"}, value=Visit.status, else_=Visit.status).label("status")]
        columns = [_col("date", "實際拜訪時間（台北）", "datetime", "date"), _col("customer", "客戶", sort_key="customer"),
            _col("owner", "實際拜訪人員", sort_key="owner"), _col("status", "狀態")]
        sort.update(date=Visit.visited_at)
        identity = Visit.id
        note = "只包含已確認或已同步的拜訪，依實際拜訪人員與台北日界線篩選，不包含錄音或逐字稿。"
    elif card.metric == "overdue":
        fields = [Receivable.invoice_no.label("_id"), Receivable.invoice_no.label("order"), Receivable.invoice_date.label("date"),
            *customer_columns, Receivable.due_date.label("due_date"), Receivable.amount.label("amount"),
            (today - Receivable.due_date).label("overdue_days")]
        columns = [_col("order", "發票編號", sort_key="order"), _col("date", "發票日期", "date", "date"),
            *columns, _col("due_date", "到期日", "date", "due_date"), _col("overdue_days", "逾期天數", "number"),
            _col("amount", "未付款金額（元）", "currency", "amount")]
        sort.update(date=Receivable.invoice_date, amount=Receivable.amount, due_date=Receivable.due_date, order=Receivable.invoice_no)
        identity = Receivable.invoice_no
        note = "截至報表基準日已到期且未付款的應收快照，包含所選期間之前的發票，不依期間產生歷史。"
    else:
        fields = [Customer.id.label("_id"), *customer_columns,
            case(reports.TYPE_LABELS, value=Customer.type, else_=Customer.type).label("customer_type"),
            Customer.city.label("city"), Customer.area.label("area"), Customer.grade.label("grade")]
        columns = [_col("customer_id", "客戶編號"), *columns, _col("customer_type", "客戶類型"),
            _col("city", "縣市"), _col("area", "行政區"), _col("grade", "等級")]
        identity = Customer.id
        # 客戶快照沒有日期；初始排序採名稱，明確拒絕其他不存在的欄位。
        if body.sort_by == "date":
            sort["date"] = Customer.name
        note = "目前負責的客戶清單快照，不依日期產生歷史。"
    if card.metric not in ("customers", "overdue") and start > end:
        note += " 日期條件沒有交集，沒有符合條件的資料。"
    if ignored:
        labels = {"year": "年份", "quarter": "季度", "month": "月份", "product": "商品"}
        note += " 此來源沒有對應的" + "、".join(labels.get(item, item) for item in sorted(ignored)) + "資料，相關條件未套用。"
    if body.sort_by not in sort:
        raise DetailSortNotAllowed("這份明細不支援此排序欄位，請選擇表格提供的欄位。")
    order = sort[body.sort_by].desc() if body.sort_direction == "desc" else sort[body.sort_by].asc()
    rows_query = query.with_only_columns(*fields).order_by(order, identity.asc())
    return card, today, start, end, total, count, columns, rows_query, note


def details(session: Session, user: AppUser, body: DetailsInput) -> ReportDetails:
    card, today, start, end, total, count, columns, query, note = _query(session, user, body)
    records = session.execute(query.offset((body.page - 1) * body.page_size).limit(body.page_size)).mappings()
    rows = []
    for record in records:
        values = {}
        for key, value in record.items():
            if key == "_id":
                continue
            if isinstance(value, dt.datetime):
                value = value.astimezone(reports.TAIPEI).isoformat()
            elif isinstance(value, dt.date):
                value = value.isoformat()
            elif isinstance(value, Decimal):
                value = float(value)
            values[key] = value
        rows.append(DetailsRow(id=str(record["_id"]), values=values))
    return ReportDetails(card_id=card.id, title=card.title, as_of=today, start=start, end=end, metric=card.metric,
        total=total, total_rows=count, page=body.page, page_size=body.page_size, columns=columns, rows=rows, note=note)


def export_csv(session: Session, user: AppUser, body: DetailsInput) -> str:
    _, _, _, _, _, _, columns, query, _ = _query(session, user, body)
    output = io.StringIO(newline="")
    output.write("\ufeff")
    writer = csv.writer(output)
    def cell(value):
        if isinstance(value, dt.datetime):
            return value.astimezone(reports.TAIPEI).isoformat()
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value
        return value if value is not None else ""
    writer.writerow([column.label for column in columns])
    for record in session.execute(query.execution_options(yield_per=1000)).mappings():
        writer.writerow([cell(record.get(column.key)) for column in columns])
    return output.getvalue()

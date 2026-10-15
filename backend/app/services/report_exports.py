"""完整資料匯出：同一套權限／篩選，不沿用視覺前 N 筆、其他系列或矩陣分頁。"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
from dataclasses import dataclass
from decimal import Decimal
from tempfile import SpooledTemporaryFile
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import AppUser
from app.services import report_details, report_matrix, reports as r
from app.services.scope import Scope

METRICS = {"sales": "業績（元）", "net_margin": "淨毛利（元）", "net_margin_rate": "淨毛利率（比例）", "order_count": "訂單數（張）", "avg_order_value": "平均客單價（元）", "visits": "已確認拜訪（次）", "overdue": "逾期帳款（元）", "customers": "客戶數（家）"}
DIMENSIONS = {"year": "年份", "quarter": "季度", "month": "月份", "customer": "客戶", "product": "商品", "owner": "業務", "customer_type": "客戶類型"}
STATUS = {"ok": "可比較", "no_previous_data": "上期無資料", "previous_zero": "上期為零", "previous_undefined": "上期無法計算", "negative_baseline": "上期為負值", "current_undefined": "本期無法計算", "date_out_of_range": "比較日期超出範圍"}
META_COLUMNS = [("_record", "資料類型"), ("_report", "報表"), ("_page", "分頁"), ("_card", "圖表編號"), ("_title", "圖表"), ("_scope", "資料範圍"), ("_as_of", "資料基準日"), ("_start", "本期起日"), ("_end", "本期迄日"), ("_conditions", "範圍與條件")]


class ExportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config: r.ReportQuery
    format: Literal["csv", "xlsx", "pdf"]
    data: Literal["summary", "details"] = "summary"
    page_id: str | None = Field(default=None, max_length=48, pattern=r.SLUG_PATTERN)
    card_id: str | None = Field(default=None, max_length=48, pattern=r.SLUG_PATTERN)
    selection_scope: Literal["chart", "selected"] = "chart"
    point: r.ReportSelectionPoint | None = None
    sort_by: Literal["date", "amount", "net_margin", "customer", "product", "owner", "order", "due_date"] = "date"
    sort_direction: Literal["asc", "desc"] = "desc"

    @model_validator(mode="after")
    def valid_export(self) -> Self:
        if self.page_id and self.card_id:
            raise ValueError("請選擇分頁或單一圖表，不要同時指定")
        if self.page_id and not any(page.id == self.page_id for page in self.config.pages):
            raise ValueError("匯出分頁不存在")
        if self.card_id and not any(card.id == self.card_id for card in self.config.cards):
            raise ValueError("匯出圖表不存在")
        if self.format == "pdf" and (self.data != "summary" or self.page_id or self.card_id):
            raise ValueError("PDF 匯出整份報表的完整彙總")
        if self.point:
            if self.data != "details" or not self.card_id:
                raise ValueError("資料點只適用單圖實際明細匯出")
            report_details.DetailsInput(config=self.config, card_id=self.card_id, point=self.point)
        return self


@dataclass
class ExportTable:
    card: r.ReportCard
    page: r.ReportPage
    columns: list[tuple[str, str, str]]
    records: Any
    total: float | None
    count: int
    start: dt.date
    end: dt.date
    as_of: dt.date
    scope: str
    conditions: dict
    note: str
    metrics: list[str]


def safe_cell(value):
    if isinstance(value, dt.datetime):
        return value.astimezone(r.TAIPEI).isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value if value is not None else ""


def _effective(card: r.ReportCard, body: ExportInput):
    config = body.config
    if card.interaction == "highlight":
        if body.selection_scope == "chart":
            config = config.model_copy(update={"selection_groups": []})
        card = card.model_copy(update={"interaction": "filter"})
    return card, config


def _group_rows(session, card, config, scope, start, end, today, rows, columns, metrics, offset=0):
    first, last = r.comparison_bounds(start, end, offset) if offset else (start, end)
    query, primary, date, owner, _, ignored = r._base_query(card, config, scope, first, last, today, calendar_offset=offset)
    dimensions = rows + columns
    keys, labels = [], []
    for dimension in dimensions:
        query, key, label = r._dimension_query(query, dimension, date, owner)
        keys.append(key); labels.append(label)
    aggregates = [r._metric_aggregate(metric) if metric in r.SALES_METRICS else primary for metric in metrics]
    if not dimensions:
        record = session.execute(query.with_only_columns(*aggregates, func.count())).one()
        return { ((), ()): {"row_path": [], "column_path": [], "values": {metric: r._number(record[index]) for index, metric in enumerate(metrics)}, "row_count": int(record[-1])} }, ignored
    row_size = len(rows)
    subsets = [[*range(a), *range(row_size, row_size + b)] for a in range(row_size + 1) for b in range(len(columns) + 1)]
    grouped = report_matrix._grouped(query, keys, labels, aggregates, subsets)
    result = {}
    size = len(dimensions)
    for record in session.execute(grouped.execution_options(yield_per=1000)):
        flags = record[size * 2:size * 3]
        paths = [[], []]
        for index, dimension in enumerate(dimensions):
            if flags[index] == 0:
                key = str(record[index])
                paths[0 if index < row_size else 1].append({"dimension": dimension, "key": key, "label": r._point_label(dimension, key, str(record[size + index]))})
        token = tuple(item["key"] for item in paths[0]), tuple(item["key"] for item in paths[1])
        result[token] = {"row_path": paths[0], "column_path": paths[1], "values": {metric: r._number(record[size * 3 + index]) for index, metric in enumerate(metrics)}, "row_count": int(record[-1])}
    result.setdefault(((), ()), {"row_path": [], "column_path": [], "values": {metric: r.empty_metric_value(metric) for metric in metrics}, "row_count": 0})
    # 日期主軸保留日曆空桶；不把沒有資料的客戶／商品配對捏造成實際分組。
    if len(rows) == 1 and rows[0] in r.DATE_DIMENSIONS:
        known_columns = {token[1]: record["column_path"] for token, record in result.items()}
        for date_key in r._date_keys(start, end, rows[0]):
            for column_key, column_path in known_columns.items():
                result.setdefault(((date_key,), column_key), {"row_path": [{"dimension": rows[0], "key": date_key, "label": r._point_label(rows[0], date_key, date_key)}], "column_path": column_path,
                    "values": {metric: r.empty_metric_value(metric) for metric in metrics}, "row_count": 0})
    return result, ignored


def _path_text(path):
    return " / ".join(item["label"] for item in path) or "總計"


def _condition_context(body, card, page, ignored):
    return {"period": body.config.period, "report": {"owner_id": body.config.owner_id, "customer_type": body.config.customer_type, "filters": body.config.filters, "slicers": body.config.slicers, "date_range": body.config.date_range},
        "page": {"filters": page.filters, "slicers": page.slicers, "date_range": page.date_range},
        "card": {"filters": card.filters, "slicers": card.slicers, "date_range": card.date_range},
        "selection_scope": body.selection_scope, "interaction": card.interaction, "selection_groups": body.config.selection_groups, "drill_filters": body.config.drill_filters.get(card.id, []),
        "ignored_dimensions": sorted(ignored) if ignored is not None else None, "point": body.point, "complete": True}


def json_text(value):
    def encode(item):
        if isinstance(item, BaseModel): return item.model_dump(mode="json")
        if isinstance(item, (dt.date, dt.datetime)): return item.isoformat()
        if isinstance(item, Decimal): return float(item)
        raise TypeError(type(item).__name__)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=encode)


def summary_table(session: Session, user: AppUser, body: ExportInput, original: r.ReportCard, today: dt.date, scope_label: str):
    card, config = _effective(original, body)
    page = next(page for page in config.pages if page.id == card.page_id)
    start, end = r.period_bounds(config.period, today, config.date_range)
    start, end = r.card_bounds(card, config, start, end)
    options = r.matrix_options(card) if card.visual == "matrix" else None
    rows = options.rows if options else ([] if card.dimension == "none" else [card.dimension])
    columns = options.columns if options else ([card.legend] if card.legend else [])
    metrics = options.metrics if options else [card.metric, *([card.secondary_metric] if card.secondary_metric else [])]
    values, ignored = _group_rows(session, card, config, Scope.for_user(user), start, end, today, rows, columns, metrics)
    prior = None
    comparison_dates = None
    if card.comparison != "none":
        offset = 1 if card.comparison == "previous_month" else 12
        try:
            comparison_dates = r.comparison_bounds(start, end, offset)
            prior, _ = _group_rows(session, card, config, Scope.for_user(user), start, end, today, rows, columns, metrics, offset)
        except ValueError:
            pass
    fields = [("row_label", "列階層", "text"), ("column_label", "欄階層／系列", "text"), ("row_filters", "列編號與條件", "text"), ("column_filters", "欄編號與條件", "text"), ("row_count", "符合條件紀錄數", "number")]
    for metric in metrics:
        kind = "percent" if metric == "net_margin_rate" else "currency" if metric in ("sales", "net_margin", "avg_order_value", "overdue") else "number"
        fields.append((metric, METRICS[metric], kind))
        if card.comparison != "none":
            fields += [(f"{metric}_previous", f"{METRICS[metric]} 前期", kind), (f"{metric}_delta", f"{METRICS[metric]} 差額" if metric != "net_margin_rate" else "淨毛利率差異（百分點）", "number" if metric == "net_margin_rate" else kind)]
            if metric != "net_margin_rate": fields.append((f"{metric}_growth", f"{METRICS[metric]} 成長率（比例）", "percent"))
            fields.append((f"{metric}_status", f"{METRICS[metric]} 比較狀態", "text"))
    records = []
    for token, value in values.items():
        row_path, column_path = value["row_path"], value["column_path"]
        record = {"_record": "總計" if token == ((), ()) else "最低層分組" if len(row_path) == len(rows) and len(column_path) == len(columns) else "小計",
            "row_label": _path_text(row_path), "column_label": _path_text(column_path), "row_filters": json_text(row_path), "column_filters": json_text(column_path), "row_count": value["row_count"], **value["values"]}
        if card.comparison != "none":
            previous = prior.get(token) if prior else None
            for metric in metrics:
                compared = r.comparison_value(value["values"][metric], previous["values"][metric] if previous else r.empty_metric_value(metric), previous["row_count"] if previous else 0, metric)
                if comparison_dates is None:
                    compared = r.ComparisonValue(previous=None, delta=None, relative_change=None, previous_rows=0, status="date_out_of_range")
                record.update({f"{metric}_previous": compared.previous, f"{metric}_delta": compared.delta * 100 if metric == "net_margin_rate" and compared.delta is not None else compared.delta, f"{metric}_growth": compared.relative_change, f"{metric}_status": STATUS[compared.status]})
        records.append(record)
    # 階層連續排列，總計置末；日期按時間，其他同層分組按完整聚合排序。
    def axis_order(path, axis):
        prefix = ()
        order = []
        for item in path:
            dimension = item["dimension"]
            if dimension in r.DATE_DIMENSIONS:
                order.append((0, item["key"]))
            else:
                prefix += (item["key"],)
                aggregate = values.get((prefix, ()) if axis == 0 else ((), prefix))
                amount = aggregate["values"].get(card.metric) if aggregate else None
                if card.sort == "label_asc": order.append((1, item["label"], item["key"]))
                else: order.append((1, amount is None, (amount or 0) * (1 if card.sort == "value_asc" else -1), item["key"]))
                continue
            prefix += (item["key"],)
        return (not bool(path), order)
    records.sort(key=lambda record: (axis_order(json.loads(record["row_filters"]), 0), axis_order(json.loads(record["column_filters"]), 1)))
    root = values[((), ())]
    context = _condition_context(body, original, page, ignored)
    context["metrics"] = metrics
    context["comparison"] = {"mode": card.comparison, "dates": comparison_dates}
    note = "完整實際分組、各層小計及總計；不使用前 N 筆、其他系列、展開狀態或分頁限制。沒有交易的客戶／商品配對不補虛構列。比率與去重數均由各層資料重新聚合，不能跨列加總。百分比在 CSV／Excel 儲存 0-1 比例；百分點差額另以百分點表示。"
    if card.metric in r.SALES_METRICS: note += " 交易依目前客戶負責人歸屬。"
    if "net_margin" in metrics or "net_margin_rate" in metrics: note += " 淨毛利為業績扣除成本、上架費及通路獎勵。"
    if "net_margin_rate" in metrics: note += " 淨毛利率為淨毛利加總除以業績加總；業績為零時無法計算。"
    if "order_count" in metrics or "avg_order_value" in metrics: note += " 訂單數按客戶及訂單編號去重；平均客單價為符合品項業績除以去重訂單數，沒有訂單時無法計算。"
    if card.metric == "visits": note += " 拜訪只含已確認或同步的紀錄，依實際拜訪人員與台北日界線。"
    if card.metric in ("customers", "overdue"): note += " 此來源是目前快照，不依期間產生歷史。"
    elif start > end: note += " 報表、分頁與單圖日期沒有交集，本期沒有符合條件的資料。"
    if ignored: note += " 此來源不支援的條件：" + "、".join(DIMENSIONS.get(item, item) for item in sorted(ignored)) + "。"
    return ExportTable(original, page, fields, lambda: iter(records), root["values"][card.metric], root["row_count"], start, end, today, scope_label, context, note, metrics)


def detail_table(session, user, body, card, scope_label):
    request = report_details.DetailsInput(config=body.config, card_id=card.id, point=body.point, selection_scope=body.selection_scope, page=1, page_size=25, sort_by=body.sort_by, sort_direction=body.sort_direction)
    card, today, start, end, total, count, columns, query, note = report_details._query(session, user, request)
    page = next(page for page in body.config.pages if page.id == card.page_id)
    fields = [(column.key, column.label, column.kind) for column in columns]
    if not any(key == "customer_id" for key, _, _ in fields):
        fields.insert(0, ("customer_id", "客戶編號", "text"))
    def records():
        for record in session.execute(query.execution_options(yield_per=1000)).mappings():
            yield {"_record": "實際明細", **{key: value for key, value in record.items() if key != "_id"}}
    context = _condition_context(body, card, page, None)
    return ExportTable(card, page, fields, records, total, count, start, end, today, scope_label, context, note, [card.metric])


def tables(session: Session, user: AppUser, body: ExportInput):
    r.validate_owner(session, user, body.config)
    today = r.app_today(session)
    acting = user.acts_as or user
    scope = "全公司" if acting.role == "it" else "我的團隊" if acting.role == "manager" else "我的客戶"
    if body.config.owner_id:
        scope = next(owner.name for owner in r.owners(session, user) if owner.id == body.config.owner_id)
    if user.acts_as_user_id: scope = f"示範資料 · {acting.name} · {scope}"
    cards = [card for card in body.config.cards if (not body.card_id or card.id == body.card_id) and (not body.page_id or card.page_id == body.page_id)]
    order = {page.id: index for index, page in enumerate(body.config.pages)}
    cards.sort(key=lambda card: order[card.page_id])
    return [summary_table(session, user, body, card, today, scope) if body.data == "summary" else detail_table(session, user, body, card, scope) for card in cards]


def csv_file(body: ExportInput, exported: list[ExportTable]):
    output = SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    text = io.TextIOWrapper(output, encoding="utf-8-sig", newline="", write_through=True)
    columns = dict(META_COLUMNS)
    for table in exported:
        for key, label, _ in table.columns:
            if key == "owner": label = "業務（依來源定義）"
            if key == "date": label = "日期／時間（拜訪為台北時間）"
            columns.setdefault(key, label)
    writer = csv.writer(text)
    writer.writerow(columns.values())
    for table in exported:
        common = {"_report": body.config.name, "_page": table.page.name, "_card": table.card.id, "_title": table.card.title, "_scope": table.scope, "_as_of": table.as_of, "_start": table.start, "_end": table.end}
        metadata = {**common, "_record": "匯出條件", "_conditions": json_text({**table.conditions, "note": table.note, "total": table.total, "row_count": table.count, "exported_at": dt.datetime.now(dt.timezone.utc)})}
        writer.writerow([safe_cell(metadata.get(key)) for key in columns])
        for record in table.records():
            values = {**common, **record}
            writer.writerow([safe_cell(values.get(key)) for key in columns])
    text.flush(); text.detach(); output.seek(0)
    return output


def export_file(session: Session, user: AppUser, body: ExportInput):
    exported = tables(session, user, body)
    if body.format == "csv":
        file = csv_file(body, exported)
    else:
        from app.services import report_export_files
        file = report_export_files.xlsx_file(body, exported) if body.format == "xlsx" else report_export_files.pdf_file(body, exported)
    title = re.sub(r"[^\w\-\u3400-\u9fff]", "_", body.config.name)[:60] or "report"
    return file, f"{title}-{'完整彙總' if body.data == 'summary' else '完整明細'}.{body.format}"

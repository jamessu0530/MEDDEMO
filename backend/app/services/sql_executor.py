"""數字查詢的 SQL 執行器（SDD 議題 3）。

模型寫的 SQL 只能讀四個語意層 View：真正的保證是資料庫權限（semantic_reader 角色只拿得到這四個 View），
這裡的文字檢查只是先擋掉明顯不對的輸入，讓錯誤訊息好懂。
"""

import datetime as dt
import re
from dataclasses import dataclass
from decimal import Decimal
from functools import cache
from typing import Any

from sqlalchemy import Engine, text

ALLOWED_VIEWS = ("v_monthly_sales", "v_customer_summary", "v_visit_signal", "v_margin_breakdown")
# 給模型看的結果最多 50 列：數字題的答案通常是彙總，列數多到這裡代表查詢不夠聚焦，應該再改寫
MAX_ROWS = 50
# 這幾個 View 在假資料上都是毫秒級；超過 5 秒一定是寫錯的查詢（例如沒有條件的交叉合併）
STATEMENT_TIMEOUT = "5s"


class QueryRejected(ValueError):
    """查詢在執行前就被擋下。"""


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    return value


def run_readonly(engine: Engine, sql: str) -> QueryResult:
    statement = sql.strip().rstrip(";").strip()
    if ";" in statement:
        raise QueryRejected("一次只能執行一條查詢")
    if not re.match(r"(?is)^(select|with)\b", statement):
        raise QueryRejected("只能執行 SELECT 查詢")
    with engine.connect() as conn:
        with conn.begin() as transaction:
            conn.exec_driver_sql("SET TRANSACTION READ ONLY")
            conn.exec_driver_sql("SET LOCAL ROLE semantic_reader")
            conn.exec_driver_sql(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
            # no_parameters：模型寫的 LIKE '%…%' 不能被當成參數符號
            result = conn.exec_driver_sql(statement, execution_options={"no_parameters": True})
            columns = list(result.keys())
            fetched = result.fetchmany(MAX_ROWS + 1)
            transaction.rollback()
    rows = [[_plain(v) for v in row] for row in fetched[:MAX_ROWS]]
    return QueryResult(columns, rows, truncated=len(fetched) > MAX_ROWS)


@cache
def describe_views(engine: Engine) -> str:
    """把四個 View 的欄位與註解整理成文字，交給產生 SQL 的模型（註解寫在 semantic_layer.sql）。"""
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT c.relname, obj_description(c.oid, 'pg_class'), a.attname,
                       format_type(a.atttypid, a.atttypmod), col_description(c.oid, a.attnum)
                FROM pg_class c
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                WHERE c.relname = ANY(:views)
                ORDER BY c.relname, a.attnum
            """),
            {"views": list(ALLOWED_VIEWS)},
        ).all()
    lines: list[str] = []
    current = None
    for view, view_comment, column, column_type, column_comment in rows:
        if view != current:
            lines.append(f"\n{view}：{view_comment or ''}")
            current = view
        lines.append(f"  - {column}（{column_type}）{('：' + column_comment) if column_comment else ''}")
    return "\n".join(lines).strip()

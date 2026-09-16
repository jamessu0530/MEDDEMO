"""資料表定義。拜訪紀錄五欄位的格式見 docs/visit-fields.md。"""

import datetime as dt
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    ARRAY,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    LargeBinary,
    MetaData,
    Numeric,
    Sequence,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

CUSTOMER_TYPES = ("chain", "independent", "clinic")
# processing：錄音已上傳，背景正在轉文字或整理欄位
# failed：轉文字失敗，等業務重錄或手動輸入逐字稿
# draft：欄位整理好了，等業務確認；confirmed：已確認，回寫有失敗項；synced：三套系統都寫入了
VISIT_STATUSES = ("processing", "failed", "draft", "confirmed", "synced")
WRITEBACK_TARGETS = ("crm", "sap", "oa")
# skipped：該拜訪沒有購買意向，SAP 不需要報價草稿
WRITEBACK_STATUSES = ("pending", "success", "failed", "skipped")
ASK_KINDS = ("data", "knowledge")
# queued／running：排隊與處理中；answered：有答案；no_evidence：知識庫查無依據（FR-8.3）；
# not_converged：查到上限還答不出來（FR-7.2）；failed：處理出錯，例如 AI 模型還沒設定
ASK_STATUSES = ("queued", "running", "answered", "no_evidence", "not_converged", "failed")
# open：等主管回覆；answered：主管回覆了（FR-8.4 延伸）
ESCALATION_STATUSES = ("open", "answered")


def one_of(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    return CheckConstraint(f"{column} IN ({', '.join(repr(v) for v in values)})", name=name)


class Base(DeclarativeBase):
    # 固定約束的命名方式，違反約束時從錯誤訊息就看得出是哪一條
    metadata = MetaData(naming_convention={
        "ix": "ix_%(column_0_label)s",
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    })
    type_annotation_map = {
        dt.datetime: DateTime(timezone=True),
        Decimal: Numeric(12, 2),
        # Python 的 None 存成 SQL NULL，而不是 JSON 的 null
        dict[str, Any]: JSONB(none_as_null=True),
        list[str]: ARRAY(String),
    }


class AppSetting(Base):
    """系統設定。as_of_date 是展示用的「今天」，View 透過 app_today() 讀它。"""

    __tablename__ = "app_setting"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[str]


class AppUser(Base):
    __tablename__ = "app_user"
    __table_args__ = (one_of("role", ("sales", "manager"), "role"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    role: Mapped[str]
    region: Mapped[str]
    # 公司給的帳號用 Email 登入；第三方登入自動開的帳號沒有 Email 與密碼（信箱記在 user_identity）。
    # 可以是 NULL 而不是塞假信箱：同一個人用 Google 和 GitHub 各開一次，兩邊信箱一樣會撞到唯一限制
    email: Mapped[str | None] = mapped_column(unique=True)
    password_hash: Mapped[str | None]
    # 第三方登入自動開的帳號自己沒有客戶，看的是這位示範業務的路線與客戶
    acts_as_user_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    # 每次登入加一，並寫進 JWT。每個請求比對兩邊，對不上就是這個帳號已經在別的裝置登入，
    # 舊 token 直接失效。這樣不必另外維護一張作廢清單
    session_version: Mapped[int] = mapped_column(server_default="1")
    updated_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class UserIdentity(Base):
    """綁到帳號上的第三方登入（Google、GitHub、Facebook）。

    帳號是公司給的，第三方登入不會自動開新帳號：要先用 Email 登入、到帳號設定綁定，之後才能用它登入。
    用各家給的使用者編號（subject）認人，不用 Email：Email 可以改，也可能沒給。
    """

    __tablename__ = "user_identity"
    __table_args__ = (
        one_of("provider", ("google", "github", "facebook"), "provider"),
        UniqueConstraint("provider", "subject", name="uq_user_identity_subject"),
        # 一個帳號每家只綁一個，避免同一人綁兩個 Google 之後搞不清楚哪個是哪個
        UniqueConstraint("user_id", "provider", name="uq_user_identity_user_provider"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str]
    subject: Mapped[str]
    # 只拿來在帳號設定顯示「綁的是哪個帳號」，不拿來認人
    email: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class Customer(Base):
    __tablename__ = "customer"
    __table_args__ = (
        one_of("type", CUSTOMER_TYPES, "type"),
        one_of("grade", ("A", "B", "C"), "grade"),
        CheckConstraint("(type = 'chain') = (chain_group IS NOT NULL)", name="chain_group"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    type: Mapped[str]
    chain_group: Mapped[str | None]
    region: Mapped[str]
    city: Mapped[str]
    grade: Mapped[str]
    contract_end_date: Mapped[dt.date | None]
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))


class Product(Base):
    __tablename__ = "product"

    sku: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    category: Mapped[str]
    spec: Mapped[str]
    unit: Mapped[str]
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    # 業務口語的叫法，語音抽取時用來把「魚油」對到正確品項，也是熱詞表來源
    aliases: Mapped[list[str]] = mapped_column(server_default="{}")


class SalesTransaction(Base):
    """交易明細，一列一個品項；同一次進貨的品項共用 order_no。"""

    __tablename__ = "sales_transaction"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        Index("ix_sales_transaction_customer_date", "customer_id", "date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    order_no: Mapped[str] = mapped_column(index=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    date: Mapped[dt.date]
    sku: Mapped[str] = mapped_column(ForeignKey("product.sku"))
    qty: Mapped[int]
    amount: Mapped[Decimal]
    cost: Mapped[Decimal]
    # SDD 的 channel_fee 拆成兩項：淨毛利要分別扣上架費與通路獎勵
    listing_fee: Mapped[Decimal] = mapped_column(server_default="0")
    channel_reward: Mapped[Decimal] = mapped_column(server_default="0")


class Receivable(Base):
    """應收帳款，一張發票對應一次進貨。paid_date 為空表示還沒收到。"""

    __tablename__ = "receivable"

    invoice_no: Mapped[str] = mapped_column(primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"), index=True)
    invoice_date: Mapped[dt.date]
    due_date: Mapped[dt.date]
    amount: Mapped[Decimal]
    paid_date: Mapped[dt.date | None]


visit_seq = Sequence("visit_seq", metadata=Base.metadata)


class Visit(Base):
    __tablename__ = "visit"
    __table_args__ = (
        one_of("status", VISIT_STATUSES, "status"),
        Index("ix_visit_customer_visited_at", "customer_id", "visited_at"),
    )

    id: Mapped[str] = mapped_column(
        primary_key=True,
        server_default=text("'V' || lpad(nextval('visit_seq')::text, 5, '0')"),
    )
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    visited_at: Mapped[dt.datetime]
    audio_url: Mapped[str | None]
    transcript: Mapped[str] = mapped_column(Text, server_default="")
    # 模型原始抽取結果，之後不再改動；使用者的修改只寫進 fields_final
    fields_raw: Mapped[dict[str, Any] | None]
    fields_final: Mapped[dict[str, Any] | None]
    # 每個有值欄位對應的逐字稿原文片段（FR-5.4）
    field_sources: Mapped[dict[str, Any] | None]
    status: Mapped[str] = mapped_column(server_default="draft")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    confirmed_at: Mapped[dt.datetime | None]
    # 前端錄音時產生的編號；離線佇列重送同一段錄音時，靠它避免建出第二筆拜訪
    client_ref: Mapped[str | None] = mapped_column(unique=True)
    # 轉文字或整理欄位失敗的原因，畫面上會顯示，並提供手動接手的方式
    error_message: Mapped[str | None]


class VisitAudio(Base):
    """口述錄音原檔。存在資料庫裡，背景工作和 API 不必共用磁碟。"""

    __tablename__ = "visit_audio"

    visit_id: Mapped[str] = mapped_column(ForeignKey("visit.id", ondelete="CASCADE"), primary_key=True)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    mime_type: Mapped[str]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class FollowUpReminder(Base):
    """追蹤提醒（FR-6.4）。確認送出時，紀錄裡有追蹤日或承諾期限就建一筆。"""

    __tablename__ = "follow_up_reminder"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey("visit.id", ondelete="CASCADE"), unique=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    due_date: Mapped[dt.date]
    note: Mapped[str]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


# 以下三張表模擬三套既有系統，欄位形狀刻意各不相同，回寫時要各自對應。
# visit_id 設唯一：重送失敗項目時不會寫出第二筆。


class CrmVisitRecord(Base):
    __tablename__ = "crm_visit_record"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey("visit.id"), unique=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    rep_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    visit_date: Mapped[dt.date]
    competitor: Mapped[str | None]
    complaint: Mapped[str | None]
    intent_summary: Mapped[str | None]
    commitment: Mapped[str | None]
    follow_up_date: Mapped[dt.date | None]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class SapQuotationDraft(Base):
    __tablename__ = "sap_quotation_draft"
    __table_args__ = (
        UniqueConstraint("visit_id", "line_no"),
        CheckConstraint("qty > 0", name="qty_positive"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey("visit.id"))
    line_no: Mapped[int]
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    sku: Mapped[str] = mapped_column(ForeignKey("product.sku"))
    qty: Mapped[int]
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    status: Mapped[str] = mapped_column(server_default="draft")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class OaExpenseForm(Base):
    __tablename__ = "oa_expense_form"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey("visit.id"), unique=True)
    applicant_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    trip_date: Mapped[dt.date]
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    purpose: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="submitted")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class WritebackLog(Base):
    """每一次寫入嘗試留一列。重送是新增一列而不是覆蓋，失敗過的紀錄才查得到。"""

    __tablename__ = "writeback_log"
    __table_args__ = (
        one_of("target", WRITEBACK_TARGETS, "target"),
        one_of("status", WRITEBACK_STATUSES, "status"),
        UniqueConstraint("visit_id", "target", "attempt"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey("visit.id"))
    target: Mapped[str]
    attempt: Mapped[int]
    status: Mapped[str]
    error_message: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[dt.datetime | None]


class DocumentChunk(Base):
    """內部文件切片（SDD 5.2）。一個「## 」小節切成一段：每段是一條完整的規定，引用出處才對得準。"""

    __tablename__ = "document_chunk"
    __table_args__ = (
        UniqueConstraint("source_name", "chunk_index"),
        Index("ix_document_chunk_search_tokens", "search_tokens", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    source_name: Mapped[str]
    doc_title: Mapped[str]
    doc_type: Mapped[str]
    section: Mapped[str]
    chunk_index: Mapped[int]
    chunk_content: Mapped[str] = mapped_column(Text)
    # 關鍵字檢索用：中文切成相鄰兩字、英數字整個字，以 simple 設定轉成 tsvector
    search_tokens: Mapped[Any] = mapped_column(TSVECTOR)
    # 語意檢索用；沒設定 embedding 服務時是空的，檢索只走關鍵字。不固定維度，換模型不必改表；
    # 切片只有百來段，逐筆比對就夠快，所以也不建近似索引
    embedding: Mapped[Any | None] = mapped_column(Vector())


class AskRecord(Base):
    """一次提問（FR-7 數字查詢、FR-8 知識查詢）。每一步查了什麼記在 query_trace（NFR-2 可追溯）。"""

    __tablename__ = "ask_record"
    __table_args__ = (one_of("kind", ASK_KINDS, "kind"), one_of("status", ASK_STATUSES, "status"))

    id: Mapped[str] = mapped_column(primary_key=True)
    kind: Mapped[str]
    question: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(server_default="queued")
    answer: Mapped[str | None] = mapped_column(Text)
    # 知識題：引用的文件切片；數字題：最後一次查詢的結果表。畫面上當作依據顯示（FR-8.1、NFR-1）
    evidence: Mapped[dict[str, Any] | None]
    error_message: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[dt.datetime | None]


class QueryTrace(Base):
    """查詢過程的每一步（FR-7.3）：數字題每輪的 SQL 與判斷，知識題每輪的檢索字句與相關性評估。"""

    __tablename__ = "query_trace"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ask_id: Mapped[str] = mapped_column(ForeignKey("ask_record.id", ondelete="CASCADE"), index=True)
    round: Mapped[int]
    step: Mapped[str]
    sql: Mapped[str | None] = mapped_column(Text)
    search_query: Mapped[str | None] = mapped_column(Text)
    row_count: Mapped[int | None]
    decision: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class Escalation(Base):
    """查無依據時轉給主管回答的問題（FR-8.4）。主管在主管端回覆，業務的首頁會提醒有新回覆。"""

    __tablename__ = "escalation"
    __table_args__ = (one_of("status", ESCALATION_STATUSES, "status"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ask_id: Mapped[str] = mapped_column(ForeignKey("ask_record.id", ondelete="CASCADE"), unique=True)
    question: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(server_default="open")
    answer: Mapped[str | None] = mapped_column(Text)
    answered_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    answered_at: Mapped[dt.datetime | None]
    # 業務看過回覆的時間；還沒看過的回覆會在首頁提醒。主管改了回覆就清空，業務會再收到一次提醒
    seen_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())

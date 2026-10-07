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
    false,
    func,
    text,
)
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import UserDefinedType

CUSTOMER_TYPES = ("chain", "independent", "clinic")
# processing：錄音已上傳，背景正在轉文字或整理欄位
# failed：轉文字失敗，等業務重錄或手動輸入逐字稿
# draft：欄位整理好了，等業務確認；confirmed：已確認，回寫有失敗項；synced：三套系統都寫入了
VISIT_STATUSES = ("processing", "failed", "draft", "confirmed", "synced")
WRITEBACK_TARGETS = ("crm", "sap", "oa")
# skipped：該拜訪沒有購買意向，SAP 不需要報價草稿
WRITEBACK_STATUSES = ("pending", "success", "failed", "skipped")
# memory：在頻道記憶裡找（各頻道整理出來的重點與附件）
ASK_KINDS = ("data", "knowledge", "memory")
# queued／running：排隊與處理中；answered：有答案；no_evidence：知識庫查無依據（FR-8.3）；
# not_converged：查到上限還答不出來（FR-7.2）；failed：處理出錯，例如 AI 模型還沒設定
ASK_STATUSES = ("queued", "running", "answered", "no_evidence", "not_converged", "failed")
# open：等主管回覆；answered：主管回覆了（FR-8.4 延伸）
ESCALATION_STATUSES = ("open", "answered")


class LTREE(UserDefinedType):
    """Postgres 的 ltree。SQLAlchemy 沒有內建，宣告一個最小可用的（不加 sqlalchemy-utils 相依）。

    只有 AppUser.org_path 用它：它是唯一會出現在 SQL 比對裡的路徑欄位。
    OrgUnit 的路徑就是它的 id（'TW'、'TW.N'），純字串處理，不需要這個型別。
    """

    cache_ok = True

    def get_col_spec(self, **kw: Any) -> str:
        return "LTREE"


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


ORG_UNIT_KINDS = ("root", "region")
# sales：跑今日路線；manager：帶一隊業務，多一個主管端；it：坐在根節點上，看得到也動得了全公司，並管組織
ROLES = ("sales", "manager", "it")
# 業務怎麼跑客戶：開車、機車、大眾運輸（跟 services/google_routes.py 的 DayMode 同一組）
TRAVEL_MODES = ("drive", "scooter", "transit")
# 單段可以另外選的交通方式（itinerary_leg.mode）：多一種走路，走路不能當整天的預設
LEG_MODES = (*TRAVEL_MODES, "walk")


class OrgUnit(Base):
    """組織樹的地理層，只有四列。人不放這裡：經理本人就是團隊節點，掛在 AppUser 上。

    id 同時就是這個節點的路徑（'TW'、'TW.N'），所以不另外存 path 欄位。
    """

    __tablename__ = "org_unit"
    __table_args__ = (one_of("kind", ORG_UNIT_KINDS, "kind"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    kind: Mapped[str]
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("org_unit.id"))
    # 區處辦公室的位置，今日路線每天從這裡出發；只有三個區有值
    lat: Mapped[float | None]
    lng: Mapped[float | None]
    # 區處辦公室所在的縣市（熊熊滾從辦公室出發時騎哪個縣市的座騎）；跟位置一樣只有三個區有值
    city: Mapped[str | None]


class AppUser(Base):
    __tablename__ = "app_user"
    __table_args__ = (
        one_of("role", ROLES, "role"),
        one_of("travel_mode", TRAVEL_MODES, "travel_mode"),
        # 位置跟著角色：業務接在主管後面；主管與 IT 掛在地理節點上（主管掛區、IT 掛根，這一層約束
        # 查不到 org_unit，由 services/org.py 的 paths_from_reports 檢查）。
        # 不在組織裡：三個都空，且一定是代理別人的帳號（自建與第三方登入，見 api/auth.py）
        CheckConstraint(
            "(role = 'sales' AND manager_id IS NOT NULL AND unit_id IS NULL AND org_path IS NOT NULL)"
            " OR (role IN ('manager', 'it') AND manager_id IS NULL AND unit_id IS NOT NULL AND org_path IS NOT NULL)"
            " OR (role = 'sales' AND manager_id IS NULL AND unit_id IS NULL AND org_path IS NULL"
            "     AND acts_as_user_id IS NOT NULL)",
            name="org_position",
        ),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    role: Mapped[str]
    # 衍生值：路徑所在的那一區（IT 是根節點「全國」），由 services/org.py 的 rebuild_org_paths 跟路徑一起重算，
    # 組織怎麼改都不會跟樹對不上。自建帳號跟著代理的那位業務
    region: Mapped[str]
    # 公司給的帳號用 Email 登入；第三方登入自動開的帳號沒有 Email 與密碼（信箱記在 user_identity）。
    # 可以是 NULL 而不是塞假信箱：同一個人用 Google 和 GitHub 各開一次，兩邊信箱一樣會撞到唯一限制
    email: Mapped[str | None] = mapped_column(unique=True)
    password_hash: Mapped[str | None]
    # 第三方登入自動開的帳號自己沒有客戶，看的是這位示範業務的路線與客戶
    acts_as_user_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    # 組織樹（services/org.py）。manager_id 與 unit_id 是真相來源，org_path 是整棵重算出來的衍生值。
    # 經理沒有 manager_id、掛在地理節點上；業務有 manager_id，路徑接在主管後面
    manager_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    unit_id: Mapped[str | None] = mapped_column(ForeignKey("org_unit.id"))
    org_path: Mapped[str | None] = mapped_column(LTREE)
    # app_user 有兩個指向自己的外鍵（acts_as_user_id 與 manager_id），要明講是哪一個
    acts_as: Mapped["AppUser | None"] = relationship(
        remote_side="AppUser.id", foreign_keys="AppUser.acts_as_user_id"
    )
    # 每次登入加一，並寫進 JWT。每個請求比對兩邊，對不上就是這個帳號已經在別的裝置登入，
    # 舊 token 直接失效。這樣不必另外維護一張作廢清單
    session_version: Mapped[int] = mapped_column(server_default="1")
    updated_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    # IT 停用的時間，NULL 是在職。停用的人登不進來，但留在組織樹原位：
    # 他的歷史拜訪照舊給原本的團隊看（路徑一拿掉，連 IT 都看不到那些紀錄）
    deactivated_at: Mapped[dt.datetime | None]
    # 業務跑客戶的交通方式：行程的時間、排順路與地圖上的線都照它算（services/itinerary.py）。
    # 是行程主人的設定：代理示範業務的帳號看的是示範業務的行程，改的也是示範業務這一欄
    travel_mode: Mapped[str] = mapped_column(server_default="drive")


class OrgChangeLog(Base):
    """組織與帳號的異動紀錄（組織管理頁最下面）。detail 是寫給人看的一句話，當下就寫好，
    之後名字、組織再怎麼變都不回頭改。"""

    __tablename__ = "org_change_log"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    action: Mapped[str]
    detail: Mapped[str]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


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


class Place(Base):
    """地點頻道的範圍：縣市，台北市客戶多，細分到行政區（services/channels.py）。
    客戶掛在一個地點上，地點掛在一個區上：整區的人看得到這個地點的頻道與底下的客戶討論串。
    id 只用 ASCII（'TPE-DA'、'NTPC'），網址與約束訊息裡比較好認。"""

    __tablename__ = "place"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    unit_id: Mapped[str] = mapped_column(ForeignKey("org_unit.id"))


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
    # 地點（縣市，台北市到行政區）：客戶討論串掛在這裡。city 保留，今日路線與語意層照舊用它
    place_id: Mapped[str] = mapped_column(ForeignKey("place.id"))
    grade: Mapped[str]
    contract_end_date: Mapped[dt.date | None]
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    # 行政區或鄉鎮（「大安」「板橋」），排序習慣的「地區」用；位置是那一區的中心點錯開幾百公尺，
    # 沒有真的地址（data/seed/generate.py 的 location_of）
    area: Mapped[str]
    lat: Mapped[float]
    lng: Mapped[float]


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


class Promotion(Base):
    """促銷方案（CYH Sales 的「促銷方案」），一個月一期。

    滿額贈、實銷活動這類看整張訂單的規則只寫在 PM 提醒裡，沒有拆成欄位：原始系統的「門檻一～五」
    欄位本來就是空的，規則只有這段文字。
    """

    __tablename__ = "promotion"
    __table_args__ = (CheckConstraint("start_date <= end_date", name="period"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    department: Mapped[str]
    type: Mapped[str]
    # 狀態（進行中、已結束）不存，在語意層跟 app_today() 比出來：存下來的話，展示日一換就不對
    start_date: Mapped[dt.date]
    end_date: Mapped[dt.date]
    pm_note: Mapped[str] = mapped_column(Text)


class PromotionItem(Base):
    """促銷品項：一個品項的一種口數一列，例如骨營膠囊的小口與大口是兩列。一「口」是一個購買單位。"""

    __tablename__ = "promotion_item"
    __table_args__ = (CheckConstraint("buy_qty > 0 AND free_qty >= 0", name="qty"),)

    # 促銷品項編號，例如 PP-027919
    code: Mapped[str] = mapped_column(primary_key=True)
    promotion_id: Mapped[str] = mapped_column(ForeignKey("promotion.id"), index=True)
    group_name: Mapped[str]
    name: Mapped[str]
    sku: Mapped[str] = mapped_column(ForeignKey("product.sku"))
    # 搭贈說明原文，例如「<11+1>+贈1盒骨粉(C450111)+2盒海藻鈣10T」
    deal: Mapped[str]
    # 一口買幾個、同品送幾個；直走價送 0。另外加贈的其他品項只寫在 deal 裡
    buy_qty: Mapped[int]
    free_qty: Mapped[int]
    # 每口售價
    deal_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    # 促銷當時的原建議售價與原出貨價（大宗價）
    list_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    ship_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))


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


NOTE_KINDS = ("bring", "told")


class CustomerNote(Base):
    """拜訪備忘：下次要帶的東西（bring）與跟客戶講過的促銷（told）。錄音確認時寫進來，業務也能手寫
    （docs/superpowers/specs/2026-10-07-calendar-notes-design.md）。"""

    __tablename__ = "customer_note"
    __table_args__ = (
        one_of("kind", NOTE_KINDS, "kind"),
        # 講過的一定是某一天講的；要帶的沒講日期就不放上日曆
        CheckConstraint("kind = 'bring' OR on_date IS NOT NULL", name="told_has_date"),
        CheckConstraint("char_length(text) BETWEEN 1 AND 200", name="text_length"),
        Index("ix_customer_note_customer_id", "customer_id", "id"),
        Index("ix_customer_note_on_date", "on_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    # 誰記的：錄音來的是做這次拜訪的人，手寫的是實際寫的人
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    kind: Mapped[str]
    text: Mapped[str]
    # 放在日曆的哪一天；要帶的沒講日期、這次也沒有追蹤日就是 NULL
    on_date: Mapped[dt.date | None]
    # 從哪次拜訪來的，手寫的是 NULL
    visit_id: Mapped[str | None] = mapped_column(ForeignKey("visit.id", ondelete="CASCADE"))
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


# draft：可以送給客戶；pending_approval：折扣超過業務的權限，等簽核；rejected：簽核被駁回或退回
QUOTE_STATUSES = ("draft", "pending_approval", "rejected")


class SapQuotationDraft(Base):
    __tablename__ = "sap_quotation_draft"
    __table_args__ = (
        UniqueConstraint("visit_id", "line_no"),
        UniqueConstraint("quote_no", "line_no"),
        CheckConstraint("qty > 0", name="qty_positive"),
        # 促銷的列同時有「哪一口」與「幾口」，沒促銷的列兩個都是 NULL
        CheckConstraint("(promo_code IS NULL) = (packs IS NULL) AND (packs IS NULL OR packs > 0)", name="promo_packs"),
        one_of("status", QUOTE_STATUSES, "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    # 同一張報價的品項共用一個單號。拜訪回寫開的用拜訪編號；在客戶檔案直接開的用 Q 開頭的單號
    quote_no: Mapped[str] = mapped_column(index=True)
    # 客戶檔案直接開的報價沒有拜訪（原型客戶檔案的「開報價」）
    visit_id: Mapped[str | None] = mapped_column(ForeignKey("visit.id"))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    line_no: Mapped[int]
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    sku: Mapped[str] = mapped_column(ForeignKey("product.sku"))
    # 沒促銷的列是數量；促銷的列是付錢的數量（每口買的 × 口數）
    qty: Mapped[int]
    # 沒促銷的列是折扣後的單價；促銷的列是每口售價 ÷ 每口買的數量，只供參考，金額看 amount
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    # 這一列打的折扣：沒促銷的列記整張報價的折扣，促銷的列不打折記 0
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(4, 1), server_default="0")
    # 哪一口（促銷品項編號）與幾口；沒促銷的列都是 NULL
    promo_code: Mapped[str | None] = mapped_column(ForeignKey("promotion_item.code"))
    packs: Mapped[int | None]
    # 同品送了幾個（每口送的 × 口數）
    free_qty: Mapped[int] = mapped_column(default=0, server_default="0")
    # 這一列的金額，到分。有的口除不盡（骨營粉劑直走 7 盒 $3,100），不能用單價 × 數量回推
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(server_default="draft")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


OA_FORM_STATUSES = ("draft", "pending", "returned", "rejected", "approved")
OA_STEP_STATUSES = ("waiting", "pending", "done")
# auto_approved：模型有把握，系統直接核准（services/approvals.py）
OA_ACTIVITY_ACTIONS = ("submitted", "approved", "rejected", "returned", "commented", "auto_approved")
# trip：出差單，拜訪確認後自動開；discount：優惠（報價折扣）；contract：合約（連鎖續約與費率）
OA_FORM_KINDS = ("trip", "discount", "contract")
# 規則算出來最高要簽到哪一級：區處主管、業務處長、總經理
OA_REQUIRED_LEVELS = ("manager", "director", "gm")
PENDING_CONTRACT_INDEX = "uq_oa_expense_form_pending_contract"


class OaExpenseForm(Base):
    """模擬 OA 申請單：出差單、優惠申請單、合約申請單共用申請匣、簽核匣與流程。

    表名沿用出差單時期的名字：改了要動灌資料的 SQL 與一整排程式。
    """

    __tablename__ = "oa_expense_form"
    __table_args__ = (
        one_of("status", OA_FORM_STATUSES, "oa_status"),
        one_of("kind", OA_FORM_KINDS, "kind"),
        one_of("required_level", OA_REQUIRED_LEVELS, "required_level"),
        # 出差單跟著一次拜訪；優惠與合約是業務自己送的，內容記在 payload
        CheckConstraint(
            "(kind = 'trip' AND visit_id IS NOT NULL AND trip_date IS NOT NULL AND payload IS NULL)"
            " OR (kind IN ('discount', 'contract') AND visit_id IS NULL AND trip_date IS NULL"
            "     AND payload IS NOT NULL AND request_date IS NOT NULL)",
            name="kind_fields",
        ),
        # 同一家客戶同時只能有一張還沒簽完的續約申請。由資料庫守：兩個請求同時送，先查「有沒有」兩邊都看不到對方
        Index(
            PENDING_CONTRACT_INDEX, "customer_id", unique=True,
            postgresql_where=text("kind = 'contract' AND status = 'pending'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    form_no: Mapped[str] = mapped_column(String(24), unique=True)
    kind: Mapped[str] = mapped_column(server_default="trip")
    visit_id: Mapped[str | None] = mapped_column(ForeignKey("visit.id", ondelete="CASCADE"), unique=True)
    applicant_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    trip_date: Mapped[dt.date | None]
    # 送單當下的系統日（app_today()），特徵就是照這一天算的。出差單沒有
    request_date: Mapped[dt.date | None]
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    purpose: Mapped[str]
    unit_name: Mapped[str]
    # 申請內容。優惠：quote_no、discount_pct、list_amount、amount、cost、reason；
    # 合約：term_months、listing_fee_rate{from,to}、channel_reward_rate{from,to}、old_end_date、new_end_date、reason
    payload: Mapped[dict[str, Any] | None]
    required_level: Mapped[str] = mapped_column(server_default="manager")
    # 送單當下模型估計的核准機率與算機率用的特徵，之後不回頭改：重新訓練時讀的就是這一份
    model_probability: Mapped[float | None]
    model_features: Mapped[dict[str, Any] | None]
    auto_approved: Mapped[bool] = mapped_column(server_default=text("false"))
    status: Mapped[str] = mapped_column(server_default="pending")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    submitted_at: Mapped[dt.datetime | None]


class OaApprovalStep(Base):
    __tablename__ = "oa_approval_step"
    __table_args__ = (
        one_of("status", OA_STEP_STATUSES, "oa_step_status"),
        UniqueConstraint("form_id", "step_no"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("oa_expense_form.id", ondelete="CASCADE"), index=True)
    step_no: Mapped[int]
    role_label: Mapped[str]
    # NULL 代表系統：模型有把握、由系統核准的那一關沒有簽核人
    user_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    title: Mapped[str]
    status: Mapped[str]
    acted_at: Mapped[dt.datetime | None]


class OaComment(Base):
    __tablename__ = "oa_comment"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("oa_expense_form.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class OaAttachment(Base):
    __tablename__ = "oa_attachment"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("oa_expense_form.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str]
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class OaActivity(Base):
    __tablename__ = "oa_activity"
    __table_args__ = (one_of("action", OA_ACTIVITY_ACTIONS, "oa_activity_action"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("oa_expense_form.id", ondelete="CASCADE"), index=True)
    action: Mapped[str]
    # NULL 代表系統（系統核准那一筆）
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    detail: Mapped[str]
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


class ManagerNotice(Base):
    """拜訪提到競品或客訴時，通報業務的直屬主管（原型回寫完成頁：「競品已加入風險分，主管同步收到通報」）。"""

    __tablename__ = "manager_notice"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey("visit.id", ondelete="CASCADE"), unique=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    rep_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    # 通報當時的直屬主管，拜訪結果頁顯示這個名字。誰看得到通報不看這欄，看 rep_id 在不在自己的組織範圍內
    # （api/manager.py），業務之後換了主管，通報跟著人走
    manager_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"), index=True)
    reason: Mapped[str]
    # 通報當下的風險分與項目；之後客戶狀況變了也不回頭改，主管看到的是當時的判斷
    score: Mapped[int]
    items: Mapped[list[str]] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    seen_at: Mapped[dt.datetime | None]


class AskRecord(Base):
    """一次提問（FR-7 數字查詢、FR-8 知識查詢）。每一步查了什麼記在 query_trace（NFR-2 可追溯）。"""

    __tablename__ = "ask_record"
    __table_args__ = (one_of("kind", ASK_KINDS, "kind"), one_of("status", ASK_STATUSES, "status"))

    id: Mapped[str] = mapped_column(primary_key=True)
    # 誰問的：數字查詢照這個人的範圍過濾，提問與轉給主管也只有他自己看得到
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
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


# national：全國；region：整區；team：一位主管帶的小組；place：地點（縣市，台北市到行政區）；customer：一家客戶的討論串；
# topic：文字頻道，區的主管與 IT 在整區頻道、IT 在全國頻道底下開的（docs/superpowers/specs/2026-10-01-channel-rail-design.md）
CHANNEL_KINDS = ("national", "region", "team", "place", "customer", "topic")
# 文字頻道的名稱最多幾個字（services/channel_topics.py、前端的新增對話框一樣）
TOPIC_NAME_MAX = 20
# user：人發的；ai：AI 主理發的；notice：拜訪的風險通報（見 docs/superpowers/specs/2026-09-28-channels-design.md）
MESSAGE_KINDS = ("user", "ai", "notice")
# 一則訊息最多幾個字。回報一件事用不到這麼多，再長多半是誤貼了一大段
MESSAGE_MAX_LENGTH = 2000


class Channel(Base):
    """頻道。不存路徑，只記屬於誰：路徑每次從組織樹現算（services/channels.py），
    主管調區、客戶換負責人都不必另外同步。文字頻道另外存名稱、誰開的、封存時間。"""

    __tablename__ = "channel"
    __table_args__ = (
        one_of("kind", CHANNEL_KINDS, "kind"),
        # 依種類只有一個歸屬欄位有值；文字頻道用 unit_id 指它所在的區或根節點，另外一定要有名稱
        CheckConstraint(
            "(kind IN ('national', 'region')"
            "  AND unit_id IS NOT NULL AND manager_id IS NULL AND place_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'team'"
            "  AND manager_id IS NOT NULL AND unit_id IS NULL AND place_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'place'"
            "  AND place_id IS NOT NULL AND unit_id IS NULL AND manager_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'customer'"
            "  AND customer_id IS NOT NULL AND unit_id IS NULL AND manager_id IS NULL AND place_id IS NULL)"
            " OR (kind = 'topic'"
            "  AND unit_id IS NOT NULL AND name IS NOT NULL AND manager_id IS NULL AND place_id IS NULL"
            "  AND customer_id IS NULL)",
            name="owner",
        ),
        # 只有文字頻道有自己的名稱、開的人與封存時間；其他頻道的名稱從組織樹與地點現算
        CheckConstraint(
            "kind = 'topic' OR (name IS NULL AND created_by IS NULL AND archived_at IS NULL)", name="topic_fields"
        ),
        # 每個區（與根節點）只有一個整區（全國）頻道。文字頻道也用 unit_id，不算在內
        Index("uq_channel_unit_id", "unit_id", unique=True, postgresql_where=text("kind IN ('national', 'region')")),
        # 同一個單位的文字頻道不能重名，不分大小寫；封存的也算，要沿用舊名稱先把舊的改名
        Index(
            "uq_channel_topic_name", "unit_id", text("lower(name)"), unique=True,
            postgresql_where=text("kind = 'topic'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    kind: Mapped[str]
    # 每個歸屬只有一個頻道（NULL 不算重複）；unit_id 的唯一性只限全國與整區，見上面的索引
    unit_id: Mapped[str | None] = mapped_column(ForeignKey("org_unit.id"))
    manager_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"), unique=True)
    place_id: Mapped[str | None] = mapped_column(ForeignKey("place.id"), unique=True)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customer.id"), unique=True)
    # 文字頻道的名稱、誰開的、封存時間（封存了還看得到，只是不能發言）
    name: Mapped[str | None] = mapped_column(String(TOPIC_NAME_MAX))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    archived_at: Mapped[dt.datetime | None]
    # 熊熊滾已經把對話整理到哪一則（services/channel_memory.py）；還沒整理過是 NULL
    memory_through_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class ChannelMessage(Base):
    """頻道裡的一則訊息。第一版不能改、不能刪：回報會被整理進記憶，原文留著才追得回來。
    熊熊滾的回答（kind = ai）用 reply_to_id 指向提問那一則。"""

    __tablename__ = "channel_message"
    __table_args__ = (
        one_of("kind", MESSAGE_KINDS, "kind"),
        # 人發的一定有作者；AI 主理與風險通報沒有
        CheckConstraint("(kind = 'user') = (author_id IS NOT NULL)", name="author"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    # 輪詢「這個頻道這則之後的新訊息」靠這個索引
    channel_id: Mapped[int] = mapped_column(ForeignKey("channel.id", ondelete="CASCADE"), index=True)
    # 自建帳號刪除時，他發的訊息一起刪（隱私權政策寫的刪除方式）；公司帳號只能停用，不會被刪
    author_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(server_default="user")
    body: Mapped[str] = mapped_column(Text)
    # 有沒有叫熊熊滾（services/channels.mentions_mascot）。寫入時判斷就存起來，之後改了判斷規則，舊訊息不會被重新解讀
    mentions_ai: Mapped[bool] = mapped_column(server_default=text("false"))
    # 熊熊滾回答的是哪一則。那一則不在了（自建帳號刪除時一起刪）就留 NULL，回答本身留著
    reply_to_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("channel_message.id", ondelete="SET NULL"))
    # 風險通報（kind = notice）附的拜訪，畫面上點了進拜訪結果頁。拜訪刪掉，通報跟著刪
    visit_id: Mapped[str | None] = mapped_column(ForeignKey("visit.id", ondelete="CASCADE"))
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    # IT 刪掉的訊息：內容換成固定的一句、附件整列刪掉，這一則本身留著，編號與已讀才不會亂
    deleted_at: Mapped[dt.datetime | None]
    deleted_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id", ondelete="SET NULL"))


class ChannelRead(Base):
    """每個人在每個頻道讀到哪一則，算未讀數用。記在實際登入的帳號上，不是代理的那位。"""

    __tablename__ = "channel_read"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("channel.id", ondelete="CASCADE"), primary_key=True)
    last_read_id: Mapped[int] = mapped_column(BigInteger)


# complaint 客訴；competitor 競品；todo 待辦；decision 決議；experience 經驗
MEMORY_CATEGORIES = ("complaint", "competitor", "todo", "decision", "experience")
# 待辦是 open／done，其他分類一律 open
MEMORY_STATUSES = ("open", "done")


class MemoryItem(Base):
    """頻道的記憶：熊熊滾從對話整理出來的一條一條重點（docs/superpowers/specs/2026-09-28-channels-design.md）。
    下層往上傳（shared）、沒撤回、沒刪除的，出現在所有上層的看板；上層只看得到 shared_text 與往上傳的附件，
    點不回原始訊息（附件與記憶見 2026-10-01-attachments-design.md）。"""

    __tablename__ = "memory_item"
    __table_args__ = (
        one_of("category", MEMORY_CATEGORIES, "category"),
        one_of("status", MEMORY_STATUSES, "status"),
        # 往上傳的附件一定是來源附件的一部分
        CheckConstraint("shared_attachment_ids <@ attachment_ids", name="shared_attachments"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("channel.id", ondelete="CASCADE"), index=True)
    category: Mapped[str]
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(server_default="open")
    # 只有待辦會有
    due_date: Mapped[dt.date | None]
    # 從這個頻道的哪幾則訊息整理出來
    source_message_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), server_default="{}")
    # 這條重點的來源附件，與其中跟著往上傳的
    attachment_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), server_default="{}")
    shared_attachment_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), server_default="{}")
    # 要不要往上傳、往上傳時的寫法（拿掉人名、議價細節）
    # 欄位 text 在這個類別裡蓋掉了 sqlalchemy 的 text()，預設值用 false()
    shared: Mapped[bool] = mapped_column(server_default=false())
    shared_text: Mapped[str | None] = mapped_column(Text)
    # 撤回是單向的：撤回過的重點 AI 之後也不能再標成往上傳
    withdrawn_at: Mapped[dt.datetime | None]
    withdrawn_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id", ondelete="SET NULL"))
    deleted_at: Mapped[dt.datetime | None]
    deleted_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id", ondelete="SET NULL"))
    # 最後改內容的人；NULL 代表熊熊滾。人改過的重點，熊熊滾只能把待辦標完成，不能改內容
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id", ondelete="SET NULL"))
    # 上次提醒逾期的時間（第 3 階段的逾期提醒）
    reminded_at: Mapped[dt.datetime | None]
    # 問答頁查頻道記憶用；沒設定語意檢索時是 NULL
    embedding: Mapped[Any | None] = mapped_column(Vector())
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


ATTACHMENT_KINDS = ("image", "pdf")
# pending：剛上傳，還沒請 AI 寫說明與算向量；ready：處理完（沒設定 AI 時也算處理完）；failed：重試後還是失敗
ATTACHMENT_STATUSES = ("pending", "ready", "failed")


class Attachment(Base):
    """頻道訊息或提問附的照片與 PDF（docs/superpowers/specs/2026-10-01-attachments-design.md）。
    存在資料庫裡，跟 VisitAudio 一樣：背景工作和 API 不必共用磁碟，刪訊息、刪帳號靠 CASCADE 一起清掉。"""

    __tablename__ = "attachment"
    __table_args__ = (
        one_of("kind", ATTACHMENT_KINDS, "kind"),
        one_of("status", ATTACHMENT_STATUSES, "status"),
        # 不是附在訊息上就是附在提問上
        CheckConstraint("(message_id IS NULL) <> (ask_id IS NULL)", name="owner"),
        Index("ix_attachment_search_tokens", "search_tokens", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("channel_message.id", ondelete="CASCADE"), index=True)
    ask_id: Mapped[str | None] = mapped_column(ForeignKey("ask_record.id", ondelete="CASCADE"), index=True)
    # 實際登入的帳號（自建帳號記自己，不是代理的示範業務），刪帳號時一起刪
    uploader_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    kind: Mapped[str]
    filename: Mapped[str]
    mime_type: Mapped[str]
    size_bytes: Mapped[int]
    # 檔案本身與縮圖：列清單時用不到，延後到真的要送檔案時才讀
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    # 長邊 480px 的 JPEG；PDF 沒有
    thumbnail: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    width: Mapped[int | None]
    height: Mapped[int | None]
    page_count: Mapped[int | None]
    # AI 寫的說明（是什麼、圖上看得到的字）；還沒處理或處理失敗是 NULL
    caption: Mapped[str | None] = mapped_column(Text)
    # 關鍵字檢索用：檔名、說明、所屬訊息的文字（提問的附件用問題），切法同知識庫
    search_tokens: Mapped[Any] = mapped_column(TSVECTOR)
    status: Mapped[str] = mapped_column(server_default="pending")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class AttachmentVector(Base):
    """附件的向量（gemini-embedding-2）。圖片一張一列；PDF 每 6 頁一列（embedding-2 一次最多 6 頁）。"""

    __tablename__ = "attachment_vector"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    attachment_id: Mapped[int] = mapped_column(ForeignKey("attachment.id", ondelete="CASCADE"), index=True)
    # PDF 這一段的頁數（1 起算）；圖片是 NULL
    page_from: Mapped[int | None]
    page_to: Mapped[int | None]
    # 不固定維度、不建近似索引，理由同 DocumentChunk.embedding
    embedding: Mapped[Any] = mapped_column(Vector())


# 跟 Teams 一樣能手動選的狀態（services/presence.py）：有空、忙碌、請勿打擾、馬上回來、顯示為離開、顯示為離線
PRESENCE_CHOICES = ("available", "busy", "dnd", "brb", "away", "offline")


class UserPresence(Base):
    """在線狀態（docs/superpowers/specs/2026-10-01-presence-design.md）。一個帳號最多一列，
    第一次連線或選狀態時建立。別人看到的狀態由這三個欄位現算，不存。"""

    __tablename__ = "user_presence"
    __table_args__ = (one_of("choice", PRESENCE_CHOICES, "choice"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    # 手動選的狀態，NULL 是自動。選了就一直維持到自己改掉
    choice: Mapped[str | None]
    # 最後一次心跳的時間，登出時清成 NULL。斷線不更新：伺服器可能很久之後才發現斷線，
    # 那時候人早就離開了，從最後一次心跳起算 5 分鐘才是對的
    last_seen_at: Mapped[dt.datetime | None]
    # 最後一次「正在用」（畫面在前景、5 分鐘內碰過）的心跳
    last_active_at: Mapped[dt.datetime | None]


class UserLocation(Base):
    """即時位置（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈即時位置〉）。一人一列、覆寫，不留軌跡。
    代理示範業務的帳號寫在示範業務名下；好幾位評審同時代理同一位時，以最後一筆為準。"""

    __tablename__ = "user_location"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    # 最新的一筆；還沒拿到過位置（只按過暫停、或瀏覽器拒絕定位）是 NULL
    lat: Mapped[float | None]
    lng: Mapped[float | None]
    accuracy_m: Mapped[float | None]
    at: Mapped[dt.datetime | None]
    # 業務按了暫停：不寫位置，主管看到「暫停分享位置」
    paused: Mapped[bool] = mapped_column(server_default=false())
    paused_at: Mapped[dt.datetime | None]
    # 瀏覽器沒給定位權限；之後拿到位置就清掉
    denied: Mapped[bool] = mapped_column(server_default=false())
    denied_at: Mapped[dt.datetime | None]


class UserAvatar(Base):
    """大頭貼（docs/superpowers/specs/2026-10-01-avatars-text-size-design.md）。一個帳號最多一列，
    存在資料庫裡跟附件一樣；沒有這一列就是用名字縮寫。"""

    __tablename__ = "user_avatar"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    # 256×256 的 JPEG，EXIF 已經清掉。列清單時用不到，延後到真的要送圖時才讀
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    # 每換一次就換一個隨機值，網址跟著變：舊網址一律失效，新網址的內容永遠不變、可以一直快取。
    # 不用遞增的數字：移除後再上傳會從頭數，拿到跟舊照片一樣的網址，瀏覽器就會顯示快取裡的舊照片
    version: Mapped[str]
    updated_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class SapEmployee(Base):
    """模擬 SAP 的人員主檔：一個公司帳號一列，存到職日與負責的產品線（新人第一週頁的「你賣什麼」）。

    哪一區、主管是誰不存這裡，照舊看組織樹（AppUser.manager_id、unit_id）：再存一份，
    IT 在組織管理頁調動之後兩邊就會對不上。
    IT 帳號、自建與第三方登入的帳號沒有這一列；沒有人員主檔的業務帳號一律當新人（services/first_week.py）。
    """

    __tablename__ = "sap_employee"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    # SAP 人員編號：E 加五碼。IT 開新帳號時接著最大號編（services/org_admin.py）
    employee_no: Mapped[str] = mapped_column(String(6), unique=True)
    # 到職第幾天、是不是新人都拿它跟系統日 app_today() 比，不跟真實時間比
    hire_date: Mapped[dt.date]
    # 值是品項表的類別（Product.category）：保健品、慢性處方、一般用藥、醫材
    product_lines: Mapped[list[str]]


# 方法卡的「情況」標籤，跟談判卡判斷客戶狀況的訊號同一組：談判卡與新人頁之後靠標籤帶出相關的卡
# （docs/superpowers/specs/2026-09-30-method-cards-design.md）。畫面上的名稱放前端（lib/methods.ts）
METHOD_TAGS = ("competitor", "interval_up", "contract_ending", "ar_overdue", "festival", "cost", "newcomer")
# published：上架，全公司看得到；retired：下架，只有作者與 IT 在主管端看得到，可以重新上架
METHOD_CARD_STATUSES = ("published", "retired")


class MethodCard(Base):
    """方法卡：主管把「遇到這種情況怎麼談」寫下來，全公司的業務都看得到。內容是人寫的，AI 不生成也不改寫。"""

    __tablename__ = "method_card"
    __table_args__ = (
        one_of("status", METHOD_CARD_STATUSES, "status"),
        # NULL 代表每種客戶都適用
        one_of("customer_type", CUSTOMER_TYPES, "customer_type"),
        # 標籤至少一個。值是不是那一組由服務層檢查（services/method_cards.py）：陣列的每個元素不好寫成 CHECK
        CheckConstraint("cardinality(tags) > 0", name="tags"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    title: Mapped[str]
    # 什麼時候用
    situation: Mapped[str] = mapped_column(Text)
    # 怎麼做、怎麼說
    approach: Mapped[str] = mapped_column(Text)
    customer_type: Mapped[str | None]
    tags: Mapped[list[str]]
    # 作者被停用或降成業務，卡片照舊上架，之後只有 IT 改得了
    author_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    status: Mapped[str] = mapped_column(server_default="published")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class MethodCardFeedback(Base):
    """業務按的「有幫上／沒幫上」。採用次數＝有幫上的筆數。記在實際登入的帳號上，不是代理的那位。"""

    __tablename__ = "method_card_feedback"
    __table_args__ = (
        # 同一個人在同一家客戶對同一張卡只有一筆，再按一次是改答案。從方法卡清單按的沒有客戶，
        # NULL 也要算相同（Postgres 15 起的 NULLS NOT DISTINCT），不然同一個人可以一直按、次數一直加
        UniqueConstraint("card_id", "user_id", "customer_id", postgresql_nulls_not_distinct=True),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("method_card.id", ondelete="CASCADE"), index=True)
    # 自建帳號刪除時，他按的回饋一起刪（跟頻道訊息一樣）；公司帳號只能停用，不會被刪
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    # 在哪一家客戶的談判卡上按的；從方法卡清單按的是 NULL
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customer.id"))
    helped: Mapped[bool]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


# 行程裡每一站的來源。model：系統早上排的；rep：業務自己加的；ai：跟熊熊滾說加的；ask：問答頁「排入今天的路線」
ITINERARY_STOP_SOURCES = ("model", "rep", "ai", "ask")


class Itinerary(Base):
    """一位業務一天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

    當天第一次讀取時照模型的建議建好（services/itinerary.py），之後以這份為準，模型不再重排。
    """

    __tablename__ = "itinerary"
    __table_args__ = (UniqueConstraint("user_id", "date"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    date: Mapped[dt.date]
    # 每存一次加一：兩個人同時改同一位業務的行程時，後存的那一個擋下來，不默默蓋掉
    version: Mapped[int] = mapped_column(server_default="1")
    # 建立當下模型建議的站（客戶、訊號、理由，照順序），主管頁比對「改了什麼」用，之後不再改
    suggested: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    # 「需立即處理」那張卡；按了三顆鈕之一、那站拿掉或跑完之後清成 NULL
    urgent: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    # 今天不套用的排序習慣：每天建立建議時跟別的規則衝突、業務在調整清單上按了「今天不套用」，
    # 或存檔時今天的順序跟它不合（以當天排的為準）
    skipped_habit_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), server_default="{}")
    # 上面每一條為什麼今天不套用（習慣 id 的字串 → 一句話），行程與習慣頁上提示用
    skip_reasons: Mapped[dict[str, Any]] = mapped_column(server_default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class ItineraryStop(Base):
    """行程裡的一站。已完成與否不存：看今天有沒有這家已確認的拜訪紀錄。"""

    __tablename__ = "itinerary_stop"
    __table_args__ = (
        UniqueConstraint("itinerary_id", "customer_id"),
        one_of("source", ITINERARY_STOP_SOURCES, "source"),
        CheckConstraint("window_kind IS NULL OR window_kind IN ('at', 'before', 'after')", name="window_kind"),
        CheckConstraint("(window_kind IS NULL) = (window_time IS NULL)", name="window_pair"),
        CheckConstraint("duration_minutes > 0", name="duration_positive"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    itinerary_id: Mapped[int] = mapped_column(ForeignKey("itinerary.id", ondelete="CASCADE"))
    position: Mapped[int]
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    source: Mapped[str]
    signal: Mapped[str]
    reason: Mapped[str]
    # 約的時間：at 幾點到、before 幾點以前、after 幾點以後
    window_kind: Mapped[str | None]
    window_time: Mapped[dt.time | None]
    duration_minutes: Mapped[int] = mapped_column(server_default="40")
    note: Mapped[str | None]
    # 重排時位置不動
    locked: Mapped[bool] = mapped_column(server_default=false())


class ItineraryPrecedence(Base):
    """今天設的先後：before 那家要排在 after 那家前面。刪掉其中一站時一起刪。"""

    __tablename__ = "itinerary_precedence"
    __table_args__ = (CheckConstraint("before_customer_id <> after_customer_id", name="two_customers"),)

    itinerary_id: Mapped[int] = mapped_column(ForeignKey("itinerary.id", ondelete="CASCADE"), primary_key=True)
    before_customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"), primary_key=True)
    after_customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"), primary_key=True)


class ItineraryLeg(Base):
    """今天的行程裡一段路怎麼去（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈資料〉）。
    只存跟業務的預設（app_user.travel_mode）不一樣的段：沒有這一列就照預設。
    拿掉一站、存檔、加一站、三顆鈕之後，不再相鄰的列刪掉；換整天的預設時今天這份行程的列全部刪掉。"""

    __tablename__ = "itinerary_leg"
    __table_args__ = (
        # 從辦公室出發的那段（from 是 NULL）也只能有一列
        UniqueConstraint("itinerary_id", "from_customer_id", "to_customer_id", postgresql_nulls_not_distinct=True),
        one_of("mode", LEG_MODES, "mode"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    itinerary_id: Mapped[int] = mapped_column(ForeignKey("itinerary.id", ondelete="CASCADE"))
    # NULL：從辦公室出發
    from_customer_id: Mapped[str | None] = mapped_column(ForeignKey("customer.id"))
    to_customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    mode: Mapped[str]


class RouteSnooze(Base):
    """「暫緩」「誤判」：這家到哪一天以前不排進每天的建議。原本存在手機上，改存伺服器。"""

    __tablename__ = "route_snooze"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"), primary_key=True)
    until: Mapped[dt.date]


class RouteSignalWeight(Base):
    """「插入下一站」加一、「誤判」減一：這類提醒在每天的建議裡排前面或後面一點（today_route.PERSONAL_STEP）。"""

    __tablename__ = "route_signal_weight"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    signal: Mapped[str] = mapped_column(primary_key=True)
    weight: Mapped[float] = mapped_column(server_default="0")


# 排序習慣的種類。precedence：A 排在 B 前面；first、last：排在其他站前面、後面；
# window：約的時段；duration：停留多久。前三種是一定要守的規則，後兩種是新增一站時的預設值
ROUTE_HABIT_KINDS = ("precedence", "first", "last", "window", "duration")
# 習慣從哪裡來。ai：在首頁跟熊熊滾說的；prompt：拖完或改完答應的；manual：在習慣頁自己新增的
ROUTE_HABIT_SOURCES = ("ai", "prompt", "manual")


class RouteHabit(Base):
    """業務自己的排序習慣，長期有效、可以限定星期幾（services/route_habits.py）。主管看不到。"""

    __tablename__ = "route_habit"
    __table_args__ = (
        one_of("kind", ROUTE_HABIT_KINDS, "kind"),
        one_of("source", ROUTE_HABIT_SOURCES, "source"),
        CheckConstraint("weekday IS NULL OR weekday BETWEEN 0 AND 6", name="weekday"),
        CheckConstraint("(kind = 'precedence') = (object IS NOT NULL)", name="object"),
        CheckConstraint("window_kind IS NULL OR window_kind IN ('at', 'before', 'after')", name="window_kind"),
        CheckConstraint("(kind = 'window') = (window_kind IS NOT NULL AND window_time IS NOT NULL)", name="window_pair"),
        CheckConstraint("(kind = 'duration') = (duration_minutes IS NOT NULL)", name="duration"),
        CheckConstraint("duration_minutes IS NULL OR duration_minutes > 0", name="duration_positive"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str]
    # {"by": "customer"／"chain"／"type"／"area", "value": ...}：客戶比 id、連鎖體系比 chain_group、類型比 type、地區比 area
    subject: Mapped[dict[str, Any]]
    # 只有 precedence 用：subject 那幾家要排在 object 那幾家前面
    object: Mapped[dict[str, Any] | None]
    window_kind: Mapped[str | None]
    window_time: Mapped[dt.time | None]
    duration_minutes: Mapped[int | None]
    # 0（星期一）～6（星期日），跟 Python 的 date.weekday() 一樣；NULL 是每天
    weekday: Mapped[int | None]
    # 給人看的一句話，由 route_habits.describe 依欄位產生，例如「康泰連鎖藥局的店排在診所前面」
    text: Mapped[str]
    source: Mapped[str]
    # 停用不刪
    active: Mapped[bool] = mapped_column(server_default=text("true"))
    # 兩條習慣衝突時新的優先
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class ItineraryProposal(Base):
    """跟熊熊滾說要怎麼排、「幫我排順一點」算出來的提案（services/itinerary_ai.py）。

    按「套用」時照 operations 在最新的行程上再做一次，不信前端傳來的內容；base_version 對不上就擋下來。
    只留最近 7 天（jobs/retention.py）。行程刪掉（IT 重置示範業務）時一起刪。
    """

    __tablename__ = "itinerary_proposal"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    itinerary_id: Mapped[int] = mapped_column(ForeignKey("itinerary.id", ondelete="CASCADE"), index=True)
    # 算提案時的行程版本
    base_version: Mapped[int]
    # 業務說的那句話；按鈕觸發的排順路是 NULL
    question: Mapped[str | None] = mapped_column(Text)
    # 驗證過的操作清單（AI 的輸出換成這位業務自己的客戶與習慣，不合的已經轉成 not_found）
    operations: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    # 對照卡的內容（api/itinerary.py 的 ProposalOut 照這個欄位回傳）
    result: Mapped[dict[str, Any]]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now(), index=True)

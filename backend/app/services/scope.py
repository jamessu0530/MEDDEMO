"""資料權限：誰看得到哪些資料。

組織是一棵樹（services/org.py），每個人有一條路徑，例如業務 U01 是 TW.N.M01.U01、
他的主管 M01 是 TW.N.M01。

可見範圍 = 把自己的路徑截到該種資料的共享層級深度，再看對方是不是在底下。
主管的路徑比較短、截不動，所以「主管看得到屬下」不必另外寫規則，是同一個式子的結果。

數字查詢的 SQL 是模型寫的，靠提示叫它「只查自己的」擋不住，所以過濾做在資料庫：
四個語意層 View 都用 app_in_scope() 過濾，路徑由 sql_executor 在每次查詢的交易裡設定。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import ColumnElement, Select, cast, literal, select, true
from sqlalchemy.orm import Session

from app.models import LTREE, AppUser, Customer, Visit

# 共享層級就是路徑深度（ltree 的 nlevel 從 1 起算）
ROOT = 1     # TW
REGION = 2   # TW.N
TEAM = 3     # TW.N.M01
SELF = 4     # TW.N.M01.U01

# 每一種資料看得多遠。改這裡要同步改 sql/semantic_layer.sql 裡各個 View 宣告的深度
SHARING_LEVEL = {
    "customer_basic": ROOT,   # 客戶名稱、類型、區、等級、負責人
    "sales_figures": REGION,  # 進貨金額、毛利、帳齡
    "visit_record": TEAM,     # 拜訪紀錄與逐字稿
    "quote": SELF,            # 報價、交易條件、議價卡
    "oa_form": SELF,          # 出差單
}


@dataclass(frozen=True)
class Scope:
    path: str | None = None
    # 代理之後的實際使用者。第三方登入的帳號看的是示範業務的資料（見 api/auth.py）
    acting_user_id: str | None = None

    @classmethod
    def everything(cls) -> Scope:
        """不過濾。只給評測、測試與背景排程用，API 一律用 for_user。"""
        return cls()

    @classmethod
    def for_user(cls, user: AppUser) -> Scope:
        acting = user.acts_as or user
        return cls(path=acting.org_path, acting_user_id=acting.id)

    def prefix(self, level: int) -> str | None:
        """自己的路徑截到 level 深度。已經比 level 淺就原樣回傳——主管就是靠這個涵蓋屬下。"""
        if self.path is None:
            return None
        return ".".join(self.path.split(".")[:level])

    def can_see(self, level: int, org_path: str | None) -> bool:
        prefix = self.prefix(level)
        if prefix is None:
            return True
        if org_path is None:
            return False
        return org_path == prefix or org_path.startswith(f"{prefix}.")

    def users_at(self, level: int) -> Select | None:
        """這個層級底下有哪些人。None 代表不過濾。"""
        prefix = self.prefix(level)
        if prefix is None:
            return None
        # <@ 是「是……的子孫或自己」
        return select(AppUser.id).where(AppUser.org_path.bool_op("<@")(cast(literal(prefix), LTREE)))

    def customers_at(self, level: int) -> ColumnElement[bool]:
        """加在 where 上，依客戶負責人的位置過濾。查詢裡要有 Customer。"""
        users = self.users_at(level)
        return true() if users is None else Customer.owner_user_id.in_(users)

    def visits_at(self, level: int) -> ColumnElement[bool]:
        """加在 where 上，依做這次拜訪的業務過濾。查詢裡要有 Visit。"""
        users = self.users_at(level)
        return true() if users is None else Visit.user_id.in_(users)


def owner_path(session: Session, customer: Customer | None) -> str | None:
    """客戶負責人在組織樹上的位置。客戶不存在就回 None，呼叫端一律當作看不到。"""
    if customer is None:
        return None
    owner = session.get(AppUser, customer.owner_user_id)
    return owner.org_path if owner else None

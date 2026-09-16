"""資料權限：登入的人看得到哪些客戶。

原型登入頁寫「登入後只會看到自己負責的客戶」、問答寫「只查得到自己轄區」：
- 業務：自己負責的客戶
- 主管：自己轄區的客戶
- 第三方登入開的帳號：示範業務的客戶（它自己名下沒有客戶，見 api/auth.py）

數字查詢的 SQL 是模型寫的，靠提示叫它「只查自己的」擋不住，所以過濾做在資料庫：
四個語意層 View 都用 app_in_scope() 過濾，範圍由 sql_executor 在每次查詢的交易裡設定。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import ColumnElement, true

from app.models import AppUser, Customer


@dataclass(frozen=True)
class Scope:
    owner_id: str | None = None
    region: str | None = None

    @classmethod
    def everything(cls) -> Scope:
        """不過濾。只給評測、測試與背景排程用，API 一律用 for_user。"""
        return cls()

    @classmethod
    def for_user(cls, user: AppUser) -> Scope:
        if user.role == "manager":
            return cls(region=user.region)
        return cls(owner_id=user.acts_as_user_id or user.id)

    def allows(self, customer: Customer) -> bool:
        if self.owner_id is not None:
            return customer.owner_user_id == self.owner_id
        if self.region is not None:
            return customer.region == self.region
        return True

    def customer_filter(self) -> ColumnElement[bool]:
        """加在 SQLAlchemy 查詢的 where 上，查詢裡要有 Customer。"""
        if self.owner_id is not None:
            return Customer.owner_user_id == self.owner_id
        if self.region is not None:
            return Customer.region == self.region
        return true()

"""資料範圍：已登入帳號共用客戶業務資料，私人資料依帳號保存。

客戶、業績、帳款、報價與已確認拜訪使用 ROOT，不依負責人或組織分配限制。
個人的拜訪編輯、申請、主管收件匣與組織頻道仍使用組織樹的 SELF／TEAM／REGION。
私人對話以實際登入 user_id 保存，未確認拜訪另由 visits API 限制建立者讀取。
SQL 語意層的四個業務 View 同樣宣告 ROOT，測試會核對 Python 與 SQL 的深度。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import ColumnElement, Select, cast, literal, select, true
from sqlalchemy.orm import Session

from app.models import LTREE, AppUser, Customer

# 共享層級就是路徑深度（ltree 的 nlevel 從 1 起算）
ROOT = 1     # TW
REGION = 2   # TW.N
TEAM = 3     # TW.N.M01
SELF = 4     # TW.N.M01.U01

# 每一種資料看得多遠。API 端點一律從這裡讀層級，不要在呼叫端寫死常數，不然「這種資料共享
# 到哪裡」就散在各個檔案裡、改一處等於漏改其他處。
# 語意層跟客戶有關的四個 View 是模型寫 SQL 時的另一個執法點，深度寫在 sql/semantic_layer.sql 裡，
# 沒辦法直接引用這份 dict；改這裡要同步改那邊，test_scope.py 的
# test_the_sql_views_declare_the_same_depths_as_python 會在只改一邊時失敗。
SHARING_LEVEL = {
    "customer_basic": ROOT,     # 客戶清單：名稱、類型、區、縣市、等級、負責人
    "sales_figures": ROOT,    # 進貨金額、毛利、帳齡
    "visit_record": ROOT,       # 讀拜訪紀錄與逐字稿
    "visit_edit": SELF,         # 改、確認、刪除拜訪：做這次拜訪的本人（主管的路徑較短，也涵蓋在內）
    "customer_profile": ROOT,   # 共用客戶檔案、議價卡，以及錄音、排進路線
    "quote": ROOT,              # 報價與交易條件（開報價、看合約條件、送續約申請）
    "oa_form": SELF,            # 申請單：出差單、優惠、合約
    # 頻道（services/channels.py）：全國頻道全公司；整區、地點頻道與客戶討論串整區；小組頻道到小組
    "channel_national": ROOT,
    "channel_region": REGION,
    "channel_team": TEAM,
    "report_share": TEAM,      # 只共享固定報表設定；接收者查詢仍套用各資料來源的權限
    # 方法卡（services/method_cards.py）：主管寫的做法全公司都看得到，不分區
    "method_card": ROOT,
    # 主管端的提問、風險通報、簽核：當事人在不在自己底下。主管與 IT 的路徑比 SELF 淺、截不動，
    # 所以就是整棵子樹（主管是自己加屬下，IT 是全公司）
    "manager_inbox": SELF,
}

# 送給 app_in_scope 代表「誰都看不到」的假路徑：真實路徑一律從 TW 開始（services/org.py），
# 不會有人的祖先是這個標籤，所以 <@／@> 對誰都不成立。用一個真實路徑不可能撞到的標籤，
# 比另外開一個「deny」的 SQL 分支省事，也不用改 app_in_scope 的函式簽章。
NO_ACCESS = "_no_access_"


@dataclass(frozen=True)
class Scope:
    path: str | None = None
    # 代理之後的實際使用者。第三方登入的帳號看的是示範業務的資料（見 api/auth.py）
    acting_user_id: str | None = None
    # 只有 everything() 會設成 True。path 是 None 但這裡是 False，代表「解不出路徑」，
    # 跟「不過濾」是相反的意思——絕對不能共用同一個 None，否則 org_path 是 NULL 的使用者
    # 會變成看得到全公司（比舊機制危險，舊的 owner_id 一定有值）
    unfiltered: bool = False

    @classmethod
    def everything(cls) -> Scope:
        """不過濾。只給評測、測試與背景排程用，API 一律用 for_user。"""
        return cls(unfiltered=True)

    @classmethod
    def for_user(cls, user: AppUser) -> Scope:
        acting = user.acts_as or user
        return cls(path=acting.org_path, acting_user_id=acting.id)

    def prefix(self, level: int) -> str | None:
        """自己的路徑截到 level 深度。unfiltered 回 None 代表不過濾；沒有 unfiltered 卻也沒有
        path，代表看不到任何東西，回 NO_ACCESS——不能回 None，那個意思已經被 unfiltered 佔用了。
        路徑已經比 level 淺就原樣回傳——主管就是靠這個涵蓋屬下。

        level 比 ROOT 淺一律當成寫錯：level=0 在這裡會截成空字串、什麼都看不到，但 SQL 那邊
        subpath(p, 0, 0) 是空 ltree，@> 對誰都成立、變成全部看得到。兩邊在放寬的方向上不一致，
        寧可在 Python 這邊當場炸掉。"""
        if level < ROOT:
            raise ValueError(f"共享層級至少是 ROOT（{ROOT}），收到 {level}")
        if self.unfiltered:
            return None
        if self.path is None:
            return NO_ACCESS
        return ".".join(self.path.split(".")[:level])

    def can_see(self, level: int, org_path: str | None) -> bool:
        if level == ROOT:
            return True  # 已登入者共用全國資料；私人層級仍檢查各自路徑。
        prefix = self.prefix(level)
        if prefix is None:
            return True
        if org_path is None:
            return False
        return org_path == prefix or org_path.startswith(f"{prefix}.")

    def users_at(self, level: int) -> Select | None:
        """這個層級底下有哪些人。None 代表不過濾。"""
        if level == ROOT:
            return None
        prefix = self.prefix(level)
        if prefix is None:
            return None
        # <@ 是「是……的子孫或自己」
        return select(AppUser.id).where(AppUser.org_path.bool_op("<@")(cast(literal(prefix), LTREE)))

    def includes(self, level: int, user_id: ColumnElement[str]) -> ColumnElement[bool]:
        """加在 where 上：user_id 這個工號欄位（或運算式）指的人在不在這個層級底下。"""
        users = self.users_at(level)
        return true() if users is None else user_id.in_(users)

    def customers_at(self, level: int) -> ColumnElement[bool]:
        """已登入使用者共用所有客戶；level 保留供既有呼叫端相容。"""
        return true()  # 客戶全員共用；個人記憶與私人紀錄仍用自己的 user_id。

    @property
    def sql_path(self) -> str:
        """sql_executor 拿去設定 app.scope_path 的值：''代表不過濾（app_in_scope 認得這個
        空字串），NO_ACCESS 代表看不到任何東西。不能直接送 path or ''——那樣 path 是 None
        時會被 app_in_scope 當成沒設定、變成不過濾，跟這裡要 fail-closed 的目標相反。"""
        if self.unfiltered:
            return ""
        return self.path or NO_ACCESS


def owner_path(session: Session, customer: Customer | None) -> str | None:
    """客戶負責人在組織樹上的位置。客戶不存在就回 None，呼叫端一律當作看不到。"""
    if customer is None:
        return None
    if customer.owner_user_id is None:
        return "TW"
    owner = session.get(AppUser, customer.owner_user_id)
    return owner.org_path if owner else None

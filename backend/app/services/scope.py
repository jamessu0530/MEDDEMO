"""資料權限：誰看得到哪些資料。

組織是一棵樹（services/org.py），每個人有一條路徑，例如業務 U01 是 TW.N.M01.U01、
他的主管 M01 是 TW.N.M01。

可見範圍 = 把自己的路徑截到該種資料的共享層級深度，再看對方是不是在底下。
主管的路徑比較短、截不動，所以「主管看得到屬下」不必另外寫規則，是同一個式子的結果。
IT 坐在根節點上、路徑就是 TW，截到哪一層都是 TW，全公司看得到也動得了，也是同一個式子。

數字查詢的 SQL 是模型寫的，靠提示叫它「只查自己的」擋不住，所以過濾做在資料庫：
跟客戶有關的四個語意層 View 都用 app_in_scope() 過濾，路徑由 sql_executor 在每次查詢的交易裡設定
（促銷的兩個 View 不分客戶，全公司共用，不過濾）。

org_path 是 nullable 欄位（models.py），for_user() 解出的路徑理論上可能是 None。這跟
「不過濾」的意思完全相反，不能共用同一個 None：只有 everything() 會把 unfiltered 設成
True；for_user() 解不出路徑就是看不到任何東西，靠 NO_ACCESS 這個不會是任何人祖先的假
路徑做到，can_see／users_at 不必另外判斷一次。
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
    "sales_figures": REGION,    # 進貨金額、毛利、帳齡
    "visit_record": TEAM,       # 讀拜訪紀錄與逐字稿
    "visit_edit": SELF,         # 改、確認、刪除拜訪：做這次拜訪的本人（主管的路徑較短，也涵蓋在內）
    "customer_profile": SELF,   # 客戶檔案、議價卡，以及對這家客戶做事（錄音、排進路線）
    "quote": SELF,              # 報價與交易條件（開報價、看合約條件、送續約申請）
    "oa_form": SELF,            # 申請單：出差單、優惠、合約
    # 頻道（services/channels.py）：全國頻道全公司；整區、地點頻道與客戶討論串整區；小組頻道到小組
    "channel_national": ROOT,
    "channel_region": REGION,
    "channel_team": TEAM,
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

    def includes(self, level: int, user_id: ColumnElement[str]) -> ColumnElement[bool]:
        """加在 where 上：user_id 這個工號欄位（或運算式）指的人在不在這個層級底下。"""
        users = self.users_at(level)
        return true() if users is None else user_id.in_(users)

    def customers_at(self, level: int) -> ColumnElement[bool]:
        """加在 where 上，依客戶負責人的位置過濾。查詢裡要有 Customer。"""
        return self.includes(level, Customer.owner_user_id)

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
    owner = session.get(AppUser, customer.owner_user_id)
    return owner.org_path if owner else None

"""組織樹。

manager_id 與 unit_id 是真相來源，org_path 與 region 是算出來的衍生值：
主管掛在區上、IT 掛在根節點上（unit_id），業務接在主管後面（manager_id）。

樹只有十幾個節點，任何變動就整棵重算，不做增量更新。灌資料與組織管理頁（services/org_admin.py）
都走這裡，所以這裡也是「這棵樹合不合規則」唯一的檢查點。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, OrgUnit
from app.services.scope import REGION, SELF


def paths_from_reports(
    unit_kinds: dict[str, str], reports: dict[str, tuple[str, str | None, str | None]]
) -> dict[str, str | None]:
    """純函式：只認地理節點的種類與每個人的 (role, manager_id, unit_id)，不碰 Session。

    seed.py 灌 app_user 那筆 INSERT 就得帶著算好的 org_path：org_position 約束是一般
    CHECK 約束，Postgres 不支援延遲檢查，沒有「先插入、稍後用 rebuild_org_paths 補上」的空間。
    這裡跟 rebuild_org_paths 共用同一套演算法，只是資料來源換成灌資料前的原始 dict。

    位置跟著角色，不合就丟 ValueError 並點名是誰：
    - IT 掛在根節點上，路徑就是根節點本身、只有一層。截到任何共享層級都還是根，全公司都在底下——
      跟「主管看得到屬下」是同一個式子（services/scope.py），不必另外寫一條規則。
    - 主管掛在區上，路徑是「區.工號」。
    - 業務接在一位主管後面，路徑是「主管的路徑.工號」。
    - 三個都空的是自建與第三方登入的帳號，不在樹上。

    樹最深只到 SELF（第四層）。共享層級就是路徑深度，多掛一層的人截到 SELF 會剛好等於他上面那個人
    的路徑，於是看得到對方的報價、議價卡與客戶檔案——權限往上漏。上面三條規則已經讓樹長不到第五層，
    深度檢查留著當最後一道防線：規則哪天被放寬了，這裡還會當場失敗，不會默默灌進去。
    """
    resolved: dict[str, str | None] = {}

    def path_of(user_id: str, seen: frozenset[str]) -> str | None:
        if user_id in resolved:
            return resolved[user_id]
        if user_id in seen:
            raise ValueError(f"組織有循環：{user_id}")
        role, manager_id, unit_id = reports[user_id]
        if manager_id is None and unit_id is None:
            path = None
        elif manager_id is None:
            kind = unit_kinds.get(unit_id)
            if role == "it" and kind == "root":
                path = unit_id
            elif role == "manager" and kind == "region":
                path = f"{unit_id}.{user_id}"
            else:
                raise ValueError(f"{user_id}（{role}）不能掛在 {unit_id} 上：主管掛在區上，IT 掛在根節點上")
        else:
            if role != "sales":
                raise ValueError(f"{user_id}（{role}）不能接在別人後面，只有業務有直屬主管")
            if manager_id not in reports:
                raise ValueError(f"{manager_id} 不在組織裡，{user_id} 的路徑算不出來")
            if reports[manager_id][0] != "manager":
                raise ValueError(f"{user_id} 的主管 {manager_id} 不是主管")
            path = f"{path_of(manager_id, seen | {user_id})}.{user_id}"
        if path is not None and len(path.split(".")) > SELF:
            raise ValueError(f"{user_id} 的組織路徑 {path} 有 {len(path.split('.'))} 層，最多只能到第 {SELF} 層")
        resolved[user_id] = path
        return path

    for user_id in reports:
        path_of(user_id, frozenset())
    return resolved


def region_of(path: str | None, unit_names: dict[str, str]) -> str | None:
    """路徑所在的那一區的名稱：取前兩層對到的地理節點。IT 只有一層，就是根節點的名稱（全國）。"""
    if path is None:
        return None
    return unit_names[".".join(path.split(".")[:REGION])]


def rebuild_org_paths(session: Session) -> None:
    """依回報線重算每個帳號的 org_path 與 region，順便驗證整棵樹。

    還沒寫進資料庫的新帳號（組織管理頁新增的）也一起算：org_position 約束要求寫入時路徑就得有值，
    所以整段不讓 session 自動 flush，全部算好再一起寫。
    自建帳號不在樹上，region 跟著他代理的那位業務。
    """
    with session.no_autoflush:
        units = session.scalars(select(OrgUnit)).all()
        users = {user.id: user for user in session.scalars(select(AppUser)).all()}
        users |= {user.id: user for user in session.new if isinstance(user, AppUser)}
        paths = paths_from_reports(
            {unit.id: unit.kind for unit in units},
            {uid: (u.role, u.manager_id, u.unit_id) for uid, u in users.items()},
        )
        names = {unit.id: unit.name for unit in units}
        for uid, user in users.items():
            user.org_path = paths[uid]
            if paths[uid] is not None:
                user.region = region_of(paths[uid], names)
        for user in users.values():
            if user.org_path is None and user.acts_as_user_id in users:
                user.region = users[user.acts_as_user_id].region
    session.flush()

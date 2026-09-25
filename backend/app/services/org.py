"""組織樹。

manager_id 與 unit_id 是真相來源，org_path 是算出來的衍生值：
經理掛在地理節點上（unit_id），業務接在主管後面（manager_id）。

樹只有十幾個節點，任何變動就整棵重算，不做增量更新。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, OrgUnit
from app.services.scope import SELF


def paths_from_reports(
    unit_ids: set[str], reports: dict[str, tuple[str | None, str | None]]
) -> dict[str, str | None]:
    """純函式：只認 id、manager_id、unit_id，不碰 Session。

    seed.py 灌 app_user 那筆 INSERT 就得帶著算好的 org_path：org_position 約束是一般
    CHECK 約束，Postgres 不支援延遲檢查，沒有「先插入、稍後用 rebuild_org_paths 補上」的空間。
    這裡跟 rebuild_org_paths 共用同一套演算法，只是資料來源換成灌資料前的原始 dict。

    樹最深只到 SELF（第四層）。共享層級就是路徑深度（services/scope.py），多掛一層的人截到
    SELF 會剛好等於他主管的路徑，於是看得到主管的報價、議價卡與客戶檔案——權限往上漏。
    整個設計只在「每個葉節點都剛好四層」時成立，所以組織一長出第五層就當場失敗，不要默默灌進去。
    """
    resolved: dict[str, str | None] = {}

    def path_of(user_id: str, seen: frozenset[str]) -> str | None:
        if user_id in resolved:
            return resolved[user_id]
        if user_id in seen:
            raise ValueError(f"組織有循環：{user_id}")
        manager_id, unit_id = reports[user_id]
        if manager_id is None and unit_id is None:
            path = None
        elif manager_id is None:
            path = f"{unit_id}.{user_id}"
        else:
            above = path_of(manager_id, seen | {user_id})
            if above is None:
                raise ValueError(f"{manager_id} 不在組織裡，{user_id} 的路徑算不出來")
            path = f"{above}.{user_id}"
        if path is not None and len(path.split(".")) > SELF:
            raise ValueError(f"{user_id} 的組織路徑 {path} 有 {len(path.split('.'))} 層，最多只能到第 {SELF} 層")
        resolved[user_id] = path
        return path

    for user_id in reports:
        path_of(user_id, frozenset())
    return resolved


def rebuild_org_paths(session: Session) -> None:
    """依回報線重算每個帳號的 org_path。三個欄位都空的帳號（代理別人的）維持 None。"""
    unit_ids = {unit.id for unit in session.scalars(select(OrgUnit)).all()}
    users = {user.id: user for user in session.scalars(select(AppUser)).all()}
    reports = {uid: (u.manager_id, u.unit_id) for uid, u in users.items()}
    paths = paths_from_reports(unit_ids, reports)
    for uid, user in users.items():
        user.org_path = paths[uid]
    session.flush()

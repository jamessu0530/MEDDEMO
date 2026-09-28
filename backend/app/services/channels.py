"""頻道：誰看得到哪些頻道、頻道叫什麼、訊息與未讀（docs/superpowers/specs/2026-09-28-channels-design.md）。

頻道不存路徑，只記屬於誰（區、主管、地點、客戶），路徑每次從組織樹現算：
全國與整區是地理節點本身，小組是主管的 org_path，地點與客戶討論串是地點所在的那一區。
看不看得到跟客戶、拜訪同一個式子：Scope.can_see(共享層級, 頻道路徑)，不另外寫規則。

頻道總共二十幾個，加上有人打開過的客戶討論串，整批讀進來在 Python 裡算，不必寫成 SQL。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AppUser, Channel, Customer, OrgUnit, Place
from app.services.scope import SELF, SHARING_LEVEL, Scope

# 頻道列表的區順序，跟組織管理頁一樣由北到南
REGION_ORDER = ("TW.N", "TW.C", "TW.S")
KIND_ORDER = ("national", "region", "team", "place", "customer")
LEVEL = {
    "national": SHARING_LEVEL["channel_national"],
    "region": SHARING_LEVEL["channel_region"],
    "team": SHARING_LEVEL["channel_team"],
    "place": SHARING_LEVEL["channel_region"],
    "customer": SHARING_LEVEL["channel_region"],
}


class NotFound(Exception):
    """頻道不存在，或登入者看不到。API 一律回 404，不透露它存在。"""


class Archived(Exception):
    """小組頻道的主管已經不是在職主管：只能看，不能發言。"""


@dataclass(frozen=True)
class ChannelInfo:
    id: int
    kind: str
    name: str
    # 組織樹上的路徑，算看不看得到用。封存的小組頻道是 None
    path: str | None
    # 所在的區（地理節點 id），頻道列表依這個分組；全國與封存的頻道是 None
    region_id: str | None
    # 上層頻道：客戶討論串 → 地點 → 整區 → 全國；小組 → 整區
    parent_id: int | None
    archived: bool
    customer_id: str | None
    # 輸入框上的提示：誰看得到這裡的訊息
    audience: str
    # 客戶討論串的負責人路徑：負責人與他的主管一定看得到自己客戶的討論串
    owner_path: str | None = None


def ensure_channels(session: Session) -> None:
    """補上缺的全國、整區、地點與小組頻道，可以重複呼叫。灌資料與每次組織異動後呼叫（services/org_admin.py）。
    客戶討論串不在這裡建：第一次有人打開才建（customer_thread）。"""
    have_units = set(session.scalars(select(Channel.unit_id).where(Channel.unit_id.is_not(None))))
    for unit in session.scalars(select(OrgUnit)):
        if unit.id not in have_units:
            session.add(Channel(kind="national" if unit.kind == "root" else "region", unit_id=unit.id))
    have_places = set(session.scalars(select(Channel.place_id).where(Channel.place_id.is_not(None))))
    for place_id in session.scalars(select(Place.id)):
        if place_id not in have_places:
            session.add(Channel(kind="place", place_id=place_id))
    have_teams = set(session.scalars(select(Channel.manager_id).where(Channel.manager_id.is_not(None))))
    for manager_id in session.scalars(select(AppUser.id).where(AppUser.role == "manager")):
        if manager_id not in have_teams:
            session.add(Channel(kind="team", manager_id=manager_id))
    session.flush()


def describe(session: Session, channels: list[Channel]) -> list[ChannelInfo]:
    """算出每個頻道的名稱、路徑、所在的區與上層，順序跟傳進來的一樣。"""
    units = {u.id: u for u in session.scalars(select(OrgUnit))}
    places = {p.id: p for p in session.scalars(select(Place))}
    by_unit = dict(session.execute(select(Channel.unit_id, Channel.id).where(Channel.unit_id.is_not(None))).all())
    by_place = dict(session.execute(select(Channel.place_id, Channel.id).where(Channel.place_id.is_not(None))).all())
    root = next(u.id for u in units.values() if u.kind == "root")
    manager_ids = {c.manager_id for c in channels if c.manager_id}
    managers = {u.id: u for u in session.scalars(select(AppUser).where(AppUser.id.in_(manager_ids)))}
    customer_ids = {c.customer_id for c in channels if c.customer_id}
    customers = {
        customer.id: (customer, owner_path)
        for customer, owner_path in session.execute(
            select(Customer, AppUser.org_path)
            .join(AppUser, AppUser.id == Customer.owner_user_id)
            .where(Customer.id.in_(customer_ids))
        )
    }

    def everyone_in(unit_id: str) -> str:
        return f"{units[unit_id].name}所有人都看得到"

    infos = []
    for c in channels:
        if c.kind in ("national", "region"):
            unit = units[c.unit_id]
            if unit.kind == "root":
                infos.append(ChannelInfo(c.id, c.kind, unit.name, unit.id, None, None, False, None, "全公司都看得到"))
            else:
                infos.append(ChannelInfo(c.id, c.kind, unit.name, unit.id, unit.id, by_unit[root], False, None, everyone_in(unit.id)))
        elif c.kind == "team":
            manager = managers[c.manager_id]
            name = f"{manager.name}小組"
            if manager.role != "manager" or manager.deactivated_at is not None:
                infos.append(ChannelInfo(c.id, "team", name, None, None, None, True, None, "已封存，只有 IT 看得到"))
            else:
                infos.append(ChannelInfo(
                    c.id, "team", name, manager.org_path, manager.unit_id, by_unit[manager.unit_id], False, None,
                    f"只有{name}看得到",
                ))
        elif c.kind == "place":
            place = places[c.place_id]
            infos.append(ChannelInfo(
                c.id, "place", place.name, place.unit_id, place.unit_id, by_unit[place.unit_id], False, None,
                everyone_in(place.unit_id),
            ))
        else:
            customer, owner_path = customers[c.customer_id]
            place = places[customer.place_id]
            infos.append(ChannelInfo(
                c.id, "customer", customer.name, place.unit_id, place.unit_id, by_place[place.id], False,
                customer.id, everyone_in(place.unit_id), owner_path,
            ))
    return infos


def can_see(user: AppUser, info: ChannelInfo) -> bool:
    if info.archived:
        # 主管已經不在，組員也都換到別組了，留給 IT 查
        return user.role == "it"
    scope = Scope.for_user(user)
    if info.path is not None and scope.can_see(LEVEL[info.kind], info.path):
        return True
    # IT 可以把客戶交給別區的業務（org_admin.reassign_customer 不限區），那位業務截到整區看不到這個地點
    return info.kind == "customer" and scope.can_see(SELF, info.owner_path)


def _order(info: ChannelInfo) -> tuple[int, int, int, str, int]:
    group = 0 if info.kind == "national" else 2 if info.archived else 1
    region = REGION_ORDER.index(info.region_id) if info.region_id in REGION_ORDER else len(REGION_ORDER)
    # 地點照名稱排，台北市的行政區會排在一起；其他照建立的先後
    name = info.name if info.kind == "place" else ""
    return (group, region, KIND_ORDER.index(info.kind), name, info.id)


def visible_channels(session: Session, user: AppUser) -> list[ChannelInfo]:
    """看得到的頻道，不含客戶討論串（太多了，從地點頻道或客戶檔案進去）。
    全國在最前面，接著各區由北到南（整區、小組、地點），封存的在最後。"""
    rows = list(session.scalars(select(Channel).where(Channel.kind != "customer")))
    return sorted((info for info in describe(session, rows) if can_see(user, info)), key=_order)


def get_channel(session: Session, user: AppUser, channel_id: int) -> ChannelInfo:
    channel = session.get(Channel, channel_id)
    if channel is None:
        raise NotFound
    info = describe(session, [channel])[0]
    if not can_see(user, info):
        raise NotFound
    return info


def customer_thread(session: Session, user: AppUser, customer_id: str) -> ChannelInfo:
    """這家客戶的討論串，沒有就建一個。看不到的一樣丟 NotFound；呼叫端沒有 commit，剛建的也不會留下。"""
    channel = session.scalar(select(Channel).where(Channel.customer_id == customer_id))
    if channel is None:
        if session.get(Customer, customer_id) is None:
            raise NotFound
        channel = Channel(kind="customer", customer_id=customer_id)
        try:
            with session.begin_nested():
                session.add(channel)
        except IntegrityError:
            # 兩個人同時第一次打開：對方先建好了，拿他建的那一個
            channel = session.scalar(select(Channel).where(Channel.customer_id == customer_id))
    info = describe(session, [channel])[0]
    if not can_see(user, info):
        raise NotFound
    return info

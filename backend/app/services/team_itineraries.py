"""主管端的行程分頁（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈主管端：行程分頁〉）。

主管看自己底下的業務，IT 看全公司，跟 api/manager.py 同一個範圍（SHARING_LEVEL["manager_inbox"]）；只能看、只看今天。
業務今天還沒打開首頁時，主管一讀就照第一次讀取的規則建好行程（itinerary.get_or_create）。
行程怎麼存、怎麼排時間都在 services/itinerary.py，這裡只讀它的結果，再加上地圖要的座標與沿路的線，
以及跟系統早上的建議（Itinerary.suggested）比改了什麼。
位置那一行（services/locations.describe）也在這裡組：今天的站與這位業務的客戶地區。
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Itinerary, UserLocation
from app.services import customer_profile, locations, travel
from app.services import itinerary as itineraries
from app.services.scope import SHARING_LEVEL, Scope
from app.services.today_route import SIGNAL_LABEL


@dataclass
class MapStop:
    number: int  # 第幾站（1 起算，已完成的在前）
    customer_id: str
    customer_name: str
    area: str
    lat: float
    lng: float
    status: str  # done／next／todo
    planned_time: str  # 已完成的是拜訪時間，其他是排出來的到達時間
    duration_minutes: int
    late_minutes: int
    source: str
    signal: str
    reason: str
    window_kind: str | None  # 約的時間：at 幾點到、before 幾點以前、after 幾點以後
    window_time: str | None  # HH:MM


@dataclass
class RemovedStop:
    """系統早上排了、現在不在行程裡的站（業務拿掉或暫緩的）。"""

    customer_id: str
    customer_name: str
    area: str
    lat: float
    lng: float
    label: str  # 系統排它的理由類別（「帳款逾期」）
    reason: str


@dataclass
class Leg:
    polyline: str | None  # Google 的編碼折線；沒有（沒設金鑰、Google 失敗）就畫直線
    done: bool  # 這一段開到的那一站已經跑完：地圖上畫深色


@dataclass
class RepRoute:
    rep: AppUser
    view: itineraries.ItineraryView
    origin: travel.Point | None  # 區處辦公室；還沒有位置的區是 None，路線從第一站畫起
    stops: list[MapStop]
    legs: list[Leg]  # 從出發點（或第一站）一段一段開到最後一站
    removed: list[RemovedStop]
    added: list[str]  # 自己加的（店名）
    moved: list[str]  # 「德安藥局提到佑生藥局前面」
    untouched: bool  # 照系統建議，還沒動過
    location: locations.Seen  # 主管看到的位置那一行，加上地圖上頭像畫在哪


def reps(session: Session, viewer: AppUser) -> list[AppUser]:
    """看得到的業務：主管是自己底下的人，IT 是全公司。
    代理示範業務的帳號（第三方登入）不列，他們看的就是示範業務那一份；停用的人也不列。"""
    return list(session.scalars(
        select(AppUser)
        .where(
            AppUser.role == "sales",
            AppUser.acts_as_user_id.is_(None),
            AppUser.deactivated_at.is_(None),
            Scope.for_user(viewer).includes(SHARING_LEVEL["manager_inbox"], AppUser.id),
        )
        .order_by(AppUser.id)
    ))


def find_rep(session: Session, viewer: AppUser, user_id: str) -> AppUser | None:
    return next((rep for rep in reps(session, viewer) if rep.id == user_id), None)


def route(session: Session, rep: AppUser) -> RepRoute:
    """一位業務今天的行程，給地圖與清單用；今天還沒有就照模型的建議建一份。"""
    itinerary = itineraries.get_or_create(session, rep.id)
    view = itineraries.view(session, itinerary)
    suggested = itinerary.suggested or []
    current_ids = [s.customer_id for s in view.stops]
    suggested_ids = [item["customer_id"] for item in suggested]
    customers = _customers(session, current_ids + suggested_ids)
    stops = [_map_stop(n + 1, stop, customers[stop.customer_id]) for n, stop in enumerate(view.stops)]

    # 跟 itinerary._start 同一個出發點
    origin = itineraries.office(session, rep)
    path = ([origin] if origin else []) + [(s.lat, s.lng) for s in stops]
    found = travel.lines(path)
    # 第 n 段開到 path 的第 n + 1 點：有辦公室時就是第 n 站，沒有時是第 n + 1 站
    ends = stops if origin else stops[1:]
    legs = [Leg(polyline=found[n] if found else None, done=end.status == "done") for n, end in enumerate(ends)]

    on_route = set(current_ids)
    removed = [_removed(customers[item["customer_id"]], item) for item in suggested if item["customer_id"] not in on_route]
    in_suggestion = set(suggested_ids)
    added = [s.customer_name for s in view.stops if s.customer_id not in in_suggestion]
    moved = moved_sentences(suggested_ids, current_ids, {cid: short_name(c) for cid, c in customers.items()})
    location = describe_location(session, rep, [
        locations.StopPoint(s.number, _short(s.customer_name, s.area), s.lat, s.lng, s.status == "done") for s in stops
    ])
    return RepRoute(
        rep=rep, view=view, origin=origin, stops=stops, legs=legs, removed=removed, added=added, moved=moved,
        untouched=itinerary.version == 1 and not removed and not added and not moved,
        location=location,
    )


def moved_sentences(suggested: list[str], current: list[str], names: dict[str, str]) -> list[str]:
    """兩邊都有的站裡，順序改過的那幾家各一句：「德安藥局提到佑生藥局前面」「和平藥局移到康泰 · 忠孝店後面」。

    留在原本相對順序裡最多的那一串當作沒動（最長遞增子序列；一樣長時留後面的），其他的就是被移動的。
    往前移的找現在排在它後面、原本在它前面的第一家；往後移的找現在排在它前面、原本在它後面的最後一家。"""
    rank = {cid: n for n, cid in enumerate(suggested)}
    common = [cid for cid in current if cid in rank]
    order = [rank[cid] for cid in common]
    length = [1] * len(order)
    previous = [-1] * len(order)
    for i in range(len(order)):
        for j in range(i):
            # >=：一樣長時接在後面那一家，留下的那一串偏後面，句子就會講「提到誰前面」
            if order[j] < order[i] and length[j] + 1 >= length[i]:
                length[i], previous[i] = length[j] + 1, j
    kept: set[int] = set()
    if order:
        i = max(range(len(order)), key=lambda k: (length[k], k))
        while i != -1:
            kept.add(i)
            i = previous[i]
    sentences = []
    for i, cid in enumerate(common):
        if i in kept:
            continue
        later = [k for k in range(i + 1, len(common)) if order[k] < order[i]]
        if later:
            sentences.append(f"{names[cid]}提到{names[common[later[0]]]}前面")
        else:
            earlier = [k for k in range(i) if order[k] > order[i]]
            sentences.append(f"{names[cid]}移到{names[common[earlier[-1]]]}後面")
    return sentences


def describe_location(session: Session, rep: AppUser, stops: list[locations.StopPoint]) -> locations.Seen:
    """這位業務現在在哪，一句話（卡片與詳細的那一行）。"""
    return locations.describe(
        locations.now(), locations.share_hours(), session.get(UserLocation, rep.id), stops, _areas(session, rep)
    )


def locations_now(session: Session, viewer: AppUser) -> dict[str, locations.Seen]:
    """看得到的每位業務現在在哪。主管頁收到位置事件時只拿這個：不重算行程的時間與車程，也不問 Google。"""
    today = customer_profile.app_today(session)
    return {rep.id: describe_location(session, rep, _stop_points(session, rep, today)) for rep in reps(session, viewer)}


def _stop_points(session: Session, rep: AppUser, today: dt.date) -> list[locations.StopPoint]:
    """今天的站，站號跟 itinerary.view 一樣（itinerary.stop_order）。今天還沒有行程就是沒有站。"""
    itinerary = session.scalar(select(Itinerary).where(Itinerary.user_id == rep.id, Itinerary.date == today))
    if itinerary is None:
        return []
    ordered = itineraries.stop_order(session, itinerary)
    return [
        locations.StopPoint(n + 1, _short(customer.name, customer.area), customer.lat, customer.lng, finished)
        for n, (customer, finished) in enumerate(ordered)
    ]


def _areas(session: Session, rep: AppUser) -> list[locations.AreaPoint]:
    """這位業務每一家客戶的位置與地區：「最後位置 10:41，在內湖區」用。"""
    rows = session.execute(
        select(Customer.lat, Customer.lng, Customer.area, Customer.city).where(Customer.owner_user_id == rep.id)
    )
    return [locations.AreaPoint(lat, lng, locations.area_label(area, city)) for lat, lng, area, city in rows]


def short_name(customer: Customer) -> str:
    """店名去掉後面的地區（「杏林診所 · 大安」→「杏林診所」）；連鎖分店的「康泰 · 忠孝店」後面是分店，不去掉。"""
    return _short(customer.name, customer.area)


def _short(name: str, area: str) -> str:
    return name.removesuffix(f" · {area}")


def _customers(session: Session, ids: list[str]) -> dict[str, Customer]:
    return {c.id: c for c in session.scalars(select(Customer).where(Customer.id.in_(ids)))} if ids else {}


def _map_stop(number: int, stop: itineraries.StopView, customer: Customer) -> MapStop:
    # 一個一個欄位抄：StopView 還有業務自己的備註、鎖定與套用的習慣，不給主管看
    return MapStop(
        number=number, customer_id=stop.customer_id, customer_name=stop.customer_name, area=customer.area,
        lat=customer.lat, lng=customer.lng, status=stop.status, planned_time=stop.planned_time,
        duration_minutes=stop.duration_minutes, late_minutes=stop.late_minutes, source=stop.source,
        signal=stop.signal, reason=stop.reason, window_kind=stop.window_kind, window_time=stop.window_time,
    )


def _removed(customer: Customer, item: dict) -> RemovedStop:
    return RemovedStop(
        customer_id=customer.id, customer_name=customer.name, area=customer.area, lat=customer.lat, lng=customer.lng,
        label=SIGNAL_LABEL.get(item["signal"], item["signal"]), reason=item["reason"],
    )

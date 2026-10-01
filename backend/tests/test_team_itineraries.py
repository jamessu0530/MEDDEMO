"""主管端的行程分頁：看得到哪些業務、地圖要的座標與線、跟系統早上的建議比改了什麼。"""

import datetime as dt

from sqlalchemy import delete, select

from app.models import AppUser, Customer, Itinerary, OrgUnit, Visit
from app.services import google_routes
from app.services import itinerary as itineraries
from app.services import team_itineraries as team
from app.services.today_route import SIGNAL_LABEL
from app.timeutil import TAIPEI


def person(tx, user_id):
    return tx.get(AppUser, user_id)


def test_a_manager_sees_their_own_reps_and_it_sees_everyone(tx):
    # 代理示範業務的帳號（第三方登入）看的就是示範業務那一份，不另外列
    tx.add(AppUser(id="OAUTHTEAM", name="評審", role="sales", region="北區", acts_as_user_id="U01"))
    tx.flush()
    assert [r.id for r in team.reps(tx, person(tx, "M01"))] == ["U01", "U02"]
    everyone = [r.id for r in team.reps(tx, person(tx, "A01"))]
    assert {"U01", "U02", "U03", "U04", "U05"} <= set(everyone) and "OAUTHTEAM" not in everyone
    assert all(person(tx, rid).role == "sales" for rid in everyone)
    assert team.find_rep(tx, person(tx, "M01"), "U02").name == "王冠宇"
    assert team.find_rep(tx, person(tx, "M01"), "U03") is None
    assert team.find_rep(tx, person(tx, "M01"), "M01") is None


def test_reading_a_reps_route_builds_todays_itinerary_if_missing(tx):
    tx.execute(delete(Itinerary).where(Itinerary.user_id == "U02"))
    route = team.route(tx, person(tx, "U02"))
    assert tx.scalar(select(Itinerary).where(Itinerary.user_id == "U02")) is not None
    assert route.view.version == 1 and route.untouched is True
    assert route.removed == [] and route.added == [] and route.moved == []


def test_stops_carry_numbers_and_coordinates_and_the_route_starts_at_the_office(tx):
    route = team.route(tx, person(tx, "U01"))
    assert [s.number for s in route.stops] == list(range(1, len(route.stops) + 1))
    first = tx.get(Customer, route.stops[0].customer_id)
    assert (route.stops[0].lat, route.stops[0].lng, route.stops[0].area) == (first.lat, first.lng, first.area)
    assert route.stops[0].window_kind is None and route.stops[0].window_time is None
    office = tx.scalar(select(OrgUnit).where(OrgUnit.kind == "region", OrgUnit.name == "北區"))
    assert route.origin == (office.lat, office.lng)
    # 沒有金鑰：每一段都畫直線；辦公室開到第 1 站是第 0 段
    assert len(route.legs) == len(route.stops)
    assert all(leg.polyline is None and leg.done is False for leg in route.legs)


def test_legs_to_finished_stops_are_marked_done(tx):
    itinerary = itineraries.get_or_create(tx, "U01")
    target = itineraries.view(tx, itinerary).stops[1]
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(id="VTEAM1", customer_id=target.customer_id, user_id="U01", visited_at=at,
                 transcript="測試", status="synced", confirmed_at=at))
    tx.flush()
    route = team.route(tx, person(tx, "U01"))
    assert route.stops[0].customer_id == target.customer_id and route.stops[0].status == "done"
    assert [leg.done for leg in route.legs] == [True] + [False] * (len(route.legs) - 1)
    # 先跑了建議的第 2 站：跑的順序跟建議不一樣，也算順序改過
    first_suggested = tx.get(Customer, itinerary.suggested[0]["customer_id"])
    assert route.moved == [f"{team.short_name(tx.get(Customer, target.customer_id))}提到{team.short_name(first_suggested)}前面"]
    assert route.untouched is False


def test_changes_against_the_morning_suggestion(tx):
    itinerary = itineraries.get_or_create(tx, "U01")
    stops = itineraries.view(tx, itinerary).stops
    dropped, last = stops[1], stops[-1]
    itineraries.apply_feedback(tx, "U01", dropped.customer_id, "snooze", itinerary.version)
    itineraries.apply_feedback(tx, "U01", last.customer_id, "pin", itinerary.version)
    mine = tx.scalars(
        select(Customer).where(Customer.owner_user_id == "U01", Customer.id.not_in([s.customer_id for s in stops]))
    ).first()
    itineraries.add_stops(tx, "U01", [mine.id], source="rep")

    route = team.route(tx, person(tx, "U01"))
    (removed,) = route.removed
    assert removed.customer_id == dropped.customer_id and removed.customer_name == dropped.customer_name
    assert removed.label == SIGNAL_LABEL[dropped.signal] and removed.reason == dropped.reason
    customer = tx.get(Customer, dropped.customer_id)
    assert (removed.lat, removed.lng, removed.area) == (customer.lat, customer.lng, customer.area)
    assert route.added == [mine.name]
    # 被插到下一站的那一家提到原本第一站的前面；被拿掉、自己加的不算順序改過
    moved_name = team.short_name(tx.get(Customer, last.customer_id))
    first_name = team.short_name(tx.get(Customer, stops[0].customer_id))
    assert route.moved == [f"{moved_name}提到{first_name}前面"]
    assert route.untouched is False


def test_moved_sentences_name_the_stop_that_moved():
    names = {c: c for c in "ABCDX"}
    assert team.moved_sentences(list("ABCD"), list("ABCD"), names) == []
    assert team.moved_sentences(list("ABCD"), list("DABC"), names) == ["D提到A前面"]
    assert team.moved_sentences(list("ABCD"), list("BCDA"), names) == ["A移到D後面"]
    assert team.moved_sentences(list("ABCD"), list("ACBD"), names) == ["C提到B前面"]
    assert team.moved_sentences(list("ABCD"), list("AXCD"), names) == []


def test_short_names_drop_the_district_but_keep_chain_branches():
    assert team.short_name(Customer(name="杏林診所 · 大安", area="大安")) == "杏林診所"
    assert team.short_name(Customer(name="康泰 · 忠孝店", area="大安")) == "康泰 · 忠孝店"


def test_with_a_server_key_the_legs_carry_googles_lines(tx, monkeypatch, env):
    itineraries.get_or_create(tx, "U01")  # 建的時候要排順序、會問整份矩陣，先在沒有金鑰時建好
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def route_legs(key, points, http=None, polylines=True):
        return [google_routes.Leg(seconds=60, meters=500, polyline=f"line{n}") for n in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    route = team.route(tx, person(tx, "U01"))
    assert [leg.polyline for leg in route.legs] == [f"line{n}" for n in range(len(route.legs))]

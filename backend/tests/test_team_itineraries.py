"""主管端的行程分頁：看得到哪些業務、地圖要的座標與線、跟系統早上的建議比改了什麼。"""

import datetime as dt

from sqlalchemy import delete, select

from app.models import AppUser, Customer, Itinerary, OrgUnit, UserLocation, Visit
from app.services import google_routes, locations, travel
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


def test_managers_see_the_reps_window_but_not_their_note_or_habits(tx):
    # 約的時間跟業務看到的一樣（itinerary.StopView）；業務自己的備註、鎖定與套用的習慣不給主管
    itinerary = itineraries.get_or_create(tx, "U01")
    draft = itineraries.draft_of(tx, itinerary)
    draft.stops[1].window_kind, draft.stops[1].window_time = "before", dt.time(11, 0)
    draft.stops[1].note = "找王藥師"
    itineraries.save(tx, "U01", itinerary.version, draft)
    route = team.route(tx, person(tx, "U01"))
    stop = next(s for s in route.stops if s.customer_id == draft.stops[1].customer_id)
    assert (stop.window_kind, stop.window_time) == ("before", "11:00")
    assert not {"note", "locked", "habit_ids"} & set(vars(stop))
    # 收到位置事件時只拿的那份，站號跟行程的一樣
    points = team._stop_points(tx, person(tx, "U01"), itinerary.date)
    assert [(p.number, p.lat, p.lng) for p in points] == [(s.number, s.lat, s.lng) for s in route.stops]


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

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        return [google_routes.Leg(seconds=60, meters=500, polyline=f"line{n}") for n in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    route = team.route(tx, person(tx, "U01"))
    assert [leg.polyline for leg in route.legs] == [f"line{n}" for n in range(len(route.legs))]


def test_a_walked_leg_is_asked_of_google_as_walking_on_both_maps(tx, monkeypatch, env):
    itinerary = itineraries.get_or_create(tx, "U01")
    stops = itineraries.view(tx, itinerary).stops
    itineraries.set_leg_mode(tx, "U01", stops[0].customer_id, stops[1].customer_id, "walk", itinerary.version)
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    asked = []

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        asked.append(mode)
        return [google_routes.Leg(seconds=60, meters=500, polyline=f"line{n}") for n in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    for draw in (lambda: team.rep_map(tx, person(tx, "U01"), itinerary), lambda: team.route(tx, person(tx, "U01"))):
        asked.clear()
        found = draw()
        assert "walk" in asked and "drive" in asked
        assert len(found.legs) == len(stops)
    assert [s.travel_mode for s in team.route(tx, person(tx, "U01")).stops][:3] == ["drive", "walk", "drive"]


def test_the_reps_own_map_numbers_the_stops_like_the_home_page(tx):
    itinerary = itineraries.get_or_create(tx, "U01")
    target = itineraries.view(tx, itinerary).stops[1]
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(id="VTEAM3", customer_id=target.customer_id, user_id="U01", visited_at=at,
                 transcript="測試", status="synced", confirmed_at=at))
    tx.flush()
    view = itineraries.view(tx, itinerary)
    found = team.rep_map(tx, person(tx, "U01"), itinerary)
    assert found.version == view.version
    assert [(s.number, s.customer_id, s.status) for s in found.stops] == [
        (n + 1, s.customer_id, s.status) for n, s in enumerate(view.stops)
    ]
    assert [s.status for s in found.stops][:3] == ["done", "next", "todo"]
    first = tx.get(Customer, found.stops[0].customer_id)
    assert (found.stops[0].customer_name, found.stops[0].lat, found.stops[0].lng) == (first.name, first.lat, first.lng)
    office = tx.scalar(select(OrgUnit).where(OrgUnit.kind == "region", OrgUnit.name == "北區"))
    assert found.origin == (office.lat, office.lng)
    assert [leg.done for leg in found.legs] == [True] + [False] * (len(found.stops) - 1)
    assert all(leg.polyline is None for leg in found.legs)


def test_the_reps_own_map_draws_the_same_lines_as_the_managers(tx, monkeypatch, env):
    itinerary = itineraries.get_or_create(tx, "U01")
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        return [google_routes.Leg(seconds=60, meters=500, polyline=f"line{n}") for n in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)

    def no_driving(*args, **kwargs):
        raise AssertionError("地圖分頁只要站號與座標，不該再算一次車程")

    monkeypatch.setattr(travel, "along", no_driving)
    monkeypatch.setattr(travel, "matrix", no_driving)
    found = team.rep_map(tx, person(tx, "U01"), itinerary)
    assert [leg.polyline for leg in found.legs] == [f"line{n}" for n in range(len(found.stops))]


def test_a_transit_rep_is_drawn_walking_and_riding_on_both_maps(tx, monkeypatch, env):
    itinerary = itineraries.get_or_create(tx, "U01")
    person(tx, "U01").travel_mode = "transit"
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    asked = []

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        asked.append(mode)
        steps = (google_routes.Step(True, "walk"), google_routes.Step(False, "ride"))
        legs = [google_routes.Leg(seconds=900, meters=4000, polyline=f"line{n}", steps=steps) for n in range(len(points) - 1)]
        return [*legs[:-1], None]  # 最後一段搭不到車

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    for found in (team.rep_map(tx, person(tx, "U01"), itinerary), team.route(tx, person(tx, "U01"))):
        assert found.legs[0].polyline == "line0"
        assert found.legs[0].steps == [team.LegStep(True, "walk"), team.LegStep(False, "ride")]
        assert found.legs[-1].polyline is None and found.legs[-1].steps == []
    assert team.rep_map(tx, person(tx, "U01"), itinerary).travel_mode == "transit"
    assert set(asked) == {"transit"}


def test_the_route_says_where_the_rep_is(tx, env):
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")
    first = team.route(tx, person(tx, "U01")).stops[0]
    tx.add(UserLocation(user_id="U01", lat=first.lat, lng=first.lng, at=locations.now(), paused=False, denied=False))
    tx.flush()
    seen = team.route(tx, person(tx, "U01")).location
    assert seen.text == f"在{team.short_name(tx.get(Customer, first.customer_id))}附近"
    assert seen.live is True and (seen.lat, seen.lng) == (first.lat, first.lng)


def test_off_hours_and_no_location_yet(tx, env):
    env(LOCATION_SHARE_HOURS="1-7 00:00-00:00")
    assert team.route(tx, person(tx, "U02")).location == locations.Seen("下班時間")
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")
    assert team.route(tx, person(tx, "U02")).location == locations.Seen("今天還沒有位置")


def test_locations_alone_say_the_same_without_recomputing_the_route(tx, env, monkeypatch):
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")
    team.route(tx, person(tx, "U01"))
    # 陽明山上：離每一站都遠，也不在任何客戶 3 公里內
    tx.add(UserLocation(
        user_id="U01", lat=25.16, lng=121.55, at=locations.now() - dt.timedelta(minutes=2), paused=False, denied=False,
    ))
    tx.flush()
    full = team.route(tx, person(tx, "U01")).location.text
    assert full.startswith("往第 1 站") and full.endswith("途中 · 2 分鐘前")

    def no_driving(*args, **kwargs):
        raise AssertionError("只拿位置不該重算車程")

    monkeypatch.setattr(travel, "along", no_driving)
    monkeypatch.setattr(travel, "matrix", no_driving)
    found = team.locations_now(tx, person(tx, "M01"))
    assert set(found) == {"U01", "U02"}
    assert found["U01"].text == full


def test_locations_alone_number_the_stops_like_the_route(tx, env):
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")
    itinerary = itineraries.get_or_create(tx, "U01")
    target = itineraries.view(tx, itinerary).stops[2]
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(id="VTEAM2", customer_id=target.customer_id, user_id="U01", visited_at=at,
                 transcript="測試", status="synced", confirmed_at=at))
    tx.add(UserLocation(user_id="U01", lat=25.16, lng=121.55, at=locations.now(), paused=False, denied=False))
    tx.flush()
    # 跑完的那一家排第 1 站，下一站是第 2 站
    full = team.route(tx, person(tx, "U01")).location.text
    assert full.startswith("往第 2 站")
    assert team.locations_now(tx, person(tx, "M01"))["U01"].text == full

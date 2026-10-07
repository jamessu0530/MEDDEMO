"""車程：直線估算，以及設了金鑰時改問 Google（假的，不連網路）。"""

import json
import logging

import pytest

from app.services import google_routes, travel
from app.tasks import redis


def test_straight_distance_between_two_known_points():
    # 台北車站到台北 101 大約 5 公里
    assert travel.straight_km((25.0478, 121.5170), (25.0340, 121.5645)) == pytest.approx(5.0, abs=0.3)


def test_estimate_adds_detour_speed_and_parking():
    # 緯度差 0.1 度約 11.12 公里，乘 1.4 是 15.57 公里，時速 30 要 31 分鐘，加 5 分鐘停車
    minutes, km = travel.estimate((25.0, 121.5), (25.1, 121.5))
    assert km == 15.6
    assert minutes == 36


def test_same_point_needs_no_driving():
    assert travel.estimate((25.0, 121.5), (25.0, 121.5)) == (0, 0.0)


def test_matrix_is_symmetric_with_an_empty_diagonal():
    points = [(25.0, 121.5), (25.1, 121.5), (25.0, 121.6)]
    result = travel.matrix(points)
    assert result.estimated is True
    assert [result.minutes[i][i] for i in range(3)] == [0, 0, 0]
    assert result.minutes[0][1] == result.minutes[1][0] == 36
    assert result.km[0][1] == 15.6


POINTS = [(25.0, 121.5), (25.1, 121.5), (25.0, 121.6)]


def fake_matrix(calls, skip=()):
    """假的 Google 路線矩陣：第 i 點到第 j 點開 (i + j) × 10 分鐘、(i + j) 公里；skip 裡的格子當作開不到。"""

    def route_matrix(key, origins, destinations, http=None, mode="drive"):
        calls.append((key, origins, destinations, mode))
        return {
            (i, j): google_routes.Cell(seconds=600 * (i + j), meters=1000 * (i + j))
            for i in range(len(origins)) for j in range(len(destinations))
            if i != j and (i, j) not in skip
        }

    return route_matrix


@pytest.fixture
def google(monkeypatch, env):
    """設一把假的伺服器金鑰，Google 換成假的；回傳每次問了什麼。"""
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_matrix", fake_matrix(calls))
    return calls


def test_a_google_cell_becomes_minutes_plus_parking_and_kilometres():
    assert travel.road(google_routes.Cell(seconds=650, meters=4249)) == (16, 4.2)


def test_with_a_server_key_the_matrix_uses_google_road_times(google):
    result = travel.matrix(POINTS)
    assert result.estimated is False
    # 第 0 點到第 1 點：600 秒是 10 分鐘，再加 5 分鐘停車；1000 公尺是 1.0 公里
    assert result.minutes[0][1] == 15 and result.km[0][1] == 1.0
    assert result.minutes[1][2] == 35 and result.km[2][1] == 3.0
    assert [result.minutes[i][i] for i in range(3)] == [0, 0, 0]
    assert google == [("server-key", POINTS, POINTS, "drive")]


def test_without_a_key_google_is_never_asked(google, env):
    env(GOOGLE_MAPS_SERVER_KEY="")
    result = travel.matrix(POINTS)
    assert result.estimated is True and result.minutes[0][1] == 36
    assert google == []


def test_google_failing_or_timing_out_falls_back_to_the_estimate(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def broken(*args, **kwargs):
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_matrix", broken)
    result = travel.matrix(POINTS)
    assert result.estimated is True
    assert result.minutes[0][1] == 36 and result.km[0][1] == 15.6


def test_matrix_failure_logs_one_line_without_a_traceback(monkeypatch, env, caplog):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def broken(*args, **kwargs):
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_matrix", broken)
    with caplog.at_level(logging.WARNING):
        travel.matrix(POINTS)
    [record] = caplog.records
    assert record.exc_info is None
    assert record.getMessage() == "Google 路線矩陣沒有拿到，改用直線估算：逾時"


def test_google_failure_pauses_google_for_60_seconds_then_resumes(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def broken(*args, **kwargs):
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_matrix", broken)
    first = travel.matrix(POINTS)
    assert first.estimated is True

    # 還在暫停窗內：就算把 route_matrix 換回假的成功實作，也不會被呼叫
    calls = []
    monkeypatch.setattr(google_routes, "route_matrix", fake_matrix(calls))
    second = travel.matrix(POINTS)
    assert second.estimated is True
    assert calls == []

    # 過了暫停窗：Google 又會被問
    monkeypatch.setattr(travel, "_google_paused_until", 0.0)
    third = travel.matrix(POINTS)
    assert third.estimated is False
    assert len(calls) == 1


def test_cells_google_cannot_route_use_the_estimate_and_mark_the_matrix(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    monkeypatch.setattr(google_routes, "route_matrix", fake_matrix([], skip={(0, 2)}))
    result = travel.matrix(POINTS)
    assert result.estimated is True
    assert result.minutes[0][2] == travel.estimate(POINTS[0], POINTS[2])[0]
    assert result.minutes[0][1] == 15


def test_a_single_point_needs_no_google(google):
    result = travel.matrix([POINTS[0]])
    assert result.minutes == [[0]] and result.km == [[0.0]] and result.estimated is False
    assert google == []


def fake_legs(calls):
    """假的 Google 路線：第 n 段開 (n + 1) × 10 分鐘、(n + 1) 公里。"""

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        calls.append((key, points, polylines, mode))
        return [
            google_routes.Leg(seconds=600 * (n + 1), meters=1000 * (n + 1), polyline="")
            for n in range(len(points) - 1)
        ]

    return route_legs


def no_matrix(*args, **kwargs):
    raise AssertionError("照順序算時間不該問整份矩陣（按格計價）")


def test_along_asks_google_only_for_the_legs_in_order(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", fake_legs(calls))
    monkeypatch.setattr(google_routes, "route_matrix", no_matrix)
    result = travel.along(POINTS)
    assert result.estimated is False
    # 第 1 段 600 秒：10 分鐘加 5 分鐘停車；第 2 段 1200 秒：20 分鐘加 5 分鐘
    assert result.minutes[0][1] == 15 and result.minutes[1][2] == 25
    assert result.km[0][1] == 1.0 and result.km[1][2] == 2.0
    # 不相鄰的格子是估算的：這份只能照同一個順序算時間，不能拿去排順序
    assert result.minutes[0][2] == travel.estimate(POINTS[0], POINTS[2])[0]
    assert calls == [("server-key", POINTS, False, "drive")]


def test_along_without_a_key_or_when_google_fails_is_the_estimate(monkeypatch, env):
    assert travel.along(POINTS).estimated is True
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def broken(*args, **kwargs):
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_legs", broken)
    result = travel.along(POINTS)
    assert result.estimated is True and result.minutes[0][1] == 36


def test_along_failure_pauses_google_for_60_seconds_then_resumes(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def broken(*args, **kwargs):
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_legs", broken)
    first = travel.along(POINTS)
    assert first.estimated is True

    calls = []
    monkeypatch.setattr(google_routes, "route_legs", fake_legs(calls))
    second = travel.along(POINTS)
    assert second.estimated is True
    assert calls == []

    monkeypatch.setattr(travel, "_google_paused_until", 0.0)
    third = travel.along(POINTS)
    assert third.estimated is False
    assert len(calls) == 1


def test_along_a_single_point_needs_no_google(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", fake_legs(calls))
    result = travel.along([POINTS[0]])
    assert result.minutes == [[0]] and result.estimated is False
    assert calls == []


@pytest.fixture
def google_lines(monkeypatch, env):
    """設假金鑰，Google 的路線換成假的：第 n 段的折線是 "line{n}"；大眾運輸再分成走路與搭車兩小段，
    第 1 段搭不到車。記下每次問了哪些點、要不要折線、什麼交通方式。"""
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        calls.append((points, polylines, mode))
        if mode == "transit":
            steps = (google_routes.Step(True, "walk"), google_routes.Step(False, "ride"))
            return [google_routes.Leg(seconds=60, meters=500, polyline="line0", steps=steps), None][:len(points) - 1]
        return [google_routes.Leg(seconds=60, meters=500, polyline=f"line{n}") for n in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    return calls


LINES = [travel.Line("line0"), travel.Line("line1")]


def test_lines_come_from_google_once_then_from_the_cache(google_lines):
    assert travel.lines(POINTS) == LINES
    assert travel.lines(POINTS) == LINES
    assert google_lines == [(POINTS, True, "drive")]
    # 快取裡只有折線（經緯度），沒有車程的秒數與公尺：Google 的條款只允許快取經緯度
    (key,) = redis().keys(f"{travel.LINES_CACHE_PREFIX}*")
    assert json.loads(redis().get(key)) == [{"polyline": "line0", "steps": []}, {"polyline": "line1", "steps": []}]
    assert 0 < redis().ttl(key) <= travel.LINES_TTL_SECONDS


def test_a_different_order_is_a_different_route(google_lines):
    travel.lines(POINTS)
    travel.lines(list(reversed(POINTS)))
    assert len(google_lines) == 2


def test_each_travel_mode_has_its_own_lines(google_lines):
    assert travel.lines(POINTS) == LINES
    transit = [travel.Line("line0", (google_routes.Step(True, "walk"), google_routes.Step(False, "ride"))), None]
    assert travel.lines(POINTS, "transit") == transit
    # 走路與搭車的小段、搭不到車的那一段也一起放進快取
    assert travel.lines(POINTS, "transit") == transit
    assert [mode for _, _, mode in google_lines] == ["drive", "transit"]


def test_without_a_key_there_are_no_lines_and_the_map_draws_straight_ones(google_lines, env):
    env(GOOGLE_MAPS_SERVER_KEY="")
    assert travel.lines(POINTS) is None
    assert google_lines == []


def test_google_failing_means_no_lines_and_a_pause(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []

    def broken(key, points, http=None, polylines=True, mode="drive"):
        calls.append(points)
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_legs", broken)
    assert travel.lines(POINTS) is None
    # 暫停中：不再問 Google
    assert travel.lines(POINTS) is None
    assert len(calls) == 1


def test_a_single_point_has_no_legs(google_lines):
    assert travel.lines([POINTS[0]]) == []
    assert google_lines == []


def test_cached_lines_are_served_even_while_google_is_paused(google_lines):
    assert travel.lines(POINTS) == LINES
    assert len(google_lines) == 1

    travel._pause_google()
    assert travel.lines(POINTS) == LINES
    # 還是暫停中：Google 沒有被多問一次，因為折線已經在快取裡
    assert len(google_lines) == 1

    # 換一個順序（沒快取過）：暫停中就不問 Google，回 None
    assert travel.lines(list(reversed(POINTS))) is None
    assert len(google_lines) == 1


def test_each_travel_mode_estimates_its_own_pace():
    # 同一段 15.6 公里（開車的繞路倍數）：開車 31 分加找車位 5 分；機車繞得少、停車快；大眾運輸慢、要等車
    a, b = (25.0, 121.5), (25.1, 121.5)
    assert travel.estimate(a, b) == travel.estimate(a, b, "drive") == (36, 15.6)
    assert travel.estimate(a, b, "scooter") == (33, 14.5)
    assert travel.estimate(a, b, "transit") == (53, 14.5)


def test_google_times_add_parking_for_cars_and_scooters_but_not_for_transit():
    cell = google_routes.Cell(seconds=600, meters=4000)
    assert travel.road(cell) == (15, 4.0)
    assert travel.road(cell, "scooter") == (12, 4.0)
    assert travel.road(cell, "transit") == (10, 4.0)


def test_the_matrix_asks_google_in_the_reps_travel_mode(google):
    result = travel.matrix(POINTS, "scooter")
    assert google == [("server-key", POINTS, POINTS, "scooter")]
    assert result.minutes[0][1] == 12 and result.estimated is False
    # 沒問到的格子照機車的估算
    assert travel.matrix([], "transit").minutes == []


def test_along_by_transit_estimates_the_legs_google_cannot_ride(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        calls.append(mode)
        return [google_routes.Leg(seconds=1800, meters=6000, polyline=""), None]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    result = travel.along(POINTS, "transit")
    assert calls == ["transit"]
    assert result.minutes[0][1] == 30
    assert result.minutes[1][2] == travel.estimate(POINTS[1], POINTS[2], "transit")[0]
    assert result.estimated is True


def test_walking_has_its_own_estimate_and_no_extra_minutes_on_google():
    # 緯度差 0.1 度約 11.12 公里，×1.3 = 14.46 公里，時速 4.5 要 193 分
    assert travel.estimate((25.0, 121.5), (25.1, 121.5), "walk") == (193, 14.5)
    assert travel.road(google_routes.Cell(seconds=600, meters=800), "walk") == (10, 0.8)


def test_the_four_mode_tables_stay_aligned():
    from app import models

    modes = tuple(google_routes.TRAVEL)
    assert modes == ("drive", "scooter", "transit", "walk")
    assert set(travel.PACES) == set(travel.GOOGLE_EXTRA_MINUTES) == set(modes)
    assert models.LEG_MODES == modes
    assert models.TRAVEL_MODES == modes[:3]


FIVE = [(25.0, 121.5), (25.01, 121.5), (25.02, 121.5), (25.03, 121.5), (25.04, 121.5)]  # 4 段


def legs_by_mode(calls, fail=(), missing=()):
    """假的 Google：每段 10 分鐘、1 公里，不管交通方式；記下 (交通方式, 幾個點)。
    fail 裡的交通方式丟 RoutesError；missing 裡的每段回 None（大眾運輸搭不到車）。"""

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        calls.append((mode, len(points)))
        if mode in fail:
            raise google_routes.RoutesError("逾時")
        if mode in missing:
            return [None] * (len(points) - 1)
        return [google_routes.Leg(600, 1000, f"{mode}{n}") for n in range(len(points) - 1)]

    return route_legs


def test_along_groups_neighbouring_legs_of_one_mode(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    result = travel.along(FIVE, ["walk", "walk", "transit", "scooter"])
    assert sorted(calls) == [("scooter", 2), ("transit", 2), ("walk", 3)]
    assert result.estimated is False and result.estimated_legs == (False,) * 4
    # 走路、大眾運輸不加，機車加 2 分
    assert [result.minutes[n][n + 1] for n in range(4)] == [10, 10, 10, 12]


def test_along_with_one_mode_is_one_request_as_before(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    travel.along(FIVE, "scooter")
    assert calls == [("scooter", 5)]


def test_a_failing_group_only_estimates_its_legs_and_pauses_google(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode([], fail={"walk"}))
    result = travel.along(FIVE, ["drive", "walk", "drive", "drive"])
    assert result.estimated_legs == (False, True, False, False)
    assert result.minutes[1][2] == travel.estimate(FIVE[1], FIVE[2], "walk")[0]
    assert result.minutes[0][1] == 15
    assert travel._server_key() == ""


def test_no_transit_service_is_estimated_without_pausing(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode([], missing={"transit"}))
    result = travel.along(FIVE, ["drive", "transit", "drive", "drive"])
    assert result.estimated_legs == (False, True, False, False)
    assert travel._server_key() == "server-key"


def test_same_point_legs_are_not_sent_to_google(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    points = [FIVE[0], FIVE[0], FIVE[1], FIVE[2]]
    result = travel.along(points, "walk")
    assert calls == [("walk", 3)]  # 第 0 段兩點相同，從第 1 點開始問
    assert result.minutes[0][1] == 0 and result.estimated_legs == (False, False, False)


def test_without_a_key_each_leg_is_estimated_with_its_own_mode():
    result = travel.along(FIVE, ["walk", "drive", "drive", "transit"])
    assert result.estimated is True and result.estimated_legs == (True,) * 4
    assert result.minutes[0][1] == travel.estimate(FIVE[0], FIVE[1], "walk")[0]
    assert result.minutes[3][4] == travel.estimate(FIVE[3], FIVE[4], "transit")[0]


def test_lines_follow_each_legs_mode_and_cache_by_modes(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    first = travel.lines(FIVE, ["walk", "walk", "drive", "drive"])
    assert [line.polyline for line in first] == ["walk0", "walk1", "drive0", "drive1"]
    assert travel.lines(FIVE, ["walk", "walk", "drive", "drive"]) == first  # 快取
    travel.lines(FIVE, ["drive"] * 4)  # 交通方式不同就是不同的線
    assert sorted(calls) == [("drive", 3), ("drive", 5), ("walk", 3)]


def test_lines_with_a_failing_group_are_partial_and_not_cached(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls, fail={"walk"}))
    found = travel.lines(FIVE, ["drive", "walk", "drive", "drive"])
    assert found[0].polyline == "drive0" and found[1] is None and found[2].polyline == "drive0"
    monkeypatch.setattr(travel, "_google_paused_until", 0.0)
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    assert travel.lines(FIVE, ["drive", "walk", "drive", "drive"])[1].polyline == "walk0"  # 沒有快取壞的那份


def test_options_ask_all_four_modes_for_one_leg(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls, missing={"transit"}))
    found = travel.options(FIVE[0], FIVE[1])
    assert [o.mode for o in found] == ["drive", "scooter", "transit", "walk"]
    by_mode = {o.mode: o for o in found}
    assert (by_mode["drive"].minutes, by_mode["drive"].estimated, by_mode["drive"].found) == (15, False, True)
    assert by_mode["walk"].minutes == 10
    assert by_mode["transit"].found is False and by_mode["transit"].estimated is True
    assert sorted(calls) == [("drive", 2), ("scooter", 2), ("transit", 2), ("walk", 2)]


def test_options_without_a_key_or_for_the_same_point():
    found = travel.options(FIVE[0], FIVE[1])
    assert all(o.estimated and o.found for o in found)
    assert [o.minutes for o in found] == [travel.estimate(FIVE[0], FIVE[1], m)[0] for m in google_routes.TRAVEL]
    assert all((o.minutes, o.estimated) == (0, False) for o in travel.options(FIVE[0], FIVE[0]))


def test_options_with_no_walking_route_estimate_it_without_pausing_google(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode([], missing={"walk"}))
    by_mode = {o.mode: o for o in travel.options(FIVE[0], FIVE[1])}
    assert (by_mode["walk"].found, by_mode["walk"].estimated) == (False, True)
    assert by_mode["drive"].found is True and by_mode["drive"].estimated is False
    assert travel._server_key() == "server-key"

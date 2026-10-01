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

    def route_matrix(key, origins, destinations, http=None):
        calls.append((key, origins, destinations))
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
    assert google == [("server-key", POINTS, POINTS)]


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

    def route_legs(key, points, http=None, polylines=True):
        calls.append((key, points, polylines))
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
    assert calls == [("server-key", POINTS, False)]


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
    """設假金鑰，Google 的路線換成假的：第 n 段的折線是 "line{n}"。記下每次問了哪些點、要不要折線。"""
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []

    def route_legs(key, points, http=None, polylines=True):
        calls.append((points, polylines))
        return [google_routes.Leg(seconds=60, meters=500, polyline=f"line{n}") for n in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    return calls


def test_lines_come_from_google_once_then_from_the_cache(google_lines):
    assert travel.lines(POINTS) == ["line0", "line1"]
    assert travel.lines(POINTS) == ["line0", "line1"]
    assert google_lines == [(POINTS, True)]
    # 快取裡只有折線（經緯度），沒有車程的秒數與公尺：Google 的條款只允許快取經緯度
    (key,) = redis().keys(f"{travel.LINES_CACHE_PREFIX}*")
    assert json.loads(redis().get(key)) == ["line0", "line1"]
    assert 0 < redis().ttl(key) <= travel.LINES_TTL_SECONDS


def test_a_different_order_is_a_different_route(google_lines):
    travel.lines(POINTS)
    travel.lines(list(reversed(POINTS)))
    assert len(google_lines) == 2


def test_without_a_key_there_are_no_lines_and_the_map_draws_straight_ones(google_lines, env):
    env(GOOGLE_MAPS_SERVER_KEY="")
    assert travel.lines(POINTS) is None
    assert google_lines == []


def test_google_failing_means_no_lines_and_a_pause(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []

    def broken(key, points, http=None, polylines=True):
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
    assert travel.lines(POINTS) == ["line0", "line1"]
    assert len(google_lines) == 1

    travel._pause_google()
    assert travel.lines(POINTS) == ["line0", "line1"]
    # 還是暫停中：Google 沒有被多問一次，因為折線已經在快取裡
    assert len(google_lines) == 1

    # 換一個順序（沒快取過）：暫停中就不問 Google，回 None
    assert travel.lines(list(reversed(POINTS))) is None
    assert len(google_lines) == 1

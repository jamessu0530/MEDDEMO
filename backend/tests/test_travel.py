"""車程：直線估算，以及設了金鑰時改問 Google（假的，不連網路）。"""

import pytest

from app.services import google_routes, travel


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

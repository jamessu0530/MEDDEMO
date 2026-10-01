"""車程：直線估算。"""

import pytest

from app.services import travel


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

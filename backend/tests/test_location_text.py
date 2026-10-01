"""主管頁那一行位置的每一種寫法（純函式，不碰資料庫）。"""

import datetime as dt

import pytest

from app.models import UserLocation
from app.services import locations
from app.services.locations import AreaPoint, StopPoint
from app.timeutil import TAIPEI

# 星期四 11:00
NOW = dt.datetime(2026, 10, 1, 11, 0, tzinfo=TAIPEI)
HOURS = locations.parse_hours("1-5 08:30-18:30")
STOPS = [
    StopPoint(1, "杏林診所", 25.0264, 121.5435, done=True),
    StopPoint(2, "康泰 · 忠孝店", 25.0410, 121.5440, done=False),
    StopPoint(3, "德安藥局", 25.0600, 121.5500, done=False),
]
AREAS = [AreaPoint(25.0689, 121.5889, "內湖區")]
# 台北 101：離每一站都超過 200 公尺
FAR = (25.0330, 121.5654)


def located(minutes_ago, lat=FAR[0], lng=FAR[1], paused=False, denied=False):
    return UserLocation(lat=lat, lng=lng, at=NOW - dt.timedelta(minutes=minutes_ago), paused=paused, denied=denied)


def say(row, stops=STOPS, now=NOW):
    return locations.describe(now, HOURS, row, stops, AREAS)


def test_after_work_hours_nothing_is_shown():
    seen = say(located(1), now=NOW.replace(hour=19))
    assert seen == locations.Seen("下班時間")


def test_paused_shows_the_last_place_greyed():
    seen = say(located(10, paused=True))
    assert seen.text == "暫停分享位置 · 最後位置 10:50"
    assert (seen.lat, seen.lng, seen.live) == (FAR[0], FAR[1], False)
    assert say(UserLocation(paused=True, denied=False)).text == "暫停分享位置"


def test_denied():
    assert say(UserLocation(paused=False, denied=True)).text == "沒有開定位權限"


def test_no_location_today():
    assert say(None) == locations.Seen("今天還沒有位置")
    yesterday = UserLocation(lat=FAR[0], lng=FAR[1], at=NOW - dt.timedelta(days=1), paused=False, denied=False)
    assert say(yesterday) == locations.Seen("今天還沒有位置")


def test_stale_shows_the_last_time_and_the_district_within_three_km():
    seen = say(located(10, lat=25.0700, lng=121.5900))
    assert seen.text == "最後位置 10:50，在內湖區" and seen.live is False and seen.lat == 25.07
    assert say(located(10, lat=24.0, lng=120.6)).text == "最後位置 10:50"


def test_near_a_stop():
    seen = say(located(0, lat=25.0265, lng=121.5436))
    assert seen.text == "在杏林診所附近" and seen.live is True


def test_on_the_way_to_the_next_stop():
    assert say(located(1)).text == "往第 2 站康泰 · 忠孝店途中 · 1 分鐘前"
    # 剛好 5 分鐘還不算太久
    assert say(located(5)).text == "往第 2 站康泰 · 忠孝店途中 · 5 分鐘前"


def test_all_done():
    finished = [StopPoint(s.number, s.name, s.lat, s.lng, done=True) for s in STOPS]
    assert say(located(2), stops=finished).text == "今天跑完了 · 2 分鐘前"


@pytest.mark.parametrize(
    ("area", "city", "label"),
    [("內湖", "台北市", "內湖區"), ("板橋", "新北市", "板橋區"), ("西區", "台中市", "西區"), ("員林", "彰化縣", "員林")],
)
def test_area_labels(area, city, label):
    assert locations.area_label(area, city) == label

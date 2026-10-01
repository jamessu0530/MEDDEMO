"""即時位置的寫入：上班時間、暫停、節流、沒有權限、代理帳號寫在示範業務名下。描述在 test_location_text.py。"""

import datetime as dt

import pytest
from sqlalchemy import delete

from app.models import AppUser, UserLocation
from app.services import locations
from app.timeutil import TAIPEI

# 2026-10-01 是星期四
WORKING = dt.datetime(2026, 10, 1, 10, 0, tzinfo=TAIPEI)
TAIPEI_101 = (25.034, 121.5645)
WEEKDAYS = locations.parse_hours("1-5 08:30-18:30")


@pytest.fixture(autouse=True)
def no_locations(engine):
    """WebSocket 的測試會真的寫進資料庫（不在 tx 裡），前後都清掉。"""

    def clear():
        with engine.begin() as conn:
            conn.execute(delete(UserLocation))

    clear()
    yield
    clear()


def person(tx, user_id):
    return tx.get(AppUser, user_id)


def test_the_share_hours_setting():
    assert WEEKDAYS == locations.ShareHours(frozenset({1, 2, 3, 4, 5}), 8 * 60 + 30, 18 * 60 + 30)
    assert locations.parse_hours("1,3,6 00:00-24:00") == locations.ShareHours(frozenset({1, 3, 6}), 0, 1440)
    assert locations.share_hours() == WEEKDAYS


@pytest.mark.parametrize(
    ("when", "inside"),
    [
        (dt.datetime(2026, 10, 1, 8, 29, tzinfo=TAIPEI), False),
        (dt.datetime(2026, 10, 1, 8, 30, tzinfo=TAIPEI), True),
        (dt.datetime(2026, 10, 1, 18, 29, tzinfo=TAIPEI), True),
        (dt.datetime(2026, 10, 1, 18, 30, tzinfo=TAIPEI), False),
        # 星期六
        (dt.datetime(2026, 10, 3, 10, 0, tzinfo=TAIPEI), False),
        # 看的是台北時間：UTC 00:30 是台北 08:30
        (dt.datetime(2026, 10, 1, 0, 30, tzinfo=dt.UTC), True),
    ],
)
def test_work_hours_are_taipei_time(when, inside):
    assert locations.within(when, WEEKDAYS) is inside


def test_a_reps_location_is_saved(tx):
    assert locations.record(tx, person(tx, "U01"), *TAIPEI_101, 12.0, at=WORKING) == "U01"
    row = tx.get(UserLocation, "U01")
    assert (row.lat, row.lng, row.accuracy_m, row.at) == (25.034, 121.5645, 12.0, WORKING)


def test_nothing_is_written_outside_work_hours(tx):
    assert locations.record(tx, person(tx, "U01"), *TAIPEI_101, 12.0, at=WORKING.replace(hour=19)) is None
    assert locations.deny(tx, person(tx, "U01"), at=WORKING.replace(hour=19)) is None
    assert tx.get(UserLocation, "U01") is None


def test_managers_and_it_do_not_share(tx):
    assert locations.record(tx, person(tx, "M01"), *TAIPEI_101, 12.0, at=WORKING) is None
    assert tx.get(UserLocation, "M01") is None
    with pytest.raises(locations.NotSharing):
        locations.set_paused(tx, person(tx, "A01"), True)


def test_an_acting_account_writes_under_the_demo_rep(tx):
    tx.add(AppUser(id="JUDGE1", name="評審", role="sales", region="北區", acts_as_user_id="U01"))
    tx.flush()
    assert locations.record(tx, person(tx, "JUDGE1"), *TAIPEI_101, 12.0, at=WORKING) == "U01"
    assert tx.get(UserLocation, "JUDGE1") is None
    assert tx.get(UserLocation, "U01").lat == 25.034


def test_a_paused_rep_is_not_written_until_resumed(tx):
    rep = person(tx, "U01")
    assert locations.set_paused(tx, rep, True, at=WORKING) == "U01"
    assert tx.get(UserLocation, "U01").paused_at == WORKING
    assert locations.record(tx, rep, *TAIPEI_101, 12.0, at=WORKING) is None
    locations.set_paused(tx, rep, False)
    assert tx.get(UserLocation, "U01").paused_at is None
    assert locations.record(tx, rep, *TAIPEI_101, 12.0, at=WORKING) == "U01"


def test_small_quick_moves_are_skipped(tx):
    rep = person(tx, "U01")
    locations.record(tx, rep, *TAIPEI_101, 12.0, at=WORKING)
    later = WORKING + dt.timedelta(minutes=1)
    # 約 20 公尺、1 分鐘：不寫
    assert locations.record(tx, rep, 25.03418, 121.5645, 12.0, at=later) is None
    assert tx.get(UserLocation, "U01").at == WORKING
    # 約 50 公尺：寫
    assert locations.record(tx, rep, 25.03445, 121.5645, 12.0, at=later) == "U01"
    # 沒動，但離上一筆超過 2 分鐘：寫，主管才知道位置還是新的
    assert locations.record(tx, rep, 25.03445, 121.5645, 12.0, at=later + dt.timedelta(minutes=2, seconds=1)) == "U01"


def test_denied_is_recorded_once_and_cleared_by_the_next_position(tx):
    rep = person(tx, "U01")
    assert locations.deny(tx, rep, at=WORKING) == "U01"
    # 已經記過了，不再發事件
    assert locations.deny(tx, rep, at=WORKING) is None
    assert tx.get(UserLocation, "U01").denied is True
    assert locations.record(tx, rep, *TAIPEI_101, 12.0, at=WORKING) == "U01"
    row = tx.get(UserLocation, "U01")
    assert row.denied is False and row.denied_at is None


def test_report_takes_a_position_or_a_denial(tx):
    rep = person(tx, "U01")
    assert locations.report(tx, rep, None, False, at=WORKING) is None
    assert locations.report(tx, rep, (*TAIPEI_101, None), False, at=WORKING) == "U01"
    assert locations.report(tx, rep, None, True, at=WORKING + dt.timedelta(minutes=5)) == "U01"


def test_the_share_state_names_the_manager(tx):
    state = locations.state(tx, person(tx, "U01"))
    assert (state.applies, state.paused, state.denied, state.manager_name) == (True, False, False, "陳建宏")
    assert state.hours == WEEKDAYS
    assert locations.state(tx, person(tx, "M01")).applies is False

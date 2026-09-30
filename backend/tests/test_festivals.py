"""節慶行事曆：談判卡圍繞「下一個節慶」，行事曆是設定檔 resources/festivals.json。"""

import datetime as dt

import catalog
import pytest

from app.services import festivals

# 決賽日，系統的「今天」
FINAL_DAY = dt.date(2026, 10, 28)


@pytest.mark.parametrize(
    ("today", "name"),
    [
        (dt.date(2026, 11, 10), "雙 11"),
        # 節日當天還算這一個：當天顧客還在買
        (dt.date(2026, 11, 11), "雙 11"),
        (dt.date(2026, 11, 12), "過年"),
    ],
)
def test_the_next_festival_is_the_nearest_one_on_or_after_today(today, name):
    assert festivals.upcoming(today)[0].name == name


def test_upcoming_festivals_run_from_the_nearest_to_the_farthest():
    dates = [festival.date for festival in festivals.upcoming(FINAL_DAY)]
    assert dates == sorted(dates) and all(day >= FINAL_DAY for day in dates)


def test_the_calendar_is_in_date_order_with_categories_from_the_product_table():
    calendar = festivals.load()
    assert [festival.date for festival in calendar] == sorted(festival.date for festival in calendar)
    assert len({festival.id for festival in calendar}) == len(calendar)
    categories = {product[2] for product in catalog.PRODUCTS}
    for festival in calendar:
        assert festival.categories and set(festival.categories) <= categories, festival.id
        # 兩句話都是人寫的，不能留空：連鎖看 customer_note，獨立藥局與診所看 cost_note
        assert festival.customer_note and festival.cost_note, festival.id


def test_the_calendar_covers_a_year_past_the_final_day():
    # 行事曆寫到哪裡，卡片的節慶區塊就顯示到哪裡：決賽之後至少還要有 12 個月
    assert festivals.load()[-1].date >= dt.date(2027, 10, 28)


def test_on_the_final_day_double_eleven_is_too_late_to_apply_and_new_year_is_next():
    first, second = festivals.upcoming(FINAL_DAY)[:2]
    assert (first.name, first.date) == ("雙 11", dt.date(2026, 11, 11))
    assert first.apply_by < FINAL_DAY
    # 過年 2/6，通路提前 28 天開賣（1/9），申請要再早 21 天
    assert (second.name, second.date) == ("過年", dt.date(2027, 2, 6))
    assert (second.sell_start, second.apply_by) == (dt.date(2027, 1, 9), dt.date(2026, 12, 19))


@pytest.mark.parametrize(
    "content",
    [
        None,  # 檔案不存在
        "{ 不是 JSON",
        '{"festivals": [{"id": "2026-x", "name": "少了日期"}]}',
        '{"festivals": [{"id": "2026-x", "name": "日期寫錯", "date": "11/11", "categories": ["保健品"], "customer_note": "a", "cost_note": "b"}]}',
    ],
)
def test_a_missing_or_broken_calendar_is_no_festivals(tmp_path, monkeypatch, caplog, content):
    path = tmp_path / "festivals.json"
    if content is not None:
        path.write_text(content, encoding="utf-8")
    monkeypatch.setattr(festivals, "FESTIVALS_FILE", path)
    assert festivals.load() == []
    assert festivals.upcoming(FINAL_DAY) == []
    assert "節慶行事曆" in caplog.text

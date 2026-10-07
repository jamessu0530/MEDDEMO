"""上次訂的（services/last_order.py）：兩張單怎麼合、上次走口的列跟這一期怎麼比。API 的測試在後面。"""

import datetime as dt
from decimal import Decimal

from app.services import last_order
from app.services.last_order import Change, Repeat, Source, SourceLine
from app.services.promo_packs import Pack


def pack(code, name, sku, buy, free, price, period="202609", deal=None):
    return Pack(
        code=code, promotion_name=f"{period}保藥特搭活動", group_name="測試", name=name, sku=sku,
        deal=deal or f"<{buy}+{free}>", buy_qty=buy, free_qty=free, deal_price=Decimal(price),
    )


def order(day, *lines):
    return Source("order", f"SO{day}", dt.date(2026, 10, day) if day > 0 else dt.date(2026, 9, 30 + day), tuple(lines))


def quote(day, *lines):
    return Source("quote", f"Q{day}", dt.date(2026, 10, day) if day > 0 else dt.date(2026, 9, 30 + day), tuple(lines))


SMALL = pack("P1", "Premium眼藥水(小口)", "F749579", 22, 1, 5500)
FISH = SourceLine("HS-FO30", 32)


def skus(rows):
    return [(source.kind, line.sku, line.qty) for source, line in rows]


def test_the_newer_one_leads_and_the_older_fills_in_what_it_lacks():
    newer = order(5, FISH, SourceLine("HS-CA60", 10))
    older = quote(0, SourceLine("HS-FO30", 40), SourceLine("F749579", 1, SMALL))
    rows, used = last_order.merge(newer, older)
    # 魚油兩邊都有，照比較新的進貨；報價補上進貨沒有的口
    assert skus(rows) == [("order", "HS-FO30", 32), ("order", "HS-CA60", 10), ("quote", "F749579", 1)]
    assert used == [newer, older]


def test_on_the_same_day_the_quote_leads():
    rows, used = last_order.merge(order(5, FISH), quote(5, SourceLine("HS-FO30", 40)))
    assert skus(rows) == [("quote", "HS-FO30", 40)] and [s.kind for s in used] == ["quote"]


def test_a_source_older_than_a_month_is_left_out():
    newer = order(5, FISH)
    rows, used = last_order.merge(newer, quote(-27, SourceLine("F749579", 1, SMALL)))  # 9/3，差 32 天
    assert skus(rows) == [("order", "HS-FO30", 32)] and used == [newer]


def test_packs_from_the_quote_replace_the_same_item_in_a_newer_order():
    # 報價成交之後才有交易：同一個品項交易記的是到貨數量，口要照報價
    newer = order(5, FISH, SourceLine("F749579", 23))
    older = quote(1, SourceLine("F749579", 1, SMALL), SourceLine("F749579", 10))
    rows, _ = last_order.merge(newer, older)
    assert skus(rows) == [("order", "HS-FO30", 32), ("quote", "F749579", 1), ("quote", "F749579", 10)]


def test_nothing_ordered_yet():
    assert last_order.merge(None, None) == ([], [])


MID_OLD = pack("P2", "40EXa眼藥水(中口)", "F763630", 57, 4, 7980)
SMALL_40 = pack("N1", "40EXa眼藥水(小口)", "F763630", 22, 1, 3080, period="202610")
JIN_OLD = pack("P3", "金舒胃平(小口)", "C130082", 10, 2, 800, deal="販促搭贈<10+1>+1")
WEI_OLD = pack("P4", "威鎮凝膠", "D120013", 11, 2, 990)


def test_an_unchanged_pack_is_copied_as_this_periods_pack():
    now = pack("N9", "Premium眼藥水(小口)", "F749579", 22, 1, 5500, period="202610")
    assert last_order.compare(SMALL, 2, [SMALL], [now], "Premium眼藥水") == (Repeat("F749579", 2, now), None)


def test_changed_terms_keep_the_pack_count():
    now = pack("N3", "金舒胃平(小口)", "C130082", 15, 2, 1200, period="202610", deal="販促搭贈<15+1>+1")
    repeat, change = last_order.compare(JIN_OLD, 3, [JIN_OLD], [now], "金舒胃平")
    assert repeat == Repeat("C130082", 3, now)
    assert change == Change("terms", "從買 10 送 2 變成買 15 送 2，一口 $800 → $1,200", "金舒胃平(小口)要買的量變多")


def test_other_kinds_of_term_changes():
    cheaper = pack("N3", "金舒胃平(小口)", "C130082", 10, 2, 700, period="202610", deal=JIN_OLD.deal)
    assert last_order.compare(JIN_OLD, 1, [JIN_OLD], [cheaper], "金舒胃平")[1] == Change(
        "terms", "一口從 $800 變 $700", "金舒胃平(小口)條件變了"
    )
    gift = pack("N3", "金舒胃平(小口)", "C130082", 10, 2, 800, period="202610", deal="販促搭贈<10+1>+1+贈試用包")
    assert last_order.compare(JIN_OLD, 1, [JIN_OLD], [gift], "金舒胃平")[1].text == "搭贈改成「販促搭贈<10+1>+1+贈試用包」"
    fewer = pack("N3", "金舒胃平(小口)", "C130082", 8, 1, 640, period="202610")
    assert last_order.compare(JIN_OLD, 1, [JIN_OLD], [fewer], "金舒胃平")[1].short == "金舒胃平(小口)要買的量變少"


def test_a_pack_that_is_gone_becomes_plain_at_the_paid_quantity():
    repeat, change = last_order.compare(MID_OLD, 1, [MID_OLD], [SMALL_40], "40EXa眼藥水")
    assert repeat == Repeat("F763630", 57)
    assert change == Change("pack_gone", "中口這期沒了，只剩小口（買 22 送 1，$3,080）", "40EXa眼藥水(中口)沒了")


def test_a_promotion_that_is_gone_becomes_plain_too():
    repeat, change = last_order.compare(WEI_OLD, 2, [WEI_OLD], [SMALL_40], "威鎮凝膠")
    assert repeat == Repeat("D120013", 22)
    assert change == Change("promo_gone", "這期沒有促銷了", "威鎮凝膠沒有促銷了")


def test_packs_with_the_same_name_match_by_rank():
    # 中化那種同名有好幾檔：照每口買的數量由小到大，取同一個順位
    old = [pack(f"O{n}", "固循魚油", "F764521", buy, free, price) for n, (buy, free, price) in
           enumerate([(5, 0, 4650), (9, 1, 8910), (17, 3, 16830)])]
    now = [pack(f"N{n}", "固循魚油", "F764521", buy, free, price, period="202610") for n, (buy, free, price) in
           enumerate([(5, 0, 4650), (9, 1, 8500), (17, 3, 16830)])]
    assert last_order.same_pack(old[1], old, now) == now[1]
    # 最大那一檔這期沒了：剩下的照這一期的順序列出來；送 0 個的口寫「直走」
    assert last_order.compare(old[2], 1, old, now[:2], "固循魚油")[1].text == (
        "固循魚油這期沒了，只剩固循魚油（直走 5，$4,650）、固循魚油（買 9 送 1，$8,500）"
    )

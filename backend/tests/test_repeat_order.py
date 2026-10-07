"""錄音講「跟上次一樣」：照上次訂的展開成下單意向（services/repeat_order.py）。"""

from datetime import date
from decimal import Decimal

from app.services import repeat_order
from app.services.extraction import ProductHint
from app.services.last_order import Change, LastOrder, Line, Repeat, Source
from app.services.promo_packs import Pack


def pack(code, name, sku, buy, free, price, period="202610"):
    return Pack(
        code=code, promotion_name=f"{period}保藥特搭活動", group_name="測試", name=name, sku=sku,
        deal=f"<{buy}+{free}>", buy_qty=buy, free_qty=free, deal_price=Decimal(price),
    )


PREMIUM_OLD = pack("OLD-P", "Premium眼藥水(小口)", "F749579", 22, 1, 5500, period="202609")
PREMIUM = pack("NOW-P", "Premium眼藥水(小口)", "F749579", 22, 1, 5500)
MID_OLD = pack("OLD-M", "40EXa眼藥水(中口)", "F763630", 57, 4, 7980, period="202609")
PACKS = [PREMIUM, pack("NOW-S", "40EXa眼藥水(小口)", "F763630", 22, 1, 3080)]
HINTS = {
    "HS-FO30": ProductHint("HS-FO30", "魚油 30 入", "盒", []),
    "HS-CA60": ProductHint("HS-CA60", "鈣片 60 錠", "瓶", []),
    "D120013": ProductHint("D120013", "威鎮凝膠", "支", []),
}
GONE = Change("pack_gone", "中口這期沒了，只剩小口（買 22 送 1，$3,080）", "40EXa眼藥水(中口)沒了")


def line(sku, name, unit, qty, repeat, pack=None, change=None, source="order"):
    return Line(sku=sku, name=name, spec="", unit=unit, supply_price=100, qty=qty, pack=pack, source=source, change=change, repeat=repeat)


LAST = LastOrder(
    order=Source("order", "SO20261005-C001", date(2026, 10, 5), ()),
    quote=Source("quote", "Q20260930-0001", date(2026, 9, 30), ()),
    lines=(
        line("F763630", "40EXa眼藥水", "瓶", 1, Repeat("F763630", 57), pack=MID_OLD, change=GONE, source="quote"),
        line("HS-FO30", "魚油 30 入", "盒", 32, Repeat("HS-FO30", 32)),
        line("D120013", "威鎮凝膠", "支", 5, Repeat("D120013", 5)),
        # 上次本來就有 40EXa 不走促銷 10 瓶：跟中口換成的 57 瓶併成一列
        line("F763630", "40EXa眼藥水", "瓶", 10, Repeat("F763630", 10), source="quote"),
        line("F749579", "Premium眼藥水", "盒", 1, Repeat("F749579", 1, PREMIUM), pack=PREMIUM_OLD, source="quote"),
    ),
)


def item(sku, text, qty, unit, code=None):
    return {"product_text": text, "sku": sku, "qty": qty, "unit": unit, "promo_code": code}


def repeat(all_=True, except_skus=(), relative=()):
    return {"all": all_, "except_skus": list(except_skus), "relative": list(relative)}


def rel(sku, delta, code=None, text="口述"):
    return {"product_text": text, "sku": sku, "promo_code": code, "delta": delta}


def test_saying_nothing_about_last_time_is_none():
    assert repeat_order.normalize(None) is None
    assert repeat_order.normalize({"all": False, "except_skus": [], "relative": []}) is None
    assert repeat_order.normalize({"all": True, "except_skus": None, "relative": None}) == repeat()


def test_same_as_last_time_copies_the_whole_order():
    found = repeat_order.expand(LAST, repeat(), None, "跟上次一樣就好", PACKS, HINTS)
    assert found.intent == [
        item("F763630", "40EXa眼藥水", 67, "瓶"),
        item("HS-FO30", "魚油 30 入", 32, "盒"),
        item("D120013", "威鎮凝膠", 5, "支"),
        item("F749579", "Premium眼藥水(小口)", 1, "口", "NOW-P"),
    ]
    assert found.note is None
    assert found.snapshot == {
        "said": "跟上次一樣就好", "all": True, "except_skus": [], "except_names": [],
        "order": {"order_no": "SO20261005-C001", "date": "2026-10-05"},
        "quote": {"quote_no": "Q20260930-0001", "date": "2026-09-30"},
        "empty": False, "copied": 4,
        "changes": [{"sku": "F763630", "promo_code": None, "text": GONE.text}],
        "relative": [],
    }


def test_items_said_not_to_be_ordered_are_left_out():
    found = repeat_order.expand(LAST, repeat(except_skus=["D120013", "NOPE"]), None, None, PACKS, HINTS)
    assert [i["sku"] for i in found.intent] == ["F763630", "HS-FO30", "F749579"]
    assert found.snapshot["except_names"] == ["威鎮凝膠", "NOPE"] and found.snapshot["copied"] == 3


def test_relative_changes_use_last_times_quantities():
    found = repeat_order.expand(LAST, repeat(relative=[
        rel("F749579", 1, "NOW-P"),   # 再加一口小口 Premium：1 + 1
        rel("HS-FO30", -32),          # 魚油少 32 盒：拿掉
        rel("HS-CA60", 6),            # 上次沒有、加的：新增一列
        rel("D120013", -9),           # 少到 0 以下：拿掉
        rel("HS-PB30", -3),           # 上次沒有、減的：不理
    ]), None, None, PACKS, HINTS)
    assert found.intent == [
        item("F763630", "40EXa眼藥水", 67, "瓶"),
        item("F749579", "Premium眼藥水(小口)", 2, "口", "NOW-P"),
        item("HS-CA60", "鈣片 60 錠", 6, "瓶"),
    ]
    assert found.snapshot["relative"] == [
        {"sku": "F749579", "promo_code": "NOW-P", "last_qty": 1, "delta": 1},
        {"sku": "HS-FO30", "promo_code": None, "last_qty": 32, "delta": -32},
        {"sku": "HS-CA60", "promo_code": None, "last_qty": 0, "delta": 6},
        {"sku": "D120013", "promo_code": None, "last_qty": 5, "delta": -9},
    ]


def test_only_relative_changes_produce_only_those_items():
    # 「人工淚液照上次、Premium 多一口」：沒講跟上次一樣，只產生講到的那幾項
    found = repeat_order.expand(LAST, repeat(all_=False, relative=[rel("HS-FO30", 0), rel("F749579", 1, "NOW-P")]), None, None, PACKS, HINTS)
    assert found.intent == [item("HS-FO30", "魚油 30 入", 32, "盒"), item("F749579", "Premium眼藥水(小口)", 2, "口", "NOW-P")]
    assert found.snapshot["copied"] == 0


def test_spoken_totals_replace_the_same_item_and_unmatched_items_go_last():
    spoken = [item("HS-FO30", "魚油", 40, "盒"), item(None, "那個新的眼藥水", None, None)]
    found = repeat_order.expand(LAST, repeat(relative=[rel("F749579", 1, "OLD-P"), rel(None, 2, text="什麼膠囊")]), spoken, None, PACKS, HINTS)
    assert found.intent == [
        item("F763630", "40EXa眼藥水", 67, "瓶"),
        item("D120013", "威鎮凝膠", 5, "支"),
        item("F749579", "Premium眼藥水(小口)", 1, "口", "NOW-P"),
        item("HS-FO30", "魚油", 40, "盒"),
        # 對不到品項的、口不是這一期的（OLD-P）都加在最後，確認頁標「缺少品項」
        item(None, "那個新的眼藥水", None, None),
        item(None, "口述", None, None),
        item(None, "什麼膠囊", None, None),
    ]


def test_a_customer_who_never_ordered_keeps_only_what_was_said():
    spoken = [item("HS-FO30", "魚油", 20, "盒")]
    found = repeat_order.expand(None, repeat(), spoken, "跟上次一樣", PACKS, HINTS)
    assert found.intent == spoken and found.note == repeat_order.EMPTY_NOTE
    assert found.snapshot["empty"] is True and found.snapshot["order"] is None and found.snapshot["copied"] == 0
    assert repeat_order.expand(None, repeat(), None, None, PACKS, HINTS).intent is None


def test_skipping_everything_leaves_no_intent():
    every = [l.sku for l in LAST.lines]
    assert repeat_order.expand(LAST, repeat(except_skus=every), None, None, PACKS, HINTS).intent is None


def test_a_relative_change_that_names_no_pack_lands_on_the_only_line_of_that_product():
    found = repeat_order.expand(LAST, repeat(relative=[rel("F749579", 1)]), None, "Premium 再加一口", PACKS, HINTS)
    assert item("F749579", "Premium眼藥水(小口)", 2, "口", "NOW-P") in found.intent
    assert found.snapshot["relative"] == [{"sku": "F749579", "promo_code": "NOW-P", "last_qty": 1, "delta": 1}]


def test_a_relative_change_that_names_no_pack_is_unmatched_when_the_product_has_several_lines():
    two = LastOrder(
        order=LAST.order, quote=LAST.quote,
        lines=(
            line("F749579", "Premium眼藥水", "盒", 1, Repeat("F749579", 1, PREMIUM), pack=PREMIUM_OLD),
            line("F749579", "Premium眼藥水", "盒", 1, Repeat("F749579", 1, PREMIUM_BIG), pack=PREMIUM_BIG),
        ),
    )
    found = repeat_order.expand(two, repeat(relative=[rel("F749579", 1, text="Premium")]), None, "x", PACKS, HINTS)
    assert found.intent[-1] == item(None, "Premium", None, None)
    assert found.snapshot["relative"] == []


PREMIUM_BIG = pack("NOW-PB", "Premium眼藥水(大口)", "F749579", 110, 18, 27500)

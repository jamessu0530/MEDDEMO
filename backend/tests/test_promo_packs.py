"""促銷的口：這一期有哪些、照編號查、一口換算成報價的一列。"""

from decimal import Decimal

from sqlalchemy.orm import Session

from app.services import promo_packs


def test_current_packs_are_the_running_period(engine):
    with Session(engine) as session:
        packs = promo_packs.current_packs(session)
    # 系統日 2026-10-28：進行中的是 202610 那一期
    assert {p.promotion_name for p in packs} == {"202610保藥特搭活動"}
    small = next(p for p in packs if p.name == "Premium眼藥水(小口)")
    assert (small.sku, small.buy_qty, small.free_qty, small.deal_price) == ("F749579", 22, 1, Decimal("5500"))
    assert [p.code for p in packs] == sorted(p.code for p in packs)


def test_packs_can_be_found_by_code_in_any_period(engine):
    with Session(engine) as session:
        # PP-027942 是照搬的 202608 那一期，已經結束
        found = promo_packs.packs_by_code(session, ["PP-027942", "PP-NOPE"])
        assert promo_packs.packs_by_code(session, []) == {}
    assert list(found) == ["PP-027942"] and found["PP-027942"].name == "Premium眼藥水(小口)"


def test_a_pack_becomes_one_quote_line(engine):
    with Session(engine) as session:
        packs = {p.name: p for p in promo_packs.current_packs(session)}
    line = promo_packs.pack_line(packs["Premium眼藥水(小口)"], 2)
    assert line == promo_packs.PackLine(qty=44, free_qty=2, unit_price=Decimal("250.00"), amount=Decimal("11000"))
    # 除不盡的口：金額照每口售價，單價只到分
    powder = promo_packs.pack_line(packs["骨營粉劑"], 1)
    assert (powder.qty, powder.free_qty, powder.unit_price, powder.amount) == (7, 0, Decimal("442.86"), Decimal("3100"))


def test_line_label():
    assert promo_packs.line_label("魚油 30 入", 20, None, None) == "魚油 30 入 × 20"
    assert promo_packs.line_label("Premium眼藥水", 22, "Premium眼藥水(小口)", 1) == "Premium眼藥水(小口) × 1 口"

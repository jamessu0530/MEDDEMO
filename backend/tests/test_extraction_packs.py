"""拜訪意向裡的促銷的口：提示帶這一期的口、AI 對不上的口清掉、存檔時檢查。"""

from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.services import extraction, promo_packs

PACK = promo_packs.Pack(
    code="PP-000001", promotion_name="202610保藥特搭活動", group_name="獅王眼藥水", name="Premium眼藥水(小口)",
    sku="F749579", deal="常態搭贈<22+1>", buy_qty=22, free_qty=1, deal_price=Decimal("5500"),
)


def item(**values):
    return {"product_text": "小口 Premium", "sku": "F749579", "qty": 1, "unit": "口", "promo_code": "PP-000001"} | values


def test_the_prompt_lists_this_periods_packs():
    prompt = extraction.build_prompt("逐字稿", date(2026, 10, 28), [], [PACK])
    assert "PP-000001｜F749579｜Premium眼藥水(小口)｜常態搭贈<22+1>" in prompt
    assert "promo_code" in prompt
    assert "這一期沒有促銷" in extraction.build_prompt("逐字稿", date(2026, 10, 28), [], [])


def test_packs_the_ai_cannot_back_up_are_cleared():
    kept = item()
    wrong_code = item(promo_code="PP-999999")
    wrong_sku = item(sku="F762488")
    plain = item(promo_code=None, unit="盒", qty=20)
    assert extraction.drop_unknown_packs([kept, wrong_code, wrong_sku, plain], [PACK]) == [
        kept,
        # 數量是口數，只清口會變成 1 盒：品項也清掉，讓確認頁標「缺少品項」
        item(promo_code=None, sku=None),
        item(promo_code=None, sku=None),
        plain,
    ]
    assert extraction.drop_unknown_packs(None, [PACK]) is None


def test_saved_packs_must_exist_and_match_the_product(engine):
    with Session(engine) as session:
        code = next(p.code for p in promo_packs.current_packs(session) if p.name == "Premium眼藥水(小口)")
        assert extraction.intent_pack_problems(session, [item(promo_code=code)]) == []
        assert extraction.intent_pack_problems(session, None) == []
        # 已經結束的那一期也收：確認頁可能在換期之後才存
        assert extraction.intent_pack_problems(session, [item(promo_code="PP-027942")]) == []
        assert extraction.intent_pack_problems(session, [item(promo_code="PP-NOPE")]) == ["意向第 1 項的促銷 PP-NOPE 不存在"]
        assert extraction.intent_pack_problems(session, [item(promo_code=code, sku="HS-FO30")]) == [
            "意向第 1 項的促銷不是這個品項"
        ]

"""促銷的口：報價與拜訪意向照口開（docs/superpowers/specs/2026-10-07-quote-promotion-packs-design.md）。

一口是促銷的一個購買單位：買 buy_qty 個、同品送 free_qty 個，整口 deal_price。哪一期照系統日進行中的那一期，
跟促銷頁、問答一樣讀語意層的 v_promotion_item，數字只有一份。
"""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

COLUMNS = "item_code AS code, promotion_name, group_name, item_name AS name, sku, deal, buy_qty, free_qty, deal_price"


@dataclass(frozen=True)
class Pack:
    code: str
    promotion_name: str
    group_name: str
    # 促銷品項名稱，口數寫在括號裡，例如 Premium眼藥水(小口)
    name: str
    sku: str
    # 搭贈說明原文；另外加贈的品項（骨粉、葡萄籽…）只寫在這裡
    deal: str
    buy_qty: int
    free_qty: int
    deal_price: Decimal


@dataclass(frozen=True)
class PackLine:
    """一口換算成報價的一列。"""

    # 付錢的數量（每口買的 × 口數）
    qty: int
    # 同品送的數量（每口送的 × 口數）
    free_qty: int
    # 每口售價 ÷ 每口買的數量，到分，只供參考
    unit_price: Decimal
    # 每口售價 × 口數
    amount: Decimal


def current_packs(session: Session) -> list[Pack]:
    """進行中那一期的每一口，照促銷品項編號排：同一個品牌的編號本來就連在一起。"""
    rows = session.execute(text(f"SELECT {COLUMNS} FROM v_promotion_item WHERE status = '進行中' ORDER BY item_code"))
    return [Pack(**row) for row in rows.mappings()]


def packs_by_code(session: Session, codes: Iterable[str]) -> dict[str, Pack]:
    """照編號查，不管是哪一期：確認頁存檔、回寫重送時，那一期可能已經結束。"""
    codes = sorted(set(codes))
    if not codes:
        return {}
    query = text(f"SELECT {COLUMNS} FROM v_promotion_item WHERE item_code IN :codes").bindparams(
        bindparam("codes", expanding=True)
    )
    return {row["code"]: Pack(**row) for row in session.execute(query, {"codes": codes}).mappings()}


def period_packs(session: Session, names: Iterable[str]) -> dict[str, list[Pack]]:
    """照促銷名稱查那幾期的每一口，鍵是促銷名稱。上次訂的要知道上次那一口在那一期排第幾。"""
    names = sorted(set(names))
    if not names:
        return {}
    query = text(f"SELECT {COLUMNS} FROM v_promotion_item WHERE promotion_name IN :names ORDER BY item_code").bindparams(
        bindparam("names", expanding=True)
    )
    found: dict[str, list[Pack]] = {name: [] for name in names}
    for row in session.execute(query, {"names": names}).mappings():
        found[row["promotion_name"]].append(Pack(**row))
    return found


def pack_line(pack: Pack, packs: int) -> PackLine:
    return PackLine(
        qty=pack.buy_qty * packs,
        free_qty=pack.free_qty * packs,
        unit_price=(pack.deal_price / pack.buy_qty).quantize(Decimal("0.01"), ROUND_HALF_UP),
        amount=pack.deal_price * packs,
    )


def line_label(product_name: str, qty: int, pack_name: str | None, packs: int | None) -> str:
    """報價一列的寫法：沒促銷是「魚油 30 入 × 20」，促銷是「Premium眼藥水(小口) × 1 口」。"""
    return f"{pack_name} × {packs} 口" if pack_name else f"{product_name} × {qty}"

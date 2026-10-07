"""錄音講「跟上次一樣」與跟上次比的加減：照上次訂的展開成下單意向
（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）。

AI 只聽出有沒有講、哪些不要、加減多少（extraction.REPEAT_SCHEMA）；要抄哪幾列、這期對應哪一口、變了什麼，
都照 last_order 算。展開那一刻的快照存在 visit.repeat_last，確認頁照它寫每一列變了什麼。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.services.extraction import ProductHint
from app.services.last_order import LastOrder
from app.services.promo_packs import Pack

EMPTY_NOTE = "說了跟上次一樣，但這家還沒有訂過，請手動填下單意向"


@dataclass
class Expanded:
    intent: list[dict[str, Any]] | None
    snapshot: dict[str, Any]
    # 確認頁最上面那行提示（visit.error_message）
    note: str | None


def normalize(value: Any) -> dict[str, Any] | None:
    """AI 的 repeat_last：all 是 false、沒有不要的、也沒有加減，當成沒講。"""
    if not value:
        return None
    repeat = {
        "all": bool(value.get("all")),
        "except_skus": list(value.get("except_skus") or []),
        "relative": list(value.get("relative") or []),
    }
    return repeat if repeat["all"] or repeat["except_skus"] or repeat["relative"] else None


def _plain(sku: str, name: str, unit: str | None, qty: int) -> dict[str, Any]:
    return {"product_text": name, "sku": sku, "qty": qty, "unit": unit, "promo_code": None}


def _packed(pack: Pack, packs: int) -> dict[str, Any]:
    return {"product_text": pack.name, "sku": pack.sku, "qty": packs, "unit": "口", "promo_code": pack.code}


def _unmatched(text: str) -> dict[str, Any]:
    return {"product_text": text, "sku": None, "qty": None, "unit": None, "promo_code": None}


def _key(item: dict[str, Any]) -> tuple[str | None, str | None]:
    return item["sku"], item["promo_code"]


def _base(last: LastOrder) -> list[dict[str, Any]]:
    """上次訂的每一列抄成下單意向的一項；同一個品項不走促銷的併成一列（報價不允許列兩次）。"""
    items: list[dict[str, Any]] = []
    for line in last.lines:
        repeat = line.repeat
        if repeat.pack:
            items.append(_packed(repeat.pack, repeat.qty))
        elif same := next((i for i in items if _key(i) == (repeat.sku, None)), None):
            same["qty"] += repeat.qty
        else:
            items.append(_plain(repeat.sku, line.name, line.unit, repeat.qty))
    return items


def _ref(source, key: str) -> dict[str, str] | None:
    return {key: source.no, "date": source.date.isoformat()} if source else None


def expand(
    last: LastOrder | None,
    repeat: dict[str, Any],
    intent: list[dict[str, Any]] | None,
    said: str | None,
    packs: Sequence[Pack],
    products: Mapping[str, ProductHint],
) -> Expanded:
    """照上次訂的展開：整張（all）→ 拿掉不要的 → 套加減 → 業務講的總數蓋掉同品項 → 對不到品項的加在最後。"""
    current = {p.code: p for p in packs}
    spoken = intent or []
    absolute = [i for i in spoken if i.get("sku")]
    unmatched = [i for i in spoken if not i.get("sku")]
    excepted = repeat["except_skus"]
    base = _base(last) if last else []
    result = [dict(i) for i in base if i["sku"] not in excepted] if repeat["all"] else []
    copied = len(result)
    relative = []
    for r in repeat["relative"]:
        code = r.get("promo_code")
        # 對不到品項、或口不是這一期的：當成對不到品項，讓確認頁標「缺少品項」
        if not r.get("sku") or (code and (code not in current or current[code].sku != r["sku"])):
            unmatched.append(_unmatched(r["product_text"]))
            continue
        if last is None:
            continue
        key = (r["sku"], code)
        before = next((i for i in base if _key(i) == key), None)
        at = next((n for n, i in enumerate(result) if _key(i) == key), None)
        if before is None:
            # 上次沒有這一列：加的就新增一列，減的或照上次不理
            if r["delta"] > 0:
                hint = products.get(r["sku"])
                result.append(_packed(current[code], r["delta"]) if code else _plain(
                    r["sku"], hint.name if hint else r["product_text"], hint.unit if hint else None, r["delta"]
                ))
                relative.append({"sku": r["sku"], "promo_code": code, "last_qty": 0, "delta": r["delta"]})
            continue
        qty = before["qty"] + r["delta"]
        if at is not None and qty > 0:
            result[at]["qty"] = qty
        elif at is not None:
            del result[at]
        elif qty > 0:
            result.append({**before, "qty": qty})
        relative.append({"sku": r["sku"], "promo_code": code, "last_qty": before["qty"], "delta": r["delta"]})
    replaced = {i["sku"] for i in absolute}
    result = [i for i in result if i["sku"] not in replaced] + absolute + unmatched
    snapshot = {
        "said": said,
        "all": repeat["all"],
        "except_skus": excepted,
        "except_names": [products[sku].name if sku in products else sku for sku in excepted],
        "order": _ref(last.order, "order_no") if last else None,
        "quote": _ref(last.quote, "quote_no") if last else None,
        "empty": last is None,
        "copied": copied,
        "changes": [
            {"sku": line.sku, "promo_code": line.repeat.promo_code, "text": line.change.text}
            for line in (last.lines if last else ())
            if line.change and line.sku not in excepted
        ],
        "relative": relative,
    }
    return Expanded(result or None, snapshot, EMPTY_NOTE if last is None else None)

"""上次訂的（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）：上一次進貨與上一張報價合起來，
上次走口的列跟這一期比。客戶檔案、報價頁的「照上次填」、錄音的「跟上次一樣」都讀這裡，數字只有一份。

內容只來自資料庫，不讓 AI 生成：變了什麼那幾句是照數字套規則寫的。
"""

import datetime as dt
import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.services.promo_packs import Pack

# 舊的那張只在跟新的相差這麼多天以內才拿來補：促銷一個月一期，太舊的單不湊
SUPPLEMENT_DAYS = 31
# 上一張報價只算已成交的：還沒成交的草稿客戶還沒訂，今日路線也把它當「報價草稿還沒成交」的商機
QUOTE_STATUSES = ("ordered",)
# 促銷品項名稱把口寫在最後的括號裡，例如 40EXa眼藥水(中口)
SIZE = re.compile(r"\(([^()]*口)\)$")


@dataclass(frozen=True)
class SourceLine:
    """上次那張單的一列：沒走口是品項 × 數量；走口是某一口 × 口數（qty 是口數）。"""

    sku: str
    qty: int
    pack: Pack | None = None


@dataclass(frozen=True)
class Source:
    kind: str  # order＝進貨，quote＝報價
    no: str
    date: dt.date
    lines: tuple[SourceLine, ...]


@dataclass(frozen=True)
class Change:
    kind: str  # terms＝同一口條件變了，pack_gone＝這一口沒了，promo_gone＝這期沒有促銷
    text: str  # 寫在那一列下面
    short: str  # 「進門前三分鐘」那句用的


@dataclass(frozen=True)
class Repeat:
    """這次照抄成什麼：品項 × 數量，或這一期的某一口 × 口數。"""

    sku: str
    qty: int
    # 這一期的那一口；None 是不走促銷
    pack: Pack | None = None

    @property
    def promo_code(self) -> str | None:
        return self.pack.code if self.pack else None


def merge(order: Source | None, quote: Source | None) -> tuple[list[tuple[Source, SourceLine]], list[Source]]:
    """兩張單合成上次訂的，回傳（每一列與它來自哪張, 有用到的單）。

    新的為主、整張照抄；同一天報價為主（報價有記口）。舊的那張只在相差 SUPPLEMENT_DAYS 天以內才補新的沒有的品項。
    新的是進貨、舊的是報價時，報價裡走口的品項換成報價的列：真實流程報價成交後才有交易，不這樣口會被交易蓋掉。
    """
    sources = sorted((s for s in (order, quote) if s), key=lambda s: (s.date, s.kind == "quote"), reverse=True)
    if not sources:
        return [], []
    main = sources[0]
    rows = [(main, line) for line in main.lines]
    used = [main]
    if len(sources) == 2 and (main.date - sources[1].date).days <= SUPPLEMENT_DAYS:
        other = sources[1]
        if main.kind == "order":
            packed = {line.sku for line in other.lines if line.pack}
            rows = [(source, line) for source, line in rows if line.sku not in packed]
        have = {line.sku for _, line in rows}
        extra = [(other, line) for line in other.lines if line.sku not in have]
        if extra:
            rows += extra
            used.append(other)
    return rows, used


def _label(pack: Pack) -> str:
    """口的叫法：名稱括號裡的小口、中口、大口；名稱沒有括號的用整個名稱。"""
    found = SIZE.search(pack.name)
    return found.group(1) if found else pack.name


def _deal(pack: Pack) -> str:
    # 跟前端 lib/quote.ts 的 packDeal 一樣：送 0 個的是直走
    return f"買 {pack.buy_qty} 送 {pack.free_qty}" if pack.free_qty else f"直走 {pack.buy_qty}"


def _money(amount) -> str:
    return f"${amount:,.0f}"


def _siblings(pack: Pack, packs: Sequence[Pack]) -> list[Pack]:
    return sorted((p for p in packs if p.sku == pack.sku and p.name == pack.name), key=lambda p: (p.buy_qty, p.code))


def same_pack(pack: Pack, previous: Sequence[Pack], current: Sequence[Pack]) -> Pack | None:
    """這一期的同一口：同一個品項、同名；同名有好幾檔的，照每口買的數量由小到大取同一個順位。

    previous 是上次那一口所在那一期的每一口。
    """
    rank = [p.code for p in _siblings(pack, previous)].index(pack.code)
    now = _siblings(pack, current)
    return now[rank] if rank < len(now) else None


def _terms(old: Pack, new: Pack) -> Change | None:
    if (old.buy_qty, old.free_qty) != (new.buy_qty, new.free_qty):
        text = f"從{_deal(old)} 變成{_deal(new)}"
        if old.deal_price != new.deal_price:
            text += f"，一口 {_money(old.deal_price)} → {_money(new.deal_price)}"
    elif old.deal_price != new.deal_price:
        text = f"一口從 {_money(old.deal_price)} 變 {_money(new.deal_price)}"
    elif old.deal != new.deal:
        text = f"搭贈改成「{new.deal}」"
    else:
        return None
    if new.buy_qty > old.buy_qty:
        short = f"{old.name}要買的量變多"
    elif new.buy_qty < old.buy_qty:
        short = f"{old.name}要買的量變少"
    else:
        short = f"{old.name}條件變了"
    return Change("terms", text, short)


def compare(
    pack: Pack, packs: int, previous: Sequence[Pack], current: Sequence[Pack], product_name: str
) -> tuple[Repeat, Change | None]:
    """上次走的那一口跟這一期比：回傳（這次抄成什麼, 變了什麼）。

    同一口還在就抄這一期那一口、口數不變（條件變了照新條件）；口沒了或促銷沒了改成不走促銷，
    數量是上次付錢的數量（每口買的 × 口數）。
    """
    now = same_pack(pack, previous, current)
    if now:
        return Repeat(pack.sku, packs, now), _terms(pack, now)
    plain = Repeat(pack.sku, pack.buy_qty * packs)
    others = [p for p in current if p.sku == pack.sku]
    if others:
        left = "、".join(f"{_label(p)}（{_deal(p)}，{_money(p.deal_price)}）" for p in others)
        return plain, Change("pack_gone", f"{_label(pack)}這期沒了，只剩{left}", f"{pack.name}沒了")
    return plain, Change("promo_gone", "這期沒有促銷了", f"{product_name}沒有促銷了")

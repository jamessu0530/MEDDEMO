"""節慶行事曆：談判卡圍繞「下一個節慶」。

行事曆是設定檔 resources/festivals.json，不進資料庫：跟 negotiation_topics.json 同一個道理，
改檔就能調整（NFR-10），也不必為了加一個節慶重灌資料。每個節慶的那兩句話是人寫的，不讓 AI 生成（NFR-1）。
"""

import datetime as dt
import json
import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

FESTIVALS_FILE = Path(__file__).resolve().parents[1] / "resources" / "festivals.json"

# 通路提前幾天開賣，設定檔沒寫就用這個
DEFAULT_LEAD_DAYS = 28
# 《檔期活動申請與成效回報》：檔期活動須在活動開始日前 21 天提出申請
APPLY_LEAD_DAYS = 21


@dataclass(frozen=True)
class Festival:
    id: str  # 2026-double11
    name: str
    date: dt.date  # 節日當天
    lead_days: int
    categories: list[str]  # 主推品類，值是品項表的類別
    customer_note: str  # 顧客導向的一句話：這個節慶誰在買、買什麼
    cost_note: str  # 成本導向的一句話：這一檔進貨要注意什麼

    @property
    def sell_start(self) -> dt.date:
        """通路開賣的那一天，檔期活動從這天起算"""
        return self.date - dt.timedelta(days=self.lead_days)

    @property
    def apply_by(self) -> dt.date:
        """檔期最晚哪一天要送申請"""
        return self.sell_start - dt.timedelta(days=APPLY_LEAD_DAYS)


def load() -> list[Festival]:
    """整份行事曆，照日期由早到晚。讀不到或格式不對就當成沒有節慶：卡片少一個區塊，其餘照常。"""
    try:
        rows = json.loads(FESTIVALS_FILE.read_text(encoding="utf-8"))["festivals"]
        calendar = [
            Festival(
                id=row["id"],
                name=row["name"],
                date=dt.date.fromisoformat(row["date"]),
                lead_days=int(row.get("lead_days", DEFAULT_LEAD_DAYS)),
                categories=list(row["categories"]),
                customer_note=row["customer_note"],
                cost_note=row["cost_note"],
            )
            for row in rows
        ]
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        log.exception("節慶行事曆 %s 讀不到或格式不對，談判卡先不顯示節慶", FESTIVALS_FILE)
        return []
    return sorted(calendar, key=lambda festival: festival.date)


def upcoming(today: dt.date) -> list[Festival]:
    """節日在今天或之後的節慶，由近到遠。第一個就是「下一個節慶」；節日當天還算這一個。"""
    return [festival for festival in load() if festival.date >= today]

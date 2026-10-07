"""座騎圖鑑：記下業務騎過哪些座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎圖鑑〉）。"""

import datetime as dt
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import LEG_MODES, RIDE_CITIES, VehicleRide


@dataclass
class Ridden:
    city: str
    mode: str
    ridden_at: dt.datetime | None  # 第一次騎的時間；沒騎過是 None


def record(session: Session, user_id: str, rides: list[tuple[str, str]]) -> None:
    """記下騎過的座騎。已經記過的不動，第一次的時間照舊。"""
    if not rides:
        return
    rows = [{"user_id": user_id, "city": city, "mode": mode} for city, mode in dict.fromkeys(rides)]
    session.execute(
        insert(VehicleRide).values(rows).on_conflict_do_nothing(index_elements=["user_id", "city", "mode"])
    )


def collection(session: Session, user_id: str) -> list[Ridden]:
    """28 種座騎（七個縣市 × 四種交通方式）各騎過沒有，照縣市、交通方式的順序。"""
    found = {
        (city, mode): at
        for city, mode, at in session.execute(
            select(VehicleRide.city, VehicleRide.mode, VehicleRide.first_ridden_at).where(VehicleRide.user_id == user_id)
        )
    }
    return [Ridden(city, mode, found.get((city, mode))) for city in RIDE_CITIES for mode in LEG_MODES]

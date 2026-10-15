"""熊熊滾收藏：縣市款來自到站紀錄，異色由分裂抽選；收藏永久保存、裝備由伺服器驗證。"""

import json
import secrets
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Itinerary, MascotCollectible, MascotEncounter, MascotWardrobe, StopArrival

CATALOG = json.loads((Path(__file__).resolve().parents[1] / "mascot_catalog.json").read_text())
COLORS = {item["id"]: item for item in CATALOG["colors"]}
OUTFITS = {item["id"]: item for item in CATALOG["outfits"]}
SHINY_COLORS = tuple(key for key, item in COLORS.items() if item["rarity"] == "shiny")
SHINY_ODDS = 8


def profile(session: Session, user_id: str) -> MascotWardrobe:
    session.execute(insert(MascotWardrobe).values(user_id=user_id).on_conflict_do_nothing())
    # 序列化同帳號的抽選、收藏、裝備；同時從兩台裝置來也不會漏掉收藏或保底次數。
    return session.scalar(select(MascotWardrobe).where(MascotWardrobe.user_id == user_id).with_for_update())


def grant(session: Session, user_id: str, item_id: str) -> bool:
    added = session.scalar(
        insert(MascotCollectible).values(user_id=user_id, item_id=item_id)
        .on_conflict_do_nothing().returning(MascotCollectible.item_id)
    )
    return added is not None


def visited_cities(session: Session, user: AppUser) -> set[str]:
    rep_id = user.acts_as_user_id or user.id
    return set(session.scalars(
        select(Customer.city).join(StopArrival, StopArrival.customer_id == Customer.id)
        .join(Itinerary, Itinerary.id == StopArrival.itinerary_id)
        .where(Itinerary.user_id == rep_id, Customer.city.is_not(None)).distinct()
    ))


def sync_collection(session: Session, user: AppUser) -> MascotWardrobe:
    row = profile(session, user.id)
    cities = {city.replace("臺", "台") for city in visited_cities(session, user)}
    grant(session, user.id, "color:classic")
    for item in OUTFITS.values():
        if item["city"] is None or item["city"] in cities:
            grant(session, user.id, f"outfit:{item['id']}")
    return row


def snapshot(session: Session, user: AppUser, row: MascotWardrobe) -> dict:
    owned = dict(session.execute(select(MascotCollectible.item_id, MascotCollectible.unlocked_at).where(MascotCollectible.user_id == user.id)).all())
    def items(kind, entries):
        return [item | {"owned": f"{kind}:{item['id']}" in owned, "unlocked_at": owned.get(f"{kind}:{item['id']}")} for item in entries]
    return {
        "colors": items("color", CATALOG["colors"]), "outfits": items("outfit", CATALOG["outfits"]),
        "equipped": {"color": row.color_id, "outfit": row.outfit_id}, "use_as_avatar": row.use_as_avatar,
        "encounters": session.scalar(select(func.count()).select_from(MascotEncounter).where(MascotEncounter.user_id == user.id)),
        "shiny_odds": SHINY_ODDS, "guaranteed_in": SHINY_ODDS - row.misses,
    }


def encounter(session: Session, user: AppUser, event_id: str) -> tuple[MascotEncounter, MascotWardrobe]:
    row = sync_collection(session, user)
    previous = session.get(MascotEncounter, (user.id, event_id))
    if previous is not None:
        return previous, row
    shiny = row.misses >= SHINY_ODDS - 1 or secrets.randbelow(SHINY_ODDS) == 0
    color = secrets.choice(SHINY_COLORS) if shiny else "classic"
    added = grant(session, user.id, f"color:{color}")
    row.misses = 0 if shiny else row.misses + 1
    found = MascotEncounter(user_id=user.id, event_id=event_id, color_id=color, newly_collected=added)
    session.add(found)
    session.flush()
    return found, row


def equip(session: Session, user: AppUser, color: str, outfit: str, use_as_avatar: bool) -> MascotWardrobe:
    row = sync_collection(session, user)
    if color not in COLORS or outfit not in OUTFITS:
        raise ValueError("找不到這款熊熊滾")
    if any(session.get(MascotCollectible, (user.id, item)) is None for item in (f"color:{color}", f"outfit:{outfit}")):
        raise ValueError("這款還沒收藏，可以先試穿，解鎖後再換上")
    row.color_id, row.outfit_id, row.use_as_avatar = color, outfit, use_as_avatar
    row.updated_at = func.now()
    session.flush()
    return row


def avatar_looks(session: Session) -> dict[str, dict[str, str]]:
    rows = session.execute(
        select(MascotWardrobe.user_id, MascotWardrobe.color_id, MascotWardrobe.outfit_id)
        .join(AppUser, AppUser.id == MascotWardrobe.user_id)
        .where(MascotWardrobe.use_as_avatar.is_(True), AppUser.deactivated_at.is_(None))
    )
    return {user_id: {"color": color, "outfit": outfit} for user_id, color, outfit in rows}

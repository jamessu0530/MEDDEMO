"""保留拜訪紀錄裡首次提到競品的標籤。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Visit
from app.services import customer_profile


def first_competitors(session: Session, visit: Visit, fields: dict) -> list[str]:
    """這次提到、而且這家客戶以前確認過的拜訪從沒提過的競品（原型抽欄位畫面的「首次」）。"""
    names = [c["name"] for c in fields.get("competitor") or []]
    if not names:
        return []
    earlier = session.scalars(
        select(Visit.fields_final).where(
            Visit.customer_id == visit.customer_id,
            Visit.status.in_(customer_profile.CONFIRMED),
            # 用編號比先後，不用拜訪時間：假資料的拜訪日期排在決賽日（2026-10-28）之前，
            # 展示時真的錄的拜訪卻是現在的時間，比時間會變成「比所有舊紀錄都早」。
            # 編號由 visit_seq 照建立順序發，固定五位數補零，字串比較就是先後
            Visit.id < visit.id,
        )
    )
    seen = {c["name"] for f in earlier for c in (f or {}).get("competitor") or []}
    return [name for name in names if name not in seen]

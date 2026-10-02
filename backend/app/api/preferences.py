"""帳號設定 API（docs/superpowers/specs/2026-10-02-cloud-settings-design.md）：配色與字體大小。

存在伺服器、跟著帳號，換一支手機登入也一樣。手機裡另外留一份，下次打開在畫面出來前就先套上（frontend/index.html），
登入後再跟這裡對一次。改了就發即時事件，同一個帳號開著的其他手機、電腦跟著換（app/realtime.py）。
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app import realtime
from app.api.auth import CurrentUser
from app.db import get_session
from app.models import UserPreference

router = APIRouter(prefix="/api/preferences", tags=["preferences"])
SessionDep = Annotated[Session, Depends(get_session)]

Skin = Literal["light", "dark"]
TextSize = Literal["standard", "large", "xlarge"]
# 還沒存過的帳號，第一次只改一項時另一項用這個
DEFAULTS = {"skin": "light", "text_size": "standard"}


class Preferences(BaseModel):
    # 兩個都是 None：這個帳號還沒存過。手機會把它現在的設定傳上來，換成存伺服器之前選的不會不見
    skin: Skin | None
    text_size: TextSize | None


class PreferencesUpdate(BaseModel):
    # 沒帶的不動：兩支手機同時各改一項，不會互相蓋掉
    skin: Skin | None = None
    text_size: TextSize | None = None


@router.get("/me", response_model=Preferences)
def get_mine(session: SessionDep, user: CurrentUser):
    row = session.get(UserPreference, user.id)
    return Preferences(skin=row.skin, text_size=row.text_size) if row else Preferences(skin=None, text_size=None)


@router.patch("/me", response_model=Preferences)
def update_mine(session: SessionDep, user: CurrentUser, body: PreferencesUpdate):
    changes = body.model_dump(exclude_none=True)
    # 一句 upsert：兩支手機同時第一次存，不會撞主鍵
    stmt = insert(UserPreference).values(user_id=user.id, **(DEFAULTS | changes))
    skin, text_size = session.execute(
        stmt.on_conflict_do_update(index_elements=[UserPreference.user_id], set_=changes | {"updated_at": func.now()})
        .returning(UserPreference.skin, UserPreference.text_size)
    ).one()
    session.commit()
    realtime.preferences_changed(user.id)
    return Preferences(skin=skin, text_size=text_size)

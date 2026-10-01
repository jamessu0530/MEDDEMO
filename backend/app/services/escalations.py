"""轉給主管的提問誰看得到。主管端的 API（api/escalations.py）與提問附的照片（services/attachments.py）共用。"""

from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import aliased

from app.models import AppUser, AskRecord
from app.services.scope import SHARING_LEVEL, Scope

# 進得了主管端的角色（跟 api/auth.py 的 MANAGER_SIDE_ROLES 一致；這裡不能反過來引用 api 層）
INBOX_ROLES = ("manager", "it")

# 提問的人。AppUser 在查詢裡已經拿來 join 回覆的主管，所以另外取別名
Asker = aliased(AppUser)


def visible_to(user: AppUser) -> Any:
    """業務只看得到自己轉出去的提問；主管看得到自己底下的人轉來的，IT 看得到全公司的
    （SHARING_LEVEL["manager_inbox"]）。自建帳號不在組織樹上，換算成他代理的那位業務再看。
    查詢要 join Asker（AskRecord.user_id）。"""
    if user.role in INBOX_ROLES:
        asker = func.coalesce(Asker.acts_as_user_id, Asker.id)
        return Scope.for_user(user).includes(SHARING_LEVEL["manager_inbox"], asker)
    return AskRecord.user_id == user.id

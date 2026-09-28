"""組織管理（只有 IT 能用，見 api/admin.py）：換主管、主管調區、改角色、新增與停用帳號、移交客戶。

每個操作依序做：檢查 → 改資料 → rebuild_org_paths（重算路徑與轄區，順便驗證整棵樹）→
還沒簽的出差單跟著新主管 → 寫一筆異動紀錄。檢查不過丟 OrgError，訊息直接給 IT 看。
提交由呼叫端負責：中途任何一步失敗就整個回滾，不會留下改了一半的組織。

幾條護欄：
- IT 帳號不能在這裡改，也不能把人升成 IT。最高權限只從 data/seed/catalog.py 來。
- 示範業務（auth.EXTERNAL_ACCOUNT_ACTS_AS）不能改角色、不能停用：所有自建與第三方登入的帳號都看他的客戶。
- 停用的人留在樹上原位，不拿掉路徑：他的歷史拜訪照舊給原本的團隊看，路徑一拿掉連 IT 都看不到
  （Scope.can_see 對 NULL 一律拒絕）。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, OaApprovalStep, OaExpenseForm, OrgChangeLog, OrgUnit
from app.services import auth
from app.services.oa import MANAGER_STEP_LABEL
from app.services.org import rebuild_org_paths

# 組織管理頁開得出來、改得過去的角色
ASSIGNABLE_ROLES = ("sales", "manager")
ROLE_LABEL = {"sales": "業務", "manager": "主管", "it": "IT"}
# 新帳號的工號前綴，號碼接著目前最大的編
ID_PREFIX = {"sales": "U", "manager": "M"}
LOG_LIMIT = 50


class OrgError(Exception):
    """組織異動不合規則。訊息是給 IT 看的中文。"""


class NotFound(OrgError):
    """指定的帳號或客戶不存在。"""


# ── 讀 ────────────────────────────────────────────────────────────


def chart(session: Session) -> dict[str, Any]:
    """組織管理頁要的全部資料：地理節點、每個公司帳號（含停用的）、最近的異動紀錄。
    自建與第三方登入的帳號不在組織裡，不列。"""
    units = session.scalars(select(OrgUnit).order_by(OrgUnit.id)).all()
    users = session.scalars(select(AppUser).where(AppUser.acts_as_user_id.is_(None)).order_by(AppUser.id)).all()
    customers = dict(session.execute(select(Customer.owner_user_id, func.count()).group_by(Customer.owner_user_id)).all())
    log = session.execute(
        select(OrgChangeLog, AppUser.name)
        .join(AppUser, AppUser.id == OrgChangeLog.actor_id)
        .order_by(OrgChangeLog.created_at.desc(), OrgChangeLog.id.desc())
        .limit(LOG_LIMIT)
    ).all()
    return {
        "units": [{"id": u.id, "name": u.name, "kind": u.kind, "parent_id": u.parent_id} for u in units],
        "users": [
            {
                "id": u.id, "name": u.name, "role": u.role, "region": u.region, "email": u.email,
                "manager_id": u.manager_id, "unit_id": u.unit_id, "active": u.deactivated_at is None,
                "customer_count": customers.get(u.id, 0),
            }
            for u in users
        ],
        "log": [
            {"id": entry.id, "actor_name": actor, "detail": entry.detail, "created_at": entry.created_at}
            for entry, actor in log
        ],
    }


# ── 改 ────────────────────────────────────────────────────────────


def change_manager(session: Session, actor: AppUser, user_id: str, manager_id: str) -> None:
    """換業務的直屬主管。停用的業務也可以換：主管要降職前，得先把底下的人（含停用的）移走。"""
    user = _editable(session, user_id)
    if user.role != "sales":
        raise OrgError(f"{user.name}是{ROLE_LABEL[user.role]}，只有業務有直屬主管")
    manager = _active_manager(session, manager_id)
    if manager.id == user.manager_id:
        return
    before = session.get(AppUser, user.manager_id)
    user.manager_id = manager.id
    _rebuild(session)
    _follow_manager(session, user)
    _log(session, actor, "manager", f"{user.name}的直屬主管從{before.name}改成{manager.name}")


def move_manager(session: Session, actor: AppUser, user_id: str, unit_id: str) -> None:
    """主管調區，底下的人跟著走（路徑與轄區一起重算）。"""
    user = _editable(session, user_id)
    if user.role != "manager":
        raise OrgError(f"{user.name}是業務，業務跟著直屬主管在哪一區；要調區請換一位那一區的主管")
    unit = _region(session, unit_id)
    if unit.id == user.unit_id:
        return
    before = session.get(OrgUnit, user.unit_id)
    user.unit_id = unit.id
    _rebuild(session)
    team = len(_reports(session, user, active_only=False))
    followers = f"，底下 {team} 位業務跟著調" if team else ""
    _log(session, actor, "unit", f"{user.name}從{before.name}調到{unit.name}{followers}")


def change_role(
    session: Session,
    actor: AppUser,
    user_id: str,
    role: str,
    *,
    manager_id: str | None = None,
    unit_id: str | None = None,
    successor_id: str | None = None,
) -> None:
    """業務升主管（要選一區；名下的客戶整批交給 successor）或主管降業務（底下要先清空；要選新主管）。

    主管沒有自己的路線（services/today_route.py 只排業務的），所以升主管前客戶一定要交出去。
    降職前底下的人要清空，停用的也算：他們接在這位主管後面，主管一變成業務，樹就長到第五層。
    """
    user = _editable(session, user_id)
    if role not in ASSIGNABLE_ROLES:
        raise OrgError("角色只能改成業務或主管")
    if role == user.role:
        return
    if user.deactivated_at is not None:
        raise OrgError(f"{user.name}已停用，先重新啟用再改角色")
    if user.id == auth.EXTERNAL_ACCOUNT_ACTS_AS:
        raise OrgError(f"{user.name}是示範業務，自建與第三方登入的帳號都看他的客戶，不能改角色")
    if role == "manager":
        unit = _region(session, unit_id)
        handed = _hand_over(session, user, successor_id)
        user.role, user.manager_id, user.unit_id = "manager", None, unit.id
        detail = f"{user.name}從業務升為{unit.name}主管{handed}"
    else:
        reports = len(_reports(session, user, active_only=False))
        if reports:
            raise OrgError(f"{user.name}底下還有 {reports} 位業務（含停用的），先把他們換到別的主管底下")
        manager = _active_manager(session, manager_id)
        user.role, user.unit_id, user.manager_id = "sales", None, manager.id
        detail = f"{user.name}從主管改為業務，直屬主管是{manager.name}"
    _rebuild(session)
    if role == "sales":
        _follow_manager(session, user)
    _log(session, actor, "role", detail)


def create_user(
    session: Session,
    actor: AppUser,
    *,
    name: str,
    email: str,
    password: str,
    role: str,
    manager_id: str | None = None,
    unit_id: str | None = None,
) -> AppUser:
    """開公司帳號。業務要選直屬主管，主管要選一區；工號接著目前最大號編。
    初始密碼由 IT 自己告訴對方（沒有寄信服務），對方登入後可以在帳號設定改。"""
    if role not in ASSIGNABLE_ROLES:
        raise OrgError("新帳號只能是業務或主管")
    try:
        name = auth.validate_name(name)
    except ValueError as exc:
        raise OrgError(str(exc)) from None
    email = auth.normalize_email(email)
    if not auth.EMAIL_SHAPE.match(email):
        raise OrgError("Email 格式不對")
    if len(password) < auth.MIN_PASSWORD_LENGTH:
        raise OrgError(f"初始密碼至少要 {auth.MIN_PASSWORD_LENGTH} 碼")
    if session.scalar(select(AppUser.id).where(AppUser.email == email)):
        raise OrgError("這個 Email 已經有帳號了")
    if role == "sales":
        position = {"manager_id": _active_manager(session, manager_id).id}
    else:
        position = {"unit_id": _region(session, unit_id).id}
    user = AppUser(
        id=_next_id(session, role), name=name, role=role, email=email,
        password_hash=auth.hash_password(password),
        # region 與 org_path 由 rebuild_org_paths 算；這裡先放空字串，寫入前就會換掉
        region="", **position,
    )
    session.add(user)
    _rebuild(session)
    _log(session, actor, "create", f"新增{ROLE_LABEL[role]}{user.name}（{user.id}，{user.region}）")
    return user


def deactivate(session: Session, actor: AppUser, user_id: str, successor_id: str | None = None) -> None:
    """停用：登不進來（services/auth.py），已登入的裝置下一個請求就被登出。名下的客戶整批交給 successor。"""
    user = _editable(session, user_id)
    if user.deactivated_at is not None:
        return
    if user.id == auth.EXTERNAL_ACCOUNT_ACTS_AS:
        raise OrgError(f"{user.name}是示範業務，自建與第三方登入的帳號都看他的客戶，不能停用")
    if user.role == "manager":
        reports = len(_reports(session, user, active_only=True))
        if reports:
            raise OrgError(f"{user.name}底下還有 {reports} 位在職的業務，先把他們換到別的主管底下")
    handed = _hand_over(session, user, successor_id)
    user.deactivated_at = func.now()
    _log(session, actor, "deactivate", f"停用{user.name}{handed}")


def reactivate(session: Session, actor: AppUser, user_id: str) -> None:
    user = _editable(session, user_id)
    if user.deactivated_at is None:
        return
    if user.role == "sales":
        manager = session.get(AppUser, user.manager_id)
        if manager.deactivated_at is not None:
            raise OrgError(f"{user.name}的直屬主管{manager.name}已停用，先幫他換一位在職的主管")
    user.deactivated_at = None
    _log(session, actor, "reactivate", f"重新啟用{user.name}")


def reassign_customer(session: Session, actor: AppUser, customer_id: str, owner_id: str) -> None:
    """換一家客戶的負責人。只改 owner_user_id：過去的拜訪、報價、出差單仍記在原本的人名下。"""
    customer = session.get(Customer, customer_id)
    if customer is None:
        raise NotFound("找不到這家客戶")
    if owner_id == customer.owner_user_id:
        return
    before = session.get(AppUser, customer.owner_user_id)
    successor = _successor(session, before, owner_id)
    customer.owner_user_id = successor.id
    _log(session, actor, "customer", f"{customer.name}的負責人從{before.name}改成{successor.name}")


# ── 共用的檢查與動作 ──────────────────────────────────────────────


def _editable(session: Session, user_id: str) -> AppUser:
    """組織管理頁改得動的帳號：公司帳號，而且不是 IT。"""
    user = session.get(AppUser, user_id)
    if user is None or user.acts_as_user_id is not None:
        raise NotFound("找不到這個帳號")
    if user.role == "it":
        raise OrgError("IT 帳號不能在這裡改")
    return user


def _active_manager(session: Session, manager_id: str | None) -> AppUser:
    manager = session.get(AppUser, manager_id) if manager_id else None
    if manager is None or manager.role != "manager":
        raise OrgError("直屬主管要選一位主管")
    if manager.deactivated_at is not None:
        raise OrgError(f"{manager.name}已停用，不能帶人")
    return manager


def _region(session: Session, unit_id: str | None) -> OrgUnit:
    unit = session.get(OrgUnit, unit_id) if unit_id else None
    if unit is None or unit.kind != "region":
        raise OrgError("要選一個區")
    return unit


def _successor(session: Session, user: AppUser, successor_id: str | None) -> AppUser:
    """接手客戶的人：在職的公司業務，不能是原本那位。"""
    successor = session.get(AppUser, successor_id) if successor_id else None
    if successor is None or successor.role != "sales" or successor.acts_as_user_id is not None:
        raise OrgError("接手的人要選一位業務")
    if successor.deactivated_at is not None:
        raise OrgError(f"{successor.name}已停用，不能接手客戶")
    if successor.id == user.id:
        raise OrgError("接手的人不能是原本的負責人")
    return successor


def _reports(session: Session, manager: AppUser, *, active_only: bool) -> list[AppUser]:
    stmt = select(AppUser).where(AppUser.manager_id == manager.id)
    if active_only:
        stmt = stmt.where(AppUser.deactivated_at.is_(None))
    return list(session.scalars(stmt))


def _hand_over(session: Session, user: AppUser, successor_id: str | None) -> str:
    """把 user 名下的客戶整批轉給 successor；沒有客戶就不必指定。回傳接在異動紀錄後面的半句話。"""
    count = session.scalar(select(func.count()).select_from(Customer).where(Customer.owner_user_id == user.id))
    if not count:
        return ""
    if not successor_id:
        raise OrgError(f"{user.name}名下有 {count} 家客戶，要指定一位業務接手")
    successor = _successor(session, user, successor_id)
    session.execute(update(Customer).where(Customer.owner_user_id == user.id).values(owner_user_id=successor.id))
    return f"，{count} 家客戶移交給{successor.name}"


def _follow_manager(session: Session, rep: AppUser) -> None:
    """業務換了主管：他還沒簽完的出差單，「經辦人的主管」那一關改指派給新主管。已經簽過的是歷史，不動。"""
    forms = select(OaExpenseForm.id).where(OaExpenseForm.applicant_id == rep.id)
    session.execute(
        update(OaApprovalStep)
        .where(
            OaApprovalStep.form_id.in_(forms),
            OaApprovalStep.role_label == MANAGER_STEP_LABEL,
            OaApprovalStep.status == "pending",
        )
        .values(user_id=rep.manager_id)
    )


def _rebuild(session: Session) -> None:
    """重算整棵樹。規則寫在 paths_from_reports，這裡的檢查漏掉的，它還會再擋一次。"""
    try:
        rebuild_org_paths(session)
    except ValueError as exc:
        raise OrgError(str(exc)) from None


def _next_id(session: Session, role: str) -> str:
    prefix = ID_PREFIX[role]
    ids = session.scalars(select(AppUser.id).where(AppUser.id.startswith(prefix))).all()
    numbers = [int(i[len(prefix):]) for i in ids if i[len(prefix):].isdigit()]
    return f"{prefix}{max(numbers, default=0) + 1:02d}"


def _log(session: Session, actor: AppUser, action: str, detail: str) -> None:
    session.add(OrgChangeLog(actor_id=actor.id, action=action, detail=detail))

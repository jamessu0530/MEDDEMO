"""持久化提醒與 Web Push。站內輪詢和每分鐘背景工作共用去重鍵。"""

import base64
import datetime as dt
import hashlib
import json

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppUser, PlannerMember, PlannerNotification, PlannerPushSubscription
from app.services import planner
from app.timeutil import TAIPEI


def push_public_key() -> str | None:
    raw = settings().calendar_vapid_private_key
    if not raw or not settings().calendar_vapid_subject:
        return None
    try:
        scalar = int.from_bytes(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)), "big")
        key = ec.derive_private_key(scalar, ec.SECP256R1()).public_key()
        return base64.urlsafe_b64encode(key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)).decode().rstrip("=")
    except (ValueError, TypeError):
        return None


def generate(session: Session, user: AppUser, now: dt.datetime | None = None):
    now = now or dt.datetime.now(dt.UTC)
    emails = planner.emails_for(session, user)
    for event in planner.accessible_events(session, user):
        if not event.reminders and not any(v.get("reminders") for v in (event.exceptions or {}).values()):
            continue
        member = session.get(PlannerMember, (event.calendar_id, user.id))
        from app.models import PlannerAttendee

        attendee = session.scalar(select(PlannerAttendee).where(PlannerAttendee.event_id == event.id, PlannerAttendee.email.in_(emails)))
        # 明確拒絕的行程不提醒；單獨受邀者需先接受／暫定。
        if attendee and attendee.status == "declined":
            continue
        if not (member and member.status == "accepted") and not (attendee and attendee.status in {"accepted", "tentative"}):
            continue
        for occurrence in planner.occurrences(event, now - dt.timedelta(days=1), now + dt.timedelta(days=15)):
            start = dt.datetime.fromisoformat(occurrence["starts_at"])
            # 已經結束的活動不補通知；過去一天錯過的通知仍可在活動開始前補送。
            if dt.datetime.fromisoformat(occurrence["ends_at"]) <= now:
                continue
            for minutes in occurrence["reminders"]:
                due = start - dt.timedelta(minutes=minutes)
                if not now - dt.timedelta(days=1) <= due <= now:
                    continue
                identity = hashlib.sha256(f"{user.id}:{event.id}:{occurrence['starts_at']}:{minutes}".encode()).hexdigest()
                session.execute(insert(PlannerNotification).values(id=identity, user_id=user.id, event_id=event.id,
                    occurrence=start, title=occurrence["title"], due_at=due).on_conflict_do_nothing())


def send_pending_push(session: Session):
    if not push_public_key():
        return
    from pywebpush import WebPushException, webpush

    now = dt.datetime.now(dt.UTC)
    notifications = session.scalars(select(PlannerNotification).where(
        PlannerNotification.pushed_at.is_(None), PlannerNotification.read_at.is_(None),
        PlannerNotification.due_at >= now - dt.timedelta(hours=1),
    ).with_for_update(skip_locked=True)).all()
    for notice in notifications:
        user = session.get(AppUser, notice.user_id)
        subscriptions = session.scalars(select(PlannerPushSubscription).where(PlannerPushSubscription.user_id == notice.user_id)).all()
        retry = False
        for subscription in subscriptions:
            if not user or user.deactivated_at or user.session_version != subscription.session_version:
                session.delete(subscription)
                continue
            try:
                webpush(subscription_info=subscription.subscription,
                    data=json.dumps({"title": notice.title, "body": "行程即將開始", "tag": notice.id,
                                     "url": f"/calendar?event={notice.event_id}&date={notice.occurrence.astimezone(TAIPEI).date()}"}),
                    vapid_private_key=settings().calendar_vapid_private_key,
                    vapid_claims={"sub": settings().calendar_vapid_subject}, ttl=3600, timeout=10)
            except WebPushException as exc:
                if exc.response is not None and exc.response.status_code in (404, 410):
                    session.delete(subscription)
                else:
                    retry = True
        if not retry:
            notice.pushed_at = now

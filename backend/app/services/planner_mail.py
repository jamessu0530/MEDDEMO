"""使用者明確按傳送才寄邀請；不在建立行程或背景同步時自動寄送。"""

import datetime as dt
import hashlib
import secrets
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from redis.exceptions import RedisError

from app.config import settings
from app.models import AppUser, PlannerAttendee, PlannerCalendar, PlannerEvent
from app.services.auth import EMAIL_SHAPE
from app.services.planner_ics import export_ics
from app.tasks import redis


def configured() -> bool:
    config = settings()
    base = urlsplit(config.calendar_public_base_url)
    return bool(config.calendar_smtp_host and EMAIL_SHAPE.fullmatch(config.calendar_smtp_from)
                and base.scheme == "https" and base.hostname and not base.username and not base.query and not base.fragment)


def send(session: Session, event: PlannerEvent) -> dict:
    if not configured():
        raise HTTPException(503, "伺服器尚未設定邀請郵件，可先下載 ICS 邀請檔")
    config = settings()
    calendar = session.get(PlannerCalendar, event.calendar_id)
    owner = session.get(AppUser, calendar.owner_id)
    attendees = session.scalars(select(PlannerAttendee).where(PlannerAttendee.event_id == event.id).order_by(PlannerAttendee.email)).all()
    if not attendees:
        raise HTTPException(422, "這個行程還沒有邀請對象")
    tokens = {attendee.email: secrets.token_urlsafe(32) for attendee in attendees}
    now = dt.datetime.now(dt.UTC)
    if any(a.last_invited_at and now - a.last_invited_at < dt.timedelta(minutes=5) for a in attendees):
        raise HTTPException(429, "邀請剛剛已寄出，請五分鐘後再重新傳送")
    # 公開註冊的帳號也可用日曆，寄送需有帳號及全站的每日上限。
    try:
        permitted = redis().eval("""
            local count = tonumber(ARGV[1])
            if tonumber(redis.call('GET', KEYS[1]) or 0) + count > 200 or
               tonumber(redis.call('GET', KEYS[2]) or 0) + count > 1000 then return 0 end
            redis.call('INCRBY', KEYS[1], count); redis.call('EXPIRE', KEYS[1], 172800)
            redis.call('INCRBY', KEYS[2], count); redis.call('EXPIRE', KEYS[2], 172800)
            return 1
        """, 2, f"calendar-mail:{calendar.owner_id}:{now.date()}", f"calendar-mail:all:{now.date()}", len(attendees))
    except RedisError:
        raise HTTPException(503, "邀請郵件服務暫時無法使用，請稍後再試") from None
    if not permitted:
        raise HTTPException(429, "今天的邀請郵件已達上限，請明天再試或下載 ICS 邀請")
    # 先提交回覆 token，郵件到達前端點已可使用；不修改行程的版本。
    for attendee in attendees:
        attendee.response_token_hash = hashlib.sha256(tokens[attendee.email].encode()).hexdigest()
    raw = export_ics(session, [event], calendar.name, owner.email or config.calendar_smtp_from, "REQUEST")
    title, owner_name, owner_email = event.title, owner.name, owner.email
    begins = event.starts_at.astimezone(ZoneInfo(event.timezone)).strftime("%Y/%m/%d %H:%M")
    description, location, timezone = event.description, event.location, event.timezone
    session.commit()
    sent, failed = [], []
    context = ssl.create_default_context()
    try:
        connection = smtplib.SMTP(config.calendar_smtp_host, config.calendar_smtp_port, timeout=10) if config.calendar_smtp_starttls else smtplib.SMTP_SSL(config.calendar_smtp_host, config.calendar_smtp_port, timeout=10, context=context)
        with connection as smtp:
            if config.calendar_smtp_starttls:
                smtp.ehlo(); smtp.starttls(context=context); smtp.ehlo()
            if config.calendar_smtp_username:
                smtp.login(config.calendar_smtp_username, config.calendar_smtp_password)
            for attendee in attendees:
                email = EmailMessage()
                email["From"], email["To"] = config.calendar_smtp_from, attendee.email
                email["Subject"] = "行程邀請：" + " ".join(title.splitlines())
                if owner_email:
                    email["Reply-To"] = owner_email
                link = f"{config.calendar_public_base_url.rstrip('/')}/api/planner/invitations/{tokens[attendee.email]}"
                email.set_content(f"{owner_name} 邀請你參加：{title}\n時間：{begins}（{timezone}）\n地點：{location}\n\n{description}\n\n查看並回覆邀請：{link}\n\n也可將附加的 ICS 行程加入你的日曆。")
                email.add_alternative(raw.decode(), subtype="calendar", params={"method": "REQUEST"})
                try:
                    smtp.send_message(email)
                    attendee.last_invited_at = dt.datetime.now(dt.UTC)
                    sent.append(attendee.email)
                except (smtplib.SMTPException, OSError):
                    failed.append(attendee.email)
    except (smtplib.SMTPException, OSError):
        raise HTTPException(502, "邀請郵件暫時無法送出，行程已保留，請稍後重試") from None
    session.commit()
    return {"sent": sent, "failed": failed}

"""ICS 訂閱與 CalDAV 雙向同步。外部修改使用 ETag 條件寫入，不覆蓋衝突。"""

import base64
import datetime as dt
import hashlib
import ipaddress
import json
import socket
from urllib.parse import quote, urljoin, urlsplit

import httpx
from cryptography.fernet import Fernet, InvalidToken
from defusedxml import ElementTree as ET
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import PlannerCalendar, PlannerEvent
from app.services.planner_ics import MAX_ICS_BYTES, export_ics, import_ics, read_ics

DAV = "{DAV:}"
CAL = "{urn:ietf:params:xml:ns:caldav}"


def credential_cipher() -> Fernet:
    config = settings()
    key = config.calendar_encryption_key
    if not key and config.jwt_secret:
        key = base64.urlsafe_b64encode(hashlib.sha256(("meddemo-calendar:" + config.jwt_secret).encode()).digest()).decode()
    if not key:
        raise HTTPException(503, "伺服器需設定日曆加密金鑰，才能安全儲存外部帳號")
    try:
        return Fernet(key.encode())
    except ValueError:
        raise HTTPException(503, "伺服器的日曆加密金鑰格式不正確") from None


def encrypt_credentials(username: str, password: str) -> str:
    return credential_cipher().encrypt(json.dumps({"username": username, "password": password}).encode()).decode()


def decrypt_credentials(value: str) -> dict:
    try:
        return json.loads(credential_cipher().decrypt(value.encode()))
    except (InvalidToken, ValueError):
        raise HTTPException(503, "外部帳號金鑰已變更，請重新連接") from None


def remote_url(value: str) -> str:
    value = value.replace("webcal://", "https://", 1) if value.startswith("webcal://") else value
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise HTTPException(422, "日曆網址格式不正確") from None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment or port not in (None, 443):
        raise HTTPException(422, "外部日曆須使用不含帳號密碼的 HTTPS 網址")
    host = parsed.hostname.lower()
    allowed = [part.strip().lower() for part in settings().calendar_remote_hosts.split(",") if part.strip()]
    if not any(host == rule or (rule.startswith("*.") and host.endswith(rule[1:])) for rule in allowed):
        raise HTTPException(422, "尚未允許這個日曆服務，請管理員將主機加入 CALENDAR_REMOTE_HOSTS")
    try:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError()
    except (socket.gaierror, ValueError):
        raise HTTPException(422, "日曆網址必須連到公開網路服務") from None
    return value


def same_provider(first: str, second: str) -> bool:
    a, b = urlsplit(first).hostname, urlsplit(second).hostname
    return a == b or (a.endswith(".icloud.com") and b.endswith(".icloud.com"))


def request(method: str, url: str, *, auth=None, content=None, headers=None) -> httpx.Response:
    url = remote_url(url)
    try:
        with httpx.Client(timeout=httpx.Timeout(15, connect=5), follow_redirects=False, trust_env=False) as client:
            for _ in range(4):
                with client.stream(method, url, auth=auth, content=content, headers=headers) as response:
                    if response.status_code in (301, 302, 307, 308):
                        next_url = remote_url(urljoin(url, response.headers.get("location", "")))
                        if auth and not same_provider(url, next_url):
                            raise HTTPException(422, "外部服務導向了不同供應商，已停止傳送帳號資料")
                        url = next_url
                        continue
                    raw = bytearray()
                    for chunk in response.iter_bytes():
                        raw.extend(chunk)
                        if len(raw) > MAX_ICS_BYTES:
                            raise HTTPException(413, "外部日曆超過 2 MB 上限")
                    result = httpx.Response(response.status_code, headers=response.headers, content=bytes(raw), request=response.request)
                    if result.status_code in (401, 403):
                        raise HTTPException(422, "外部日曆拒絕存取，請檢查帳號、App 專用密碼與權限")
                    return result
        raise HTTPException(422, "外部日曆重新導向次數過多")
    except httpx.HTTPError:
        raise HTTPException(502, "暫時連不上外部日曆，請稍後重試") from None


def checked(response: httpx.Response, expected=(200, 201, 204, 207)):
    if response.status_code in (409, 412):
        raise HTTPException(409, "外部行程已被修改；保留本機變更，請先解決同步衝突")
    if response.status_code not in expected:
        raise HTTPException(502, f"外部日曆回應 {response.status_code}，尚未完成同步")
    return response


def properties(url: str, auth, depth="0"):
    body = b'''<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/></d:prop></d:propfind>'''
    response = checked(request("PROPFIND", url, auth=auth, content=body, headers={"Depth": depth, "Content-Type": "application/xml; charset=utf-8"}), (207,))
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError:
        raise HTTPException(422, "外部服務沒有回傳有效的 CalDAV 資料") from None
    return root, str(response.url)


def discover(url: str, username: str, password: str) -> list[dict]:
    auth = (username, password)
    root, base = properties(url, auth)
    if root.find(f".//{CAL}calendar") is not None:
        return [{"url": base, "name": root.findtext(f".//{DAV}displayname", "外部日曆")}]
    home = root.findtext(f".//{CAL}calendar-home-set/{DAV}href")
    if not home:
        principal = root.findtext(f".//{DAV}current-user-principal/{DAV}href")
        if not principal:
            raise HTTPException(422, "找不到日曆帳號，請提供 CalDAV 伺服器或日曆網址")
        principal_url = remote_url(urljoin(base, principal))
        if not same_provider(base, principal_url):
            raise HTTPException(422, "CalDAV 帳號導向了不同供應商")
        root, base = properties(principal_url, auth)
        home = root.findtext(f".//{CAL}calendar-home-set/{DAV}href")
    if not home:
        raise HTTPException(422, "這個帳號沒有可用的日曆集合")
    home_url = remote_url(urljoin(base, home))
    if not same_provider(base, home_url):
        raise HTTPException(422, "CalDAV 集合導向了不同供應商")
    root, base = properties(home_url, auth, "1")
    calendars = []
    for response in root.findall(f"{DAV}response"):
        if response.find(f".//{CAL}calendar") is not None:
            target = remote_url(urljoin(base, response.findtext(f"{DAV}href", "")))
            if same_provider(base, target):
                calendars.append({"url": target, "name": response.findtext(f".//{DAV}displayname", "外部日曆")})
    if not calendars:
        raise HTTPException(422, "這個帳號沒有可連接的日曆")
    return calendars


def sync_ics(session: Session, calendar: PlannerCalendar):
    response = checked(request("GET", calendar.remote_url), (200,))
    parsed = read_ics(response.content, calendar.id)
    uids = {item["uid"] for item in parsed}
    import_ics(session, calendar, response.content, remote=True)
    for event in session.scalars(select(PlannerEvent).where(PlannerEvent.calendar_id == calendar.id)):
        if event.uid not in uids:
            event.deleted_at = dt.datetime.now(dt.UTC)


def sync_caldav(session: Session, calendar: PlannerCalendar, resolution: str | None = None):
    credentials = decrypt_credentials(calendar.credentials)
    auth = (credentials["username"], credentials["password"])
    report = b'''<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>'''
    response = checked(request("REPORT", calendar.remote_url, auth=auth, content=report, headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"}), (207,))
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError:
        raise HTTPException(422, "外部日曆回傳格式不正確") from None
    remote = {}
    base = str(response.url).rstrip("/") + "/"
    for item in root.findall(f"{DAV}response"):
        data = item.findtext(f".//{CAL}calendar-data")
        if data is None:
            continue
        href = remote_url(urljoin(base, item.findtext(f"{DAV}href", "")))
        # 遠端回傳的資源只能在此日曆集合內，不能拿它的 href 發送其他請求。
        if not href.startswith(base):
            raise HTTPException(422, "外部日曆回傳了集合以外的行程網址")
        parsed = read_ics(data.encode(), calendar.id)
        if len(parsed) != 1:
            raise HTTPException(422, "每個 CalDAV 資源須包含一個行程系列")
        remote[href] = {"raw": data.encode(), "etag": item.findtext(f".//{DAV}getetag"), "uid": parsed[0]["uid"]}
        if not remote[href]["etag"]:
            raise HTTPException(502, "外部日曆未提供版本標記，尚未開始寫入")
    local = session.scalars(select(PlannerEvent).where(PlannerEvent.calendar_id == calendar.id)).all()
    # 先檢查所有衝突，再發送任何寫入；避免前半同步成功、後半才發現已有衝突。
    for event in local:
        if event.dirty and event.remote_href and (event.remote_href not in remote or remote[event.remote_href]["etag"] != event.remote_etag):
            if resolution == "remote":
                event.dirty = False
            elif resolution == "local":
                event.remote_etag = remote.get(event.remote_href, {}).get("etag")
                if event.remote_href not in remote:
                    event.remote_href = None
            else:
                raise HTTPException(409, "外部行程已被修改或刪除；本機變更已保留，請選擇保留哪個版本")
    pushed = set()
    for event in local:
        if not event.dirty:
            continue
        href = event.remote_href or urljoin(base, quote(event.id) + ".ics")
        if event.deleted_at:
            if event.remote_href:
                checked(request("DELETE", href, auth=auth, headers={"If-Match": event.remote_etag}), (200, 204, 404))
            event.dirty = False
            remote.pop(href, None)
            continue
        headers = {"Content-Type": "text/calendar; charset=utf-8", **({"If-Match": event.remote_etag} if event.remote_href else {"If-None-Match": "*"})}
        sent = checked(request("PUT", href, auth=auth, content=export_ics(session, [event], calendar.name), headers=headers))
        etag = sent.headers.get("etag")
        if not etag:
            etag = checked(request("HEAD", href, auth=auth)).headers.get("etag")
        if not etag:
            raise HTTPException(502, "外部服務未提供版本標記，已停止同步以保護行程")
        event.remote_href, event.remote_etag, event.dirty = href, etag, False
        pushed.add(href)
    for href, item in remote.items():
        unchanged = any(e.remote_href == href and e.remote_etag == item["etag"] and not e.dirty for e in local)
        if href not in pushed and not unchanged:
            import_ics(session, calendar, item["raw"], remote_href=href, remote_etag=item["etag"], remote=True)
    for event in local:
        if not event.dirty and event.remote_href and event.remote_href not in remote and event.remote_href not in pushed:
            event.deleted_at = dt.datetime.now(dt.UTC)


def sync(session: Session, calendar: PlannerCalendar, resolution: str | None = None):
    if calendar.source == "ics":
        sync_ics(session, calendar)
    elif calendar.source == "caldav":
        sync_caldav(session, calendar, resolution)
    calendar.synced_at, calendar.sync_error = dt.datetime.now(dt.UTC), None

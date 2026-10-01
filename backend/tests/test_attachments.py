"""附件（services/attachments.py、api/attachments.py、頻道發言帶檔案）。

照片上傳前一律重新整理：轉正、清掉 EXIF（GPS 位置不能留著）、縮到長邊 2048、存成 JPEG 或 PNG；
PDF 檢查打得開、沒加密、頁數不超過上限。看附件靠簽名網址，取檔時每次再查一次權限。
"""

import datetime as dt
import io
import threading
import time

import jwt
import pytest
from fastapi.testclient import TestClient
from PIL import ExifTags, Image
from pypdf import PdfWriter
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.main import app
from app.models import AppUser, AskRecord, Attachment, Channel, ChannelMessage, Escalation
from app.services import attachments, auth as auth_service, channels


@pytest.fixture
def client():
    return TestClient(app)


def photo(size=(3000, 1000), fmt="JPEG", mode="RGB", orientation=None, gps=False, color=(200, 30, 30)) -> bytes:
    image = Image.new(mode, size, color if mode == "RGB" else (*color, 128))
    exif = Image.Exif()
    if orientation:
        exif[ExifTags.Base.Orientation] = orientation
    if gps:
        exif[ExifTags.IFD.GPSInfo] = {ExifTags.GPS.GPSLatitudeRef: "N", ExifTags.GPS.GPSLatitude: (25.0, 2.0, 30.0)}
    exif[ExifTags.Base.Model] = "iPhone 17"
    buffer = io.BytesIO()
    image.save(buffer, fmt, exif=exif)
    return buffer.getvalue()


def pdf(pages=2, password=None) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=595, height=842)
    if password:
        writer.encrypt(password)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def opened(content: bytes) -> Image.Image:
    return Image.open(io.BytesIO(content))


# ---- 整理上傳的檔案 ----


def test_photos_lose_their_exif_including_the_location():
    prepared = attachments.prepare(photo(gps=True), "IMG_0001.HEIC")
    image = opened(prepared.content)
    assert "exif" not in image.info
    assert len(image.getexif()) == 0
    assert b"iPhone" not in prepared.content
    assert "exif" not in opened(prepared.thumbnail).info
    # 存成 JPEG，副檔名跟著改，原本的檔名留著
    assert (prepared.kind, prepared.mime_type, prepared.filename) == ("image", "image/jpeg", "IMG_0001.jpg")


def test_photos_are_turned_upright_and_shrunk():
    # Orientation 6：手機直拿拍的，存成橫的，要順時針轉 90 度才是正的
    prepared = attachments.prepare(photo(size=(3000, 1000), orientation=6), "a.jpg")
    assert (prepared.width, prepared.height) == (683, 2048)
    assert opened(prepared.content).size == (683, 2048)
    assert max(opened(prepared.thumbnail).size) == 480


def test_small_photos_are_not_enlarged():
    prepared = attachments.prepare(photo(size=(640, 480)), "small.jpg")
    assert (prepared.width, prepared.height) == (640, 480)


def test_transparent_images_stay_png_and_opaque_ones_become_jpeg():
    transparent = attachments.prepare(photo(size=(200, 200), fmt="PNG", mode="RGBA"), "logo.png")
    assert (transparent.mime_type, opened(transparent.content).format) == ("image/png", "PNG")
    # 縮圖一律是 JPEG（透明的地方墊白）
    assert opened(transparent.thumbnail).format == "JPEG"
    screenshot = attachments.prepare(photo(size=(200, 200), fmt="PNG"), "screen.png")
    assert (screenshot.mime_type, screenshot.filename) == ("image/jpeg", "screen.jpg")
    webp = attachments.prepare(photo(size=(200, 200), fmt="WEBP"), "a.webp")
    assert webp.mime_type == "image/jpeg"


@pytest.mark.parametrize(
    ("raw", "status"),
    [
        (b"not an image at all", 415),
        (b"\x00\x00\x00\x18ftypheic" + b"\x00" * 100, 415),
        (b"", 422),
    ],
)
def test_files_that_are_not_photos_or_pdfs_are_refused(raw, status):
    with pytest.raises(attachments.Rejected) as caught:
        attachments.prepare(raw, "x.heic")
    assert caught.value.status == status


def test_gif_is_refused_even_though_pillow_can_read_it():
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buffer, "GIF")
    with pytest.raises(attachments.Rejected) as caught:
        attachments.prepare(buffer.getvalue(), "a.gif")
    assert caught.value.status == 415


def test_files_over_the_size_limit_are_refused(monkeypatch):
    monkeypatch.setattr(attachments, "MAX_FILE_BYTES", 1000)
    with pytest.raises(attachments.Rejected) as caught:
        attachments.prepare(photo(), "big.jpg")
    assert caught.value.status == 413


def test_pdfs_are_kept_as_they_are():
    raw = pdf(pages=3)
    prepared = attachments.prepare(raw, "衛教單張.pdf")
    assert (prepared.kind, prepared.mime_type, prepared.page_count, prepared.thumbnail) == ("pdf", "application/pdf", 3, None)
    assert prepared.content == raw


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (pdf(password="1234"), "密碼"),
        (pdf(pages=attachments.MAX_PDF_PAGES + 1), "最多"),
        (b"%PDF-1.7\nbroken", "打不開"),
    ],
)
def test_encrypted_long_or_broken_pdfs_are_refused(raw, message):
    with pytest.raises(attachments.Rejected) as caught:
        attachments.prepare(raw, "a.pdf")
    assert caught.value.status == 415
    assert message in str(caught.value)


def test_filenames_keep_only_the_name():
    assert attachments.clean_filename("../../etc/passwd", "x") == "passwd"
    assert attachments.clean_filename("C:\\Users\\me\\海報.jpg", "x") == "海報.jpg"
    assert attachments.clean_filename("a\x00b.jpg", "x") == "ab.jpg"
    assert attachments.clean_filename("", "照片.jpg") == "照片.jpg"
    long = attachments.clean_filename("字" * 300 + ".jpeg", "x")
    assert len(long) == attachments.FILENAME_LIMIT and long.endswith(".jpeg")


# ---- 頻道發言帶檔案 ----


def channel_id(client, auth, name: str, user_id: str = "U01") -> int:
    return next(c["id"] for c in client.get("/api/channels", headers=auth(user_id)).json() if c["name"] == name)


def upload(client, headers, channel, body="", files=()):
    return client.post(
        f"/api/channels/{channel}/messages",
        data={"body": body},
        files=[("files", (name, content, "application/octet-stream")) for name, content in files],
        headers=headers,
    )


def test_a_message_can_carry_photos_and_pdfs(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組")
    posted = upload(client, auth("U01"), team, "  御松田的新海報  ", [("poster.jpg", photo()), ("dm.pdf", pdf())])
    assert posted.status_code == 201
    message = posted.json()
    assert message["body"] == "御松田的新海報"
    image, document = message["attachments"]
    assert (image["kind"], image["filename"], image["width"], image["height"]) == ("image", "poster.jpg", 2048, 683)
    assert image["thumb_url"].startswith(f"/api/attachments/{image['id']}/thumb?sig=")
    assert (document["kind"], document["page_count"], document["thumb_url"]) == ("pdf", 2, None)
    # 同組的人列訊息時拿得到自己的簽名網址
    listed = client.get(f"/api/channels/{team}/messages", headers=auth("U02")).json()
    assert [a["id"] for a in listed[-1]["attachments"]] == [image["id"], document["id"]]
    stored = tx.get(Attachment, image["id"])
    assert (stored.uploader_id, stored.status, stored.caption) == ("U01", "pending", None)


def test_a_message_can_be_only_files_but_not_empty(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組")
    only_photo = upload(client, auth("U01"), team, "", [("a.jpg", photo())])
    assert only_photo.status_code == 201
    assert only_photo.json()["body"] == ""
    assert upload(client, auth("U01"), team, "   ").status_code == 422


def test_too_many_files_or_a_bad_file_posts_nothing(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組")
    before = len(client.get(f"/api/channels/{team}/messages", headers=auth("U01")).json())
    five = [(f"{i}.jpg", photo(size=(10, 10))) for i in range(5)]
    assert upload(client, auth("U01"), team, "五張", five).status_code == 422
    bad = upload(client, auth("U01"), team, "一張壞的", [("a.jpg", photo()), ("b.jpg", b"garbage")])
    assert bad.status_code == 415
    assert "JPEG" in bad.json()["detail"]
    assert len(client.get(f"/api/channels/{team}/messages", headers=auth("U01")).json()) == before


def test_json_posts_still_work_and_still_validate(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組")
    assert client.post(f"/api/channels/{team}/messages", json={"body": "純文字"}, headers=auth("U01")).status_code == 201
    assert client.post(f"/api/channels/{team}/messages", json={"body": ""}, headers=auth("U01")).status_code == 422
    assert client.post(f"/api/channels/{team}/messages", json={}, headers=auth("U01")).status_code == 422


# ---- 看附件 ----


def posted_photo(client, auth, user_id="U01", channel="陳建宏小組") -> dict:
    team = channel_id(client, auth, channel, user_id)
    response = upload(client, auth(user_id), team, "照片", [("a.jpg", photo(size=(800, 600)))])
    assert response.status_code == 201
    return response.json()["attachments"][0]


def test_signed_urls_serve_the_file_and_the_thumbnail(tx, client, auth):
    item = posted_photo(client, auth)
    full = client.get(item["url"])
    assert full.status_code == 200
    assert full.headers["content-type"] == "image/jpeg"
    assert full.headers["cache-control"] == "private, max-age=300"
    assert "filename*=UTF-8''a.jpg" in full.headers["content-disposition"]
    assert opened(full.content).size == (800, 600)
    thumb = client.get(item["thumb_url"])
    assert thumb.status_code == 200
    assert opened(thumb.content).size == (480, 360)


def sig_for(attachment_id: int, user_id: str, engine, **claims) -> str:
    with Session(engine) as session:
        user = session.get(AppUser, user_id)
    token = attachments.sign(attachment_id, user)
    if claims:
        payload = jwt.decode(token, auth_service._secret(), algorithms=["HS256"], audience="attachment")
        token = jwt.encode({**payload, **claims}, auth_service._secret(), algorithm="HS256")
    return token


def test_bad_expired_or_borrowed_signatures_get_404(tx, client, auth, engine):
    item = posted_photo(client, auth)
    url = f"/api/attachments/{item['id']}"
    assert client.get(f"{url}?sig=nonsense").status_code == 404
    assert client.get(url).status_code == 404
    expired = sig_for(item["id"], "U01", engine, exp=dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1))
    assert client.get(f"{url}?sig={expired}").status_code == 404
    # 簽給別的附件的簽名不能拿來開這一個
    other = sig_for(item["id"] + 1, "U01", engine)
    assert client.get(f"{url}?sig={other}").status_code == 404
    # 登入用的 token 不能當簽名用，簽名也不能當登入用
    login_token = auth("U01")["Authorization"].removeprefix("Bearer ")
    assert client.get(f"{url}?sig={login_token}").status_code == 404
    sig = item["url"].split("sig=")[1]
    assert client.get("/api/channels", headers={"Authorization": f"Bearer {sig}"}).status_code == 401


def test_people_outside_the_channel_cannot_open_its_files_even_with_their_own_signature(tx, client, auth, engine):
    item = posted_photo(client, auth)
    # 李佳蓉（南區）簽給自己的網址也打不開北區小組的照片
    assert client.get(f"/api/attachments/{item['id']}?sig={sig_for(item['id'], 'U05', engine)}").status_code == 404
    # 同組的同事可以
    assert client.get(f"/api/attachments/{item['id']}?sig={sig_for(item['id'], 'U02', engine)}").status_code == 200


def test_signatures_within_the_same_hour_are_identical_so_the_browser_can_cache(engine):
    with Session(engine) as session:
        user = session.get(AppUser, "U01")
    at = dt.datetime(2026, 10, 1, 9, 5, tzinfo=dt.UTC)
    assert attachments.sign(1, user, at) == attachments.sign(1, user, at + dt.timedelta(minutes=50))
    assert attachments.sign(1, user, at) != attachments.sign(1, user, at + dt.timedelta(hours=1))


def test_pdfs_have_no_thumbnail(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組")
    item = upload(client, auth("U01"), team, "", [("dm.pdf", pdf())]).json()["attachments"][0]
    full = client.get(item["url"])
    assert (full.status_code, full.headers["content-type"]) == (200, "application/pdf")
    thumb_sig = item["url"].split("sig=")[1]
    assert client.get(f"/api/attachments/{item['id']}/thumb?sig={thumb_sig}").status_code == 404


def ask_with_photo(session: Session, user_id: str) -> Attachment:
    record = AskRecord(id=f"test-{user_id}-{time.time_ns()}", user_id=user_id, kind="knowledge", question="這張海報怎麼回應")
    session.add(record)
    session.flush()
    prepared = attachments.prepare(photo(size=(100, 100)), "poster.jpg")
    attachment = attachments.add(session, session.get(AppUser, user_id), prepared, context=record.question, ask_id=record.id)
    session.flush()
    return attachment


def test_ask_attachments_are_only_for_the_asker_and_the_manager_who_answers(tx):
    attachment = ask_with_photo(tx, "U01")
    users = {u: tx.get(AppUser, u) for u in ("U01", "U02", "M01", "M03", "A01")}
    assert attachments.can_see(tx, users["U01"], attachment)
    assert not attachments.can_see(tx, users["U02"], attachment)
    assert not attachments.can_see(tx, users["M01"], attachment)
    tx.add(Escalation(ask_id=attachment.ask_id, question="這張海報怎麼回應"))
    tx.flush()
    # 轉給主管之後，U01 的主管與 IT 看得到；別區的主管還是看不到
    assert attachments.can_see(tx, users["M01"], attachment)
    assert attachments.can_see(tx, users["A01"], attachment)
    assert not attachments.can_see(tx, users["M03"], attachment)


# ---- IT 刪訊息 ----


def test_only_it_can_delete_a_message_and_its_files_go_with_it(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組")
    message = upload(client, auth("U01"), team, "不該貼的東西", [("a.jpg", photo(size=(50, 50)))]).json()
    item = message["attachments"][0]
    assert client.delete(f"/api/channels/messages/{message['id']}", headers=auth("U01")).status_code == 403
    assert client.delete(f"/api/channels/messages/{message['id']}", headers=auth("M01")).status_code == 403
    assert client.delete(f"/api/channels/messages/{message['id']}", headers=auth("A01")).status_code == 204
    # 再刪一次不出錯
    assert client.delete(f"/api/channels/messages/{message['id']}", headers=auth("A01")).status_code == 204
    assert client.delete("/api/channels/messages/999999999", headers=auth("A01")).status_code == 404
    listed = client.get(f"/api/channels/{team}/messages", headers=auth("U02")).json()
    shown = next(m for m in listed if m["id"] == message["id"])
    assert (shown["body"], shown["deleted"], shown["attachments"]) == (channels.DELETED_BODY, True, [])
    assert client.get(item["url"]).status_code == 404
    assert tx.get(ChannelMessage, message["id"]).deleted_by == "A01"


# ---- 同一個頻道的寫入排隊 ----


def test_posts_to_one_channel_take_numbers_in_the_order_they_finish(engine):
    """先拿到編號的那則還沒寫完，後一則就要等：輪詢「這則之後」才不會跳過編號比較小、比較晚寫完的訊息。"""
    with Session(engine) as first, Session(engine) as second:
        target = first.scalar(select(Channel).where(Channel.kind == "place").order_by(Channel.id.desc()).limit(1))
        info = channels.describe(first, [target])[0]
        early = channels.post(first, first.get(AppUser, "U01"), info, "測試：先拿到編號")
        done: dict[str, int] = {}

        def later():
            message = channels.post(second, second.get(AppUser, "U02"), info, "測試：後到")
            second.commit()
            done["id"] = message.id

        thread = threading.Thread(target=later)
        thread.start()
        time.sleep(0.5)
        assert "id" not in done, "第二則應該等第一則寫完"
        first.commit()
        thread.join(timeout=5)
        assert done["id"] > early.id
        first.execute(delete(ChannelMessage).where(ChannelMessage.body.like("測試：%")))
        first.commit()

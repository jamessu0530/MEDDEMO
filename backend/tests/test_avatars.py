"""大頭貼（services/avatars.py、api/avatars.py）。

上傳一律重新整理：轉正、清掉 EXIF、從中間裁成 256×256。圖片網址靠簽名，換照片或移除後舊網址就失效。
會寫入的測試都跑在 tx fixture 的交易裡（conftest.py），測完回滾。
"""

import datetime as dt
import io

import pytest
from fastapi.testclient import TestClient
from PIL import ExifTags, Image

from app import usage
from app.main import app
from app.models import AppUser, UserAvatar
from app.services import avatars

RED = (200, 30, 30)
BLUE = (30, 30, 200)


@pytest.fixture
def client():
    return TestClient(app)


def photo(size=(3000, 1000), fmt="JPEG") -> bytes:
    """藍底、中間一塊正方形是紅的，帶著拍攝地點與機型。從中間裁的話整張都是紅的。"""
    width, height = size
    edge = min(size)
    image = Image.new("RGB", size, BLUE)
    image.paste(Image.new("RGB", (edge, edge), RED), ((width - edge) // 2, (height - edge) // 2))
    exif = Image.Exif()
    exif[ExifTags.IFD.GPSInfo] = {ExifTags.GPS.GPSLatitudeRef: "N", ExifTags.GPS.GPSLatitude: (25.0, 2.0, 30.0)}
    exif[ExifTags.Base.Model] = "iPhone 17"
    buffer = io.BytesIO()
    image.save(buffer, fmt, exif=exif)
    return buffer.getvalue()


def close_to(pixel, color, tolerance=20) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(pixel, color, strict=True))


def upload(client, headers, content: bytes, filename="me.jpg", mime="image/jpeg"):
    return client.post("/api/avatars/me", files={"file": (filename, content, mime)}, headers=headers)


def listed(client, headers) -> dict[str, str]:
    response = client.get("/api/avatars", headers=headers)
    assert response.status_code == 200
    return response.json()["avatars"]


def test_photos_are_cropped_from_the_middle_to_a_square_without_exif():
    image = Image.open(io.BytesIO(avatars.prepare(photo())))
    assert (image.format, image.size) == ("JPEG", (256, 256))
    assert len(image.getexif()) == 0
    # 從中間裁：四個角也是紅的；壓扁的話角落會是藍的
    for xy in ((2, 2), (253, 2), (2, 253), (253, 253), (128, 128)):
        assert close_to(image.getpixel(xy), RED)


def test_a_tall_png_with_transparency_becomes_a_white_backed_jpeg():
    image = Image.new("RGBA", (400, 900), (0, 0, 0, 0))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    out = Image.open(io.BytesIO(avatars.prepare(buffer.getvalue())))
    assert (out.format, out.size, out.mode) == ("JPEG", (256, 256), "RGB")
    assert close_to(out.getpixel((128, 128)), (255, 255, 255))


def test_files_that_are_not_photos_are_rejected(client, auth):
    response = upload(client, auth("U01"), b"%PDF-1.7 not a photo", "a.pdf", "application/pdf")
    assert response.status_code == 415
    assert upload(client, auth("U01"), b"", "a.jpg").status_code == 422


def test_uploading_lists_the_photo_for_everyone_and_replacing_retires_the_old_url(tx, client, auth):
    first = upload(client, auth("U01"), photo())
    assert first.status_code == 200
    url = first.json()["url"]
    # 全公司都看得到，別區的人也是
    assert listed(client, auth("U04"))["U01"] == url
    image = client.get(url)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"
    assert "immutable" in image.headers["cache-control"]
    second = upload(client, auth("U01"), photo((800, 800))).json()["url"]
    assert second != url
    assert client.get(url).status_code == 404
    assert client.get(second).status_code == 200


def test_a_wrong_signature_or_a_removed_photo_is_404(tx, client, auth):
    url = upload(client, auth("U01"), photo()).json()["url"]
    assert client.get(url[:-4] + "0000").status_code == 404
    # 簽名換成非 ASCII 也只是 404
    assert client.get(url.split("?")[0], params={"sig": "大頭貼"}).status_code == 404
    assert client.delete("/api/avatars/me", headers=auth("U01")).status_code == 204
    assert "U01" not in listed(client, auth("U01"))
    assert client.get(url).status_code == 404
    # 移除後再上傳，網址不會跟舊的一樣（瀏覽器快取裡的舊照片不會跑出來）
    assert upload(client, auth("U01"), photo()).json()["url"] != url


def test_only_it_can_remove_someone_elses_photo(tx, client, auth):
    upload(client, auth("U01"), photo())
    assert client.delete("/api/avatars/U01", headers=auth("U02")).status_code == 403
    assert client.delete("/api/avatars/U01", headers=auth("A01")).status_code == 204
    assert "U01" not in listed(client, auth("U02"))
    assert client.delete("/api/avatars/U01", headers=auth("A01")).status_code == 404


def test_deactivated_accounts_photos_are_hidden(tx, client, auth):
    url = upload(client, auth("U02"), photo()).json()["url"]
    tx.get(AppUser, "U02").deactivated_at = dt.datetime.now(dt.UTC)
    tx.flush()
    assert "U02" not in listed(client, auth("U01"))
    assert client.get(url).status_code == 404


def test_deleting_an_account_deletes_its_photo(tx, client):
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge@avatars.test", "password": "judge-pass-1"}
    ).json()
    headers = {"Authorization": f"Bearer {created['token']}"}
    assert upload(client, headers, photo()).status_code == 200
    assert client.delete("/api/auth/me", headers=headers).status_code == 204
    assert tx.get(UserAvatar, created["user"]["id"]) is None


def test_uploads_count_against_their_own_limit():
    assert usage.buckets_for("POST", "/api/avatars/me", "multipart/form-data; boundary=x") == ["avatar"]
    assert usage.buckets_for("GET", "/api/avatars") == []

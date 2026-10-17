import importlib.util
from pathlib import Path
import sys

scripts = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location("commons_pharmacy_photos", scripts / "collect_commons_pharmacy_photos.py")
commons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(commons)


def test_file_description_requires_store_name_and_exact_premise():
    row = {"name": "屈臣氏百福門市", "city": "基隆市", "district": "七堵區", "address": "基隆市七堵區百三街83-1號2樓"}
    assert commons.identity_matches(row, "屈臣氏百福店，地址：基隆市七堵區百三街83之1號。")
    assert not commons.identity_matches(row, "屈臣氏百福店，地址：基隆市七堵區百三街831號。")
    assert not commons.identity_matches(row, "屈臣氏百福店，地址：基隆市七堵區百三街83號。")
    assert not commons.identity_matches(row, "康是美百福店，地址：基隆市七堵區百三街83之1號。")


def test_source_artist_and_license_are_preserved_as_text():
    photo = commons.metadata_page({"pageid": 1, "title": "File:Store.jpg", "imageinfo": [{"url": "https://upload.wikimedia.org/store.jpg?utm_source=commons", "descriptionurl": "https://commons.wikimedia.org/wiki/File:Store.jpg", "extmetadata": {"Artist": {"value": '<a href="/User:Person">Person</a>'}, "LicenseShortName": {"value": "CC BY-SA 4.0"}, "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"}}}]})
    assert photo["artist"] == "Person"
    assert photo["license_name"] == "CC BY-SA 4.0"
    assert photo["image_url"] == "https://upload.wikimedia.org/store.jpg"

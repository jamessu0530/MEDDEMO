import importlib.util
from pathlib import Path
import sys

scripts = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location("public_pharmacy_photos", scripts / "collect_public_pharmacy_photos.py")
directory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(directory)


def record():
    return {"name": "海大藥局", "city": "基隆市", "district": "中正區", "address": "基隆市中正區新豐街255號"}


def place(name="海大藥局", address="基隆市中正區新豐街255號1樓"):
    return {"name": name, "address": {"streetAddress": address}}


def test_name_and_exact_street_number_both_match():
    assert directory.identity_matches(record(), place())
    assert not directory.identity_matches(record(), place("別家藥局"))
    assert not directory.identity_matches(record(), place(address="基隆市中正區新豐街257號"))
    assert not directory.identity_matches(record(), place(address="基隆市仁愛區新豐街255號"))


def test_house_number_suffix_is_preserved_and_short_address_gets_city():
    row = {**record(), "address": "新豐街83-1號2樓"}
    assert directory.identity_matches(row, place(address="基隆市中正區新豐街83之1號"))
    assert not directory.identity_matches(row, place(address="基隆市中正區新豐街831號"))


def test_does_not_take_related_pharmacy_pictures_from_html():
    html = '''<script type="application/ld+json">{"@graph":[{"@type":"Place","name":"海大藥局","address":{"streetAddress":"基隆市中正區新豐街255號"}}]}</script>
        <img src="https://ppi.tw/sites/default/files/cover/other-shop.jpg" alt="別家藥局">'''
    places = directory.StructuredPlaces(html).places
    assert len(places) == 1
    assert "image" not in places[0]


def test_village_omission_requires_matching_telephone():
    row = {**record(), "address": "基隆市中正區港通里新豐街255號", "phone": "0224699222"}
    candidate = {**place(), "telephone": "02-24699222"}
    assert directory.identity_matches(row, candidate)
    assert not directory.identity_matches(row, {**candidate, "telephone": "02-24690000"})
    assert not directory.identity_matches(row, {**candidate, "address": {"streetAddress": "基隆市中正區新豐街257號"}})


def test_directory_cover_is_not_rejected_because_drupal_path_contains_default():
    row = {**record(), "candidate_images": [], "source_pages": [], "verified_exterior_images": []}
    candidate = {**place(), "image": {"url": "https://ppi.tw/sites/default/files/cover/047_235.jpg"}}
    directory.attach(row, {"url": "https://ppi.tw/pharmacy/5911011334", "places": [candidate]})
    assert len(row["candidate_images"]) == 1
    assert row["candidate_images"][0]["identity_verified"]
    assert row["candidate_images"][0]["exterior_verified"] is False


def test_search_identifiers_require_a_known_directory_page_and_trusted_host():
    url = "https://ppi.tw/pharmacy/5911011334"
    row = {"source_pages": [
        {"kind": "standard_web_search", "url": "https://ma.olc.tw/institution/5911011334/"},
        {"kind": "standard_web_search", "url": "https://ppi.tw/pharmacy/5911011334"},
        {"kind": "standard_web_search", "url": "https://ma.olc.tw/institution/5999999999/"},
        {"kind": "standard_web_search", "url": "https://not-ma.olc.tw/institution/5911011000/"}]}
    assert directory.search_directory_urls(row, {url, "https://ppi.tw/pharmacy/5911011000"}) == {url}

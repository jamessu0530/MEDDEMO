"""Photo research must not confuse branches or turn image hits into verified exteriors."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

script = Path(__file__).resolve().parents[2] / "scripts/collect_outlet_photo_sources.py"
spec = importlib.util.spec_from_file_location("outlet_photo_sources", script)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def outlet():
    return {"name": "屈臣氏七堵門市", "city_normalized": "基隆市", "district": "七堵區",
            "Address": "基隆市七堵區明德一路188號1-2F", "tel": "0224565652"}


def test_official_branch_and_premise_match_ignores_floor_only():
    assert collector.official_identity_matches(outlet(), "台灣屈臣氏 七堵 門市",
        "基隆市七堵區明德一路188號, 基隆市, 206, 台灣", "+886-224565652")
    assert collector.first_premise("臺北市大安區和平東路2段83-1號2樓") == collector.first_premise("台北市大安區和平東路2段83-1號")


def test_wrong_street_house_number_and_branch_are_rejected_even_with_same_phone():
    for address in ("基隆市七堵區明德一路188-1號", "基隆市七堵區明德一路1888號",
                    "基隆市七堵區明德二路188號", "基隆市仁愛區明德一路188號"):
        assert not collector.official_identity_matches(outlet(), "台灣屈臣氏 七堵 門市", address, "+886-224565652")
    assert not collector.official_identity_matches(outlet(), "台灣屈臣氏 百福 門市",
        "基隆市七堵區明德一路188號", "+886-224565652")
    assert collector.first_premise("基隆市七堵區百三街83-1號") != collector.first_premise("基隆市七堵區百三街831號")
    assert collector.first_premise("基隆市安樂區基金一路174號之20") == collector.first_premise("基隆市安樂區基金一路174之20號")


def test_listed_house_numbers_keep_primary_premise_and_preserve_subnumbers():
    assert collector.first_premise("310新竹縣竹東鎮東寧路三段103、105號") == collector.first_premise("新竹縣竹東鎮東寧路3段103號")
    assert collector.first_premise("新竹縣竹東鎮東寧路3段103、105號") != collector.first_premise("新竹縣竹東鎮東寧路3段103105號")
    assert collector.first_premise("基隆市七堵區百三街83-1、85號") == collector.first_premise("基隆市七堵區百三街83之1號")
    assert collector.first_premise("基隆市七堵區百三街83-1、85號") != collector.first_premise("基隆市七堵區百三街83號")
    assert collector.first_premise("基隆市信義區信二路257.259號") == collector.first_premise("基隆市信義區信二路257號")
    assert collector.first_premise("基隆市信義區信二路257.259號") != collector.first_premise("基隆市信義區信二路257259號")
    assert collector.first_premise("310, 新竹縣竹東鎮東寧路3段103號") == collector.first_premise("新竹縣竹東鎮東寧路三段103號")


def test_search_images_remain_unverified_and_google_photo_links_are_not_mirrored():
    record = {}
    collector.process_search(record, {"data": {"web": [{"url": "https://example.com/shop", "title": "某藥局"}],
        "images": [
            {"imageUrl": "https://example.com/exterior.jpg", "url": "https://example.com/shop"},
            {"imageUrl": "https://lh3.googleusercontent.com/photo", "url": "https://maps.google.com/shop"},
            {"imageUrl": "http://example.com/insecure.jpg", "url": "https://example.com/shop"},
        ]}})
    assert record["status"] == "photo_review_needed"
    assert len(record["candidate_images"]) == 1
    assert record["candidate_images"][0]["exterior_verified"] is False
    assert record["source_pages"][0]["identity_verified"] is False


def test_html_reads_store_gallery_and_contact_evidence_without_campaign_images():
    page = collector.OfficialPage('''<h1 class="store-name">台灣屈臣氏 七堵 門市</h1>
        <div class="address-detail"><svg><path></path></svg><div>基隆市七堵區明德一路188號</div></div>
        <a href="tel:+886-224565652">電話</a>
        <img src="https://api.watsons.com.tw/medias/campaign.jpg?context=banner">
        <img src="https://api.watsons.com.tw/medias/?context=store-photo">
        <img src="https://api.watsons.com.tw/medias/?context=store-photo">''')
    assert page.name == "台灣屈臣氏 七堵 門市"
    assert page.address == "基隆市七堵區明德一路188號"
    assert page.telephone == "+886-224565652"
    assert page.images == ["https://api.watsons.com.tw/medias/?context=store-photo"]


def test_prepare_preserves_resumable_batch_and_verified_photos():
    row = {**outlet(), "city": "基隆市", "id": 1, "lat": 25.0, "lng": 121.0, "issues": []}
    snapshot = {"summary": {"page_url": "https://example.com/list"}, "records": [row]}
    data = collector.prepare(snapshot, {})
    data["official_batches"] = [{"id": "batch-1", "status": "submitted"}]
    data["records"][0]["status"] = "verified_exterior"
    data["records"][0]["verified_exterior_images"] = [{"image_url": "https://example.com/store.jpg"}]
    resumed = collector.prepare(snapshot, data)
    assert resumed["official_batches"] == data["official_batches"]
    assert resumed["records"][0]["verified_exterior_images"] == data["records"][0]["verified_exterior_images"]
    assert resumed["records"][0]["status"] == "verified_exterior"


def test_unfinished_empty_batch_page_does_not_poll_the_same_cursor(tmp_path):
    class Client:
        calls = 0

        def get(self, url):
            self.calls += 1
            assert self.calls == 1
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {
                "status": "scraping", "completed": 0, "total": 2, "data": [],
                "next": "https://api.firecrawl.dev/v2/batch/scrape/batch-1?skip=0"})

    data = {"records": [], "official_batches": [{"id": "batch-1"}]}
    args = SimpleNamespace(start_official_batch=False, resume_official_batch="batch-1", output=tmp_path / "out.json")
    client = Client()
    collector.official_batch(client, data, {}, args)
    assert client.calls == 1
    assert data["official_batches"][0]["status"] == "scraping"


def test_manual_review_requires_identity_matched_image_and_summary_handles_directory(tmp_path):
    import pytest

    photo = {"image_url": "https://example.com/exterior.jpg", "page_url": "https://example.com/pharmacy", "identity_verified": False}
    record = {"customer_id": "one", "name": "合康藥局", "address": "台南市北區開元路85號", "status": "photo_review_needed", "candidate_images": [photo], "verified_exterior_images": [], "source_pages": []}
    data = {"records": [record]}
    review = tmp_path / "review.json"
    review.write_text(json.dumps({"reviews": [{"customer_id": "one", "image_url": photo["image_url"], "verification_method": "manual_visual_review", "evidence": "招牌與門牌符合"}]}))
    with pytest.raises(ValueError):
        collector.apply_manual_review(data, review)
    photo["identity_verified"] = True
    collector.apply_manual_review(data, review)
    collector.save(data, tmp_path / "out.json")
    collector.save_summary(data, tmp_path / "summary.md")
    assert record["status"] == "verified_exterior"
    assert "https://example.com/pharmacy" in (tmp_path / "summary.md").read_text()
    assert "官方門市相簿" not in (tmp_path / "summary.md").read_text()

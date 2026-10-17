import importlib.util
import json
from pathlib import Path
import sys

import httpx

scripts = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location("google_outlet_photos", scripts / "collect_google_outlet_photos.py")
google = importlib.util.module_from_spec(spec)
spec.loader.exec_module(google)


def row(**changes):
    return {"customer_id": "OUT-test", "name": "仁生藥局", "city": "基隆市", "district": "仁愛區", "address": "基隆市仁愛區仁三路2號", "phone": "0224222222", "candidate_images": [], **changes}


def place(**changes):
    return {"id": "a-place-id", "displayName": {"text": "仁生藥局"}, "formattedAddress": "基隆市仁愛區仁三路2號", "photos": [{"name": "do-not-persist-photo-name"}], **changes}


def test_exact_branch_and_house_required():
    assert google.identity_matches(row(), place())
    assert google.identity_matches(row(), place(formattedAddress="200台灣基隆市仁愛區仁三路2號"))
    assert not google.identity_matches(row(), place(formattedAddress="基隆市仁愛區仁三路22號"))
    assert not google.identity_matches(row(), place(formattedAddress="基隆市中正區仁三路2號"))
    assert not google.identity_matches(row(), place(displayName={"text": "仁生藥局分店"}))


def test_primary_premise_and_hyphenated_number():
    assert google.identity_matches(row(address="基隆市仁愛區仁三路2、4號1F"), place())
    suffix = row(address="基隆市仁愛區仁三路83-1號")
    assert google.identity_matches(suffix, place(formattedAddress="基隆市仁愛區仁三路83之1號"))
    assert not google.identity_matches(suffix, place(formattedAddress="基隆市仁愛區仁三路831號"))


def test_brand_english_alias_keeps_complete_branch_name():
    source = row(name="屈臣氏南京西門市")
    assert google.identity_matches(source, place(displayName={"text": "屈臣氏Watsons 南京西門市"}))
    assert not google.identity_matches(source, place(displayName={"text": "屈臣氏Watsons 南京東門市"}))


def test_optional_name_annotation_requires_phone_and_exact_premise():
    assert not google.compatible_name("", "")
    assert not google.compatible_name("(張先生)", "")
    source = row(name="仁生藥局(張先生)")
    assert not google.identity_matches(source, place())
    assert google.identity_matches(source, place(nationalPhoneNumber="02-2422-2222"))
    assert not google.identity_matches(source, place(nationalPhoneNumber="02-2422-2222", formattedAddress="基隆市仁愛區仁三路4號"))
    assert not google.identity_matches(row(name="仁生藥局(忠孝店)"), place(displayName={"text": "仁生藥局(南京店)"}, nationalPhoneNumber="02-2422-2222"))


def test_village_omission_requires_phone_but_phone_never_overrides_house():
    source = row(address="基隆市仁愛區忠勇里仁三路2號")
    assert not google.identity_matches(source, place())
    assert google.identity_matches(source, place(nationalPhoneNumber="02-2422-2222"))
    assert not google.identity_matches(source, place(nationalPhoneNumber="02-2422-2222", formattedAddress="基隆市仁愛區仁三路4號"))


def test_collection_retains_only_place_ids_and_resumes_without_repeat_requests(tmp_path):
    source, output = tmp_path / "source.json", tmp_path / "output.json"
    source.write_text(json.dumps({"records": [row(), row(customer_id="OUT-existing", candidate_images=[{"image_url": "https://example.com/photo.jpg"}])]}))
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"places": [place()]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = google.collect("test-secret", source, output, delay=0, client=client)
        assert result["records"]["OUT-test"]["status"] == "photos_available"
        assert result["records"]["OUT-test"]["exterior_verified"] is False
        google.collect("test-secret", source, output, delay=0, client=client)
    assert len(requests) == 1
    content = output.read_text()
    assert "a-place-id" in content
    assert "do-not-persist-photo-name" not in content and "test-secret" not in content
    assert "formattedAddress" not in content and "nationalPhoneNumber" not in content


def test_disabled_api_stops_whole_batch_without_marking_unqueried_shops_as_missing(tmp_path):
    source, output = tmp_path / "source.json", tmp_path / "output.json"
    source.write_text(json.dumps({"records": [row(customer_id=f"OUT-{index}") for index in range(50)]}))
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(403, json={"error": {"message": "test-secret", "status": "PERMISSION_DENIED", "details": [{"reason": "SERVICE_DISABLED"}]}})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = google.collect("test-secret", source, output, delay=0, client=client)
    assert len(requests) == 1
    assert result["records"] == {}
    assert result["runs"][-1]["pending_at_start"] == 50
    assert result["runs"][-1]["reason"] == "SERVICE_DISABLED"
    assert "test-secret" not in output.read_text()


def test_multiple_matching_branches_require_review_and_phone_is_only_fetched_for_omitted_village():
    requests = []
    def respond(request):
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"places": [place(), place(id="another-id")]})
        return httpx.Response(200, json={"nationalPhoneNumber": "02-2422-2222"})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = google.lookup(client, "key", row(address="基隆市仁愛區忠勇里仁三路2號"))
    assert len(requests) == 3
    assert result["status"] == "identity_review_needed" and "place_id" not in result
    assert result["candidate_place_ids"] == ["a-place-id", "another-id"]


def test_published_frontend_index_contains_only_verified_place_ids(tmp_path):
    output = tmp_path / "place-ids.ts"
    google.publish_place_ids({"records": {
        "OUT-match": {"place_id": "verified-id", "status": "photos_available"},
        "OUT-no-photos": {"place_id": "known-id", "status": "no_photos"},
        "OUT-review": {"candidate_place_ids": ["unverified-id"], "status": "identity_review_needed"},
    }}, output)
    value = output.read_text()
    assert '"OUT-match": "verified-id"' in value
    assert '"OUT-no-photos": "known-id"' in value
    assert "unverified-id" not in value

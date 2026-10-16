"""語音名稱強化串接，以及明確確認後切換商家、重建欄位的 API 行為。"""

import datetime as dt
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session
from test_visits import FakeExtractor, FakeTranscriber, client, make_draft, providers, run_jobs  # noqa: F401

from app.models import Customer, Product, SalesTransaction, Visit
from app.services import last_order, visit_processing
from app.services.extraction import Extraction, empty_fields, product_hints
from app.services.transcription import visit_hotwords


def another_customer(engine):
    with Session(engine) as session:
        return session.execute(select(Customer.id, Customer.name).where(Customer.id != "C001").order_by(Customer.id)).first()


def test_customer_mentions_only_suggest_until_the_user_switches(client, providers, engine, monkeypatch):
    visit_id = make_draft(client, providers)
    target_id, target_name = another_customer(engine)
    transcript = f"今天去{target_name}，跟上次一樣。"
    client.post(f"/api/visits/{visit_id}/transcript", json={"text": transcript})
    run_jobs()
    draft = client.get(f"/api/visits/{visit_id}").json()
    assert draft["customer_id"] == "C001"
    assert target_id in {c["id"] for c in draft["customer_candidates"]}
    assert all(c["quote"] in transcript for c in draft["customer_candidates"])

    seen = []

    class SameAsLastTime:
        def extract(self, transcript, visit_date, products, packs=(), **context):
            return Extraction(empty_fields(), {"repeat_last": "跟上次一樣"}, {"all": True, "except_skus": [], "relative": []})

    providers(extractor=SameAsLastTime())
    monkeypatch.setattr(last_order, "build", lambda session, customer: seen.append(customer.id))
    switched = client.put(f"/api/visits/{visit_id}/customer", json={"customer_id": target_id})
    assert switched.status_code == 202
    assert switched.json()["status"] == "processing" and switched.json()["repeat_last"] is None
    assert switched.json()["fields"] == empty_fields()
    run_jobs()
    draft = client.get(f"/api/visits/{visit_id}").json()
    assert draft["customer_id"] == target_id and seen == [target_id]
    assert draft["transcript"] == transcript and draft["repeat_last"]["empty"] is True


def test_customer_switch_rejects_missing_customer_and_finalized_visits(client, providers, engine):
    visit_id = make_draft(client, providers)
    assert client.put(f"/api/visits/{visit_id}/customer", json={"customer_id": "missing"}).status_code == 404
    assert client.get(f"/api/visits/{visit_id}").json()["customer_id"] == "C001"
    with Session(engine) as session:
        session.get(Visit, visit_id).status = "confirmed"
        session.commit()
    assert client.put(f"/api/visits/{visit_id}/customer", json={"customer_id": "C001"}).status_code == 409


def test_another_users_draft_cannot_be_switched(client, providers, sign_in, engine):
    visit_id = make_draft(client, providers)
    sign_in(client, "U02")
    assert client.put(f"/api/visits/{visit_id}/customer", json={"customer_id": another_customer(engine)[0]}).status_code == 404


def test_recent_noncommon_products_are_also_speech_hotwords(engine):
    with Session(engine) as session:
        sku, name = session.execute(select(Product.sku, Product.name).where(~Product.common).order_by(Product.sku)).first()
        session.add(SalesTransaction(order_no="speech-test", customer_id="C001", date=dt.date(2099, 1, 1), sku=sku,
            qty=1, amount=Decimal(100), cost=Decimal(50)))
        session.flush()
        assert name in visit_hotwords(session, "C001")
        assert sku in {p.sku for p in product_hints(session, "跟上次一樣。", "C001")}
        # 不 commit；測試交易回滾，不改其他測試的上次訂單。


def test_taiwanese_processing_uses_audio_and_a_noncommon_catalog_match(client, providers, monkeypatch, engine):
    with Session(engine) as session:
        sku, name = session.execute(select(Product.sku, Product.name).where(~Product.common).order_by(Product.sku)).first()
    calls = []

    class Recognizer:
        def transcribe(self, audio, mime_type, hotwords):
            from app.services.transcription import Transcript
            return Transcript(f"今仔日欲{name}二十盒，毋愛十盒。")

    class Extractor:
        def extract(self, transcript, visit_date, products, packs=(), **context):
            calls.append(context)
            assert sku in {p.sku for p in products}
            return Extraction(empty_fields())

    providers(extractor=Extractor())
    monkeypatch.setattr(visit_processing, "get_taiwanese_transcriber", lambda: Recognizer())
    created = client.post("/api/visits/audio", data={"customer_id": "C001", "language": "nan-TW"},
        files={"file": ("visit.m4a", b"original-audio", "audio/mp4")})
    run_jobs()
    visit = client.get(f"/api/visits/{created.json()['id']}").json()
    assert visit["status"] == "draft" and "毋愛十盒" in visit["transcript"]
    assert calls[0]["name_audio"] == (b"original-audio", "audio/m4a")
    assert name in calls[0]["name_terms"]


def test_large_taiwanese_audio_keeps_text_extraction_and_reports_skipped_name_check(client, providers, monkeypatch):
    calls = []

    class Extractor:
        def extract(self, transcript, visit_date, products, packs=(), **context):
            calls.append(context)
            return Extraction(empty_fields())

    providers(extractor=Extractor())
    monkeypatch.setattr(visit_processing, "get_taiwanese_transcriber", lambda: FakeTranscriber())
    monkeypatch.setattr(visit_processing, "INLINE_AUDIO_LIMIT", 3)
    created = client.post("/api/visits/audio", data={"customer_id": "C001", "language": "nan-TW"},
        files={"file": ("visit.m4a", b"original-audio", "audio/mp4")})
    run_jobs()
    visit = client.get(f"/api/visits/{created.json()['id']}").json()
    assert visit["status"] == "draft" and calls == [{}]
    assert "未用原音核對名稱" in visit["error_message"]

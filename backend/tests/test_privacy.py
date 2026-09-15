"""NFR-8：確認送出時逐字稿去識別；錄音、逐字稿、沒送出的紀錄到期刪除。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from test_visits import SOURCES, TRANSCRIPT, FakeExtractor, make_draft, run_jobs, upload

from app.main import app
from app.models import Visit, VisitAudio
from app.services import visit_processing
from app.services.privacy import AUDIO_RETENTION, TRANSCRIPT_RETENTION, deidentify, purge
from app.services.transcription import Transcript
from app.tasks import redis

PERSONAL = "王藥師說有事打 0912-345-678。"


class PersonalTranscriber:
    def transcribe(self, audio, mime_type, hotwords):
        return Transcript(TRANSCRIPT + PERSONAL)


@pytest.fixture
def client(engine):
    with engine.connect() as conn:
        last = conn.execute(text("SELECT max(id) FROM visit")).scalar_one()
    yield TestClient(app)
    with engine.begin() as conn:
        for table in ("writeback_log", "crm_visit_record", "sap_quotation_draft", "oa_expense_form"):
            conn.execute(text(f"DELETE FROM {table} WHERE visit_id > :last"), {"last": last})
        conn.execute(text("DELETE FROM visit WHERE id > :last"), {"last": last})
    redis().flushdb()


@pytest.fixture
def providers(monkeypatch):
    def use(transcriber, extractor):
        monkeypatch.setattr(visit_processing, "get_transcriber", lambda: transcriber)
        monkeypatch.setattr(visit_processing, "get_extractor", lambda: extractor)

    return use


@pytest.mark.parametrize(
    ("spoken", "masked"),
    [
        ("陳小姐說她的手機是 0912-345-678", "○小姐說她的手機是 ［電話］"),
        ("找王小明先生，市話 (02)2345-6789", "找○○○先生，市話 ［電話］"),
        ("林店長給了 email：lin.store@example.com", "○店長給了 email：［email］"),
        ("客戶報了身分證字號A123456789要開發票", "客戶報了身分證字號［身分證字號］要開發票"),
        ("歐陽藥師說 +886 912 345 678 可以找他", "○○藥師說 ［電話］ 可以找他"),
    ],
)
def test_personal_data_is_masked(spoken, masked):
    assert deidentify(spoken) == masked


def test_business_words_are_not_mistaken_for_personal_data():
    spoken = "陳列位被調降，對方店長說黃金層要加價；10月24號前回報，魚油 20 盒，發票 2026-10-05 寄出"
    assert deidentify(spoken) == spoken


def test_staff_names_are_masked_but_customer_and_competitor_names_are_kept():
    masked = deidentify(
        "林昱辰跟御松田店長談過，康泰連鎖藥局忠孝店的王店長也在",
        names=["林昱辰"],
        protected=["御松田", "康泰連鎖藥局", "忠孝店"],
    )
    assert masked == "○○○跟御松田店長談過，康泰連鎖藥局忠孝店的○店長也在"


def test_masking_twice_changes_nothing():
    once = deidentify("陳小姐 0912345678，王店長跟林昱辰說過", names=["林昱辰"])
    assert deidentify(once, names=["林昱辰"]) == once


def test_the_transcript_is_deidentified_when_the_visit_is_confirmed(client, providers):
    sources = SOURCES | {"follow_up_date": "10月24號再過去看看。" + PERSONAL}
    providers(PersonalTranscriber(), FakeExtractor(sources=sources))
    visit_id = upload(client).json()["id"]
    run_jobs()
    # 送出前，業務要對著原文核對
    assert client.get(f"/api/visits/{visit_id}").json()["transcript"].endswith(PERSONAL)

    confirmed = client.post(f"/api/visits/{visit_id}/confirm").json()
    assert confirmed["transcript"].endswith("○藥師說有事打 ［電話］。")
    assert "0912" not in confirmed["transcript"]
    # 欄位的原文片段一起遮，還對得回逐字稿
    assert confirmed["sources"]["follow_up_date"] == "10月24號再過去看看。○藥師說有事打 ［電話］。"
    assert confirmed["unsourced"] == []


def test_expired_audio_transcripts_and_abandoned_drafts_are_deleted(client, providers, engine):
    confirmed_id = make_draft(client, providers)
    client.post(f"/api/visits/{confirmed_id}/confirm")
    abandoned_id = make_draft(client, providers)
    kept_id = make_draft(client, providers)
    with Session(engine) as session:
        # 「現在」取假資料最早一筆逐字稿還沒到期的那天，測試結果不會隨真實日期改變
        oldest = session.scalar(select(func.min(Visit.confirmed_at)))
        now = oldest + TRANSCRIPT_RETENTION - dt.timedelta(days=1)
        session.get(Visit, confirmed_id).confirmed_at = now - AUDIO_RETENTION - dt.timedelta(days=1)
        session.get(Visit, abandoned_id).created_at = now - AUDIO_RETENTION - dt.timedelta(days=1)
        session.get(Visit, kept_id).created_at = now
        session.commit()

        first = purge(session, now)
        session.commit()
        session.expire_all()
        # 錄音到期：刪錄音、逐字稿還在；沒送出的舊紀錄整筆刪；新的留著
        assert (first.audio_deleted, first.unconfirmed_deleted, first.transcripts_deleted) == (1, 1, 0)
        assert session.get(VisitAudio, confirmed_id) is None
        assert session.get(Visit, confirmed_id).transcript == TRANSCRIPT
        assert session.get(Visit, abandoned_id) is None
        assert session.get(VisitAudio, kept_id) is not None

        session.get(Visit, confirmed_id).confirmed_at = now - TRANSCRIPT_RETENTION - dt.timedelta(days=1)
        session.commit()
        assert purge(session, now).transcripts_deleted == 1
        session.commit()
        session.expire_all()
        visit = session.get(Visit, confirmed_id)
        assert visit.transcript == "" and visit.field_sources is None
        assert visit.fields_final is not None  # 五個欄位是 CRM 的紀錄，不刪

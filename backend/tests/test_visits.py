"""第二、三週：口述 → 逐字稿 → 五個欄位 → 確認 → 寫回三套系統。

語音辨識與 AI 模型用測試替身；資料庫、Redis 佇列與背景工作都是真的。
"""

import pytest
from fastapi.testclient import TestClient
from rq import SimpleWorker
from sqlalchemy import text

from app.config import NotConfigured
from app.main import app
from app.services import visit_processing
from app.services.extraction import Extraction
from app.services.transcription import Transcript
from app.tasks import redis, visit_queue

TRANSCRIPT = (
    "今天去康泰連鎖藥局忠孝店，跟店長聊了一下。御松田有來談，條件比我們好。店長抱怨補貨延遲三天。"
    "他想先進魚油二十盒。我答應10月24號前回報檔期。10月24號再過去看看。"
)
FIELDS = {
    "competitor": [{"name": "御松田", "detail": "條件比我們好"}],
    "complaint": "補貨延遲三天",
    "intent": [{"product_text": "魚油", "sku": "HS-FO30", "qty": 20, "unit": "盒", "promo_code": None}],
    "commitment": {"by": "us", "text": "回報檔期", "due": "2026-10-24"},
    "follow_up_date": "2026-10-24",
    "notes": None,
}
SOURCES = {
    "competitor": "御松田有來談，條件比我們好。",
    "complaint": "店長抱怨補貨延遲三天。",
    "intent": "他想先進魚油二十盒。",
    "commitment": "我答應10月24號前回報檔期。",
    "follow_up_date": "10月24號再過去看看。",
}


class FakeTranscriber:
    def transcribe(self, audio, mime_type, hotwords):
        assert "御松田" in hotwords and "魚油" in hotwords  # 熱詞有帶給語音辨識
        return Transcript(TRANSCRIPT)


class FakeExtractor:
    def __init__(self, fields=FIELDS, sources=SOURCES):
        self.fields, self.sources = fields, sources
        self.packs = ()

    def extract(self, transcript, visit_date, products, packs=()):
        assert any(p.sku == "HS-FO30" for p in products)  # 品項表有帶給模型
        self.packs = packs
        return Extraction(self.fields, self.sources)


def not_configured():
    raise NotConfigured("測試：沒有設定")


@pytest.fixture
def client(engine, sign_in):
    with engine.connect() as conn:
        last = conn.execute(text("SELECT max(id) FROM visit")).scalar_one()
    yield sign_in(TestClient(app), "U01")
    # 清掉這個測試建的拜訪（編號都排在測試開始前的最後一筆之後），其他測試看到的仍是原本的假資料
    with engine.begin() as conn:
        for table in ("writeback_log", "crm_visit_record", "sap_quotation_draft", "oa_expense_form", "customer_note"):
            conn.execute(text(f"DELETE FROM {table} WHERE visit_id > :last"), {"last": last})
        conn.execute(text("DELETE FROM visit WHERE id > :last"), {"last": last})
    redis().flushdb()


@pytest.fixture
def providers(monkeypatch):
    def use(transcriber=None, extractor=None):
        monkeypatch.setattr(visit_processing, "get_transcriber", (lambda: transcriber) if transcriber else not_configured)
        monkeypatch.setattr(visit_processing, "get_extractor", (lambda: extractor) if extractor else not_configured)

    return use


def run_jobs():
    SimpleWorker([visit_queue()], connection=redis()).work(burst=True)


def upload(client, client_ref=None):
    data = {"customer_id": "C001"} | ({"client_ref": client_ref} if client_ref else {})
    return client.post("/api/visits/audio", data=data, files={"file": ("visit.webm", b"fake-audio", "audio/webm")})


def make_draft(client, providers, extractor=None):
    providers(FakeTranscriber(), extractor or FakeExtractor())
    visit_id = upload(client).json()["id"]
    run_jobs()
    return visit_id


def statuses(visit):
    return {w["target"]: w["status"] for w in visit["writeback"]}


def test_a_voice_note_becomes_five_editable_fields(client, providers):
    providers(FakeTranscriber(), FakeExtractor())
    created = upload(client)
    assert created.status_code == 202
    assert created.json()["status"] == "processing"

    run_jobs()
    visit = client.get(f"/api/visits/{created.json()['id']}").json()
    assert visit["status"] == "draft"
    assert visit["transcript"] == TRANSCRIPT
    assert visit["fields"] == FIELDS
    assert visit["sources"] == SOURCES
    assert visit["unsourced"] == []


def test_resending_the_same_recording_does_not_create_a_second_visit(client, providers):
    providers(FakeTranscriber(), FakeExtractor())
    first = upload(client, client_ref="rec-1").json()["id"]
    again = upload(client, client_ref="rec-1")
    assert again.status_code == 200
    assert again.json()["id"] == first


def test_without_speech_recognition_the_rep_can_type_the_transcript(client, providers):
    providers(extractor=FakeExtractor())
    visit_id = upload(client).json()["id"]
    run_jobs()
    failed = client.get(f"/api/visits/{visit_id}").json()
    assert failed["status"] == "failed"
    assert "轉文字失敗" in failed["error_message"]

    client.post(f"/api/visits/{visit_id}/transcript", json={"text": TRANSCRIPT})
    run_jobs()
    assert client.get(f"/api/visits/{visit_id}").json()["fields"] == FIELDS


def test_without_the_ai_model_fields_are_left_blank_for_manual_entry(client, providers):
    providers(transcriber=FakeTranscriber())
    visit_id = upload(client).json()["id"]
    run_jobs()
    visit = client.get(f"/api/visits/{visit_id}").json()
    assert visit["status"] == "draft"
    assert all(value is None for value in visit["fields"].values())
    assert "手動填寫" in visit["error_message"]


def test_ai_values_that_do_not_quote_the_transcript_are_flagged(client, providers):
    visit_id = make_draft(client, providers, FakeExtractor(sources={**SOURCES, "complaint": "店長說送貨很慢"}))
    assert client.get(f"/api/visits/{visit_id}").json()["unsourced"] == ["complaint"]


def test_fields_can_be_edited_one_by_one_but_must_stay_valid(client, providers):
    visit_id = make_draft(client, providers)
    rejected = client.put(f"/api/visits/{visit_id}/fields", json={"fields": {**FIELDS, "follow_up_date": "下週三"}})
    assert rejected.status_code == 422

    edited = client.put(f"/api/visits/{visit_id}/fields", json={"fields": {**FIELDS, "complaint": "到貨外盒破損"}}).json()
    assert edited["fields"]["complaint"] == "到貨外盒破損"
    assert edited["unsourced"] == []  # 業務自己改的欄位不標


def test_an_intent_line_must_say_whether_it_is_a_pack(client, providers):
    visit_id = make_draft(client, providers)
    without = [{"product_text": "魚油", "sku": "HS-FO30", "qty": 20, "unit": "盒"}]
    assert client.put(f"/api/visits/{visit_id}/fields", json={"fields": {**FIELDS, "intent": without}}).status_code == 422


def test_confirm_writes_all_three_systems_and_creates_a_reminder(client, providers, engine):
    visit_id = make_draft(client, providers)
    visit = client.post(f"/api/visits/{visit_id}/confirm").json()
    assert visit["status"] == "synced"
    assert statuses(visit) == {"crm": "success", "sap": "success", "oa": "success"}
    assert visit["reminder"] == {"due_date": "2026-10-24", "note": "回報檔期"}
    with engine.connect() as conn:
        params = {"v": visit_id}
        assert conn.execute(text("SELECT complaint FROM crm_visit_record WHERE visit_id = :v"), params).scalar_one() == "補貨延遲三天"
        # 康泰忠孝店是連鎖：魚油 30 入建議售價 450 元，打 9 折是 405 元
        sap = conn.execute(text("SELECT sku, qty, unit_price FROM sap_quotation_draft WHERE visit_id = :v"), params).one()
        assert sap == ("HS-FO30", 20, 405)
        assert conn.execute(text("SELECT count(*) FROM oa_expense_form WHERE visit_id = :v"), params).scalar_one() == 1


def test_confirming_files_the_notes(client, providers, engine):
    notes = [{"kind": "bring", "text": "骨營 DM", "date": None}, {"kind": "told", "text": "小口買 22 送 1", "date": None}]
    visit_id = make_draft(client, providers, FakeExtractor(fields={**FIELDS, "notes": notes}))
    client.post(f"/api/visits/{visit_id}/confirm")
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT kind, text, on_date FROM customer_note WHERE visit_id = :v ORDER BY id"), {"v": visit_id}
        ).all()
    # 要帶的沒講日期，用這次的追蹤日 10/24；講過的放拜訪日
    assert [(kind, note, str(day)) for kind, note, day in rows][0] == ("bring", "骨營 DM", "2026-10-24")
    assert rows[1].kind == "told" and rows[1].on_date is not None


def test_one_system_down_does_not_block_the_others_and_can_be_resent_alone(client, providers, engine):
    visit_id = make_draft(client, providers)
    client.put("/api/mock-systems/oa", json={"down": True})
    visit = client.post(f"/api/visits/{visit_id}/confirm").json()
    assert statuses(visit) == {"crm": "success", "sap": "success", "oa": "failed"}
    assert visit["status"] == "confirmed"
    assert "OA 回應逾時" in next(w for w in visit["writeback"] if w["target"] == "oa")["error_message"]

    assert client.post(f"/api/visits/{visit_id}/writeback/crm/retry").status_code == 409  # 成功的不能重送
    client.put("/api/mock-systems/oa", json={"down": False})
    retried = client.post(f"/api/visits/{visit_id}/writeback/oa/retry").json()
    assert retried["status"] == "synced"
    assert next(w for w in retried["writeback"] if w["target"] == "oa")["attempt"] == 2
    with engine.connect() as conn:
        attempts = dict(conn.execute(text("SELECT target, count(*) FROM writeback_log WHERE visit_id = :v GROUP BY target"), {"v": visit_id}).all())
        assert attempts == {"crm": 1, "sap": 1, "oa": 2}


def test_sap_needs_product_and_quantity_before_confirming(client, providers):
    unclear = {**FIELDS, "intent": [{"product_text": "那個大罐的", "sku": None, "qty": None, "unit": None, "promo_code": None}]}
    visit_id = make_draft(client, providers, FakeExtractor(fields=unclear))
    response = client.post(f"/api/visits/{visit_id}/confirm")
    assert response.status_code == 422
    assert "缺少品項" in str(response.json())


def test_no_purchase_intent_skips_sap(client, providers):
    fields = {**FIELDS, "intent": None}
    sources = {k: v for k, v in SOURCES.items() if k != "intent"}
    visit_id = make_draft(client, providers, FakeExtractor(fields=fields, sources=sources))
    visit = client.post(f"/api/visits/{visit_id}/confirm").json()
    assert statuses(visit) == {"crm": "success", "sap": "skipped", "oa": "success"}
    assert visit["status"] == "synced"


def test_a_visit_stuck_in_processing_can_be_restarted(client, providers):
    providers(FakeTranscriber(), FakeExtractor())
    visit_id = upload(client).json()["id"]
    redis().flushdb()  # 模擬 Redis 重啟：排隊中的工作不見了，紀錄停在處理中
    assert client.get(f"/api/visits/{visit_id}").json()["status"] == "processing"

    assert client.post(f"/api/visits/{visit_id}/reprocess").status_code == 202
    run_jobs()
    assert client.get(f"/api/visits/{visit_id}").json()["status"] == "draft"


def test_a_draft_can_be_discarded_but_a_confirmed_visit_cannot(client, providers):
    draft_id = make_draft(client, providers)
    assert client.delete(f"/api/visits/{draft_id}").status_code == 204
    assert client.get(f"/api/visits/{draft_id}").status_code == 404

    confirmed_id = make_draft(client, providers)
    client.post(f"/api/visits/{confirmed_id}/confirm")
    assert client.delete(f"/api/visits/{confirmed_id}").status_code == 409
    assert client.post(f"/api/visits/{confirmed_id}/confirm").status_code == 409


def test_a_competitor_or_complaint_notifies_the_reps_manager(client, providers, auth):
    visit_id = make_draft(client, providers)
    visit = client.post(f"/api/visits/{visit_id}/confirm").json()
    notice = visit["risk_notice"]
    assert notice["manager_name"] == "陳建宏"  # 林昱辰的直屬主管
    assert notice["reason"] == "提到競品御松田；客訴：補貨延遲三天"
    assert notice["max"] == 5 and notice["score"] == len(notice["items"])
    # 忠孝店是刻意設計的「進貨間隔拉長」案例，這次又提到競品與客訴
    assert {"進貨間隔拉長", "近 90 天提到競品", "近 90 天有客訴"} <= set(notice["items"])

    notices = client.get("/api/manager/notices", headers=auth("M01")).json()
    mine = next(n for n in notices if n["visit_id"] == visit_id)
    assert mine["rep_name"] == "林昱辰" and mine["customer_name"] == "康泰連鎖藥局 · 忠孝店" and mine["seen_at"] is None
    # 別的主管看不到；業務打不開主管端
    assert all(n["visit_id"] != visit_id for n in client.get("/api/manager/notices", headers=auth("M02")).json())
    assert client.get("/api/manager/notices").status_code == 403

    unseen = client.get("/api/manager/notices/unseen", headers=auth("M01")).json()["count"]
    assert client.post(f"/api/manager/notices/{mine['id']}/seen", headers=auth("M01")).json()["seen_at"] is not None
    assert client.get("/api/manager/notices/unseen", headers=auth("M01")).json()["count"] == unseen - 1
    assert client.post(f"/api/manager/notices/{mine['id']}/seen", headers=auth("M02")).status_code == 404


def test_a_routine_visit_does_not_notify_anyone(client, providers):
    fields = {**FIELDS, "competitor": None, "complaint": None}
    sources = {k: v for k, v in SOURCES.items() if k not in ("competitor", "complaint")}
    visit_id = make_draft(client, providers, FakeExtractor(fields, sources))
    assert client.post(f"/api/visits/{visit_id}/confirm").json()["risk_notice"] is None


def test_a_competitor_never_mentioned_before_is_marked_first(client, providers):
    fields = {**FIELDS, "competitor": [{"name": "御松田", "detail": "條件比我們好"}, {"name": "新和生技", "detail": "剛來拜訪"}]}
    visit_id = make_draft(client, providers, FakeExtractor(fields))
    # 御松田在忠孝店上次拜訪（10/19）就提過了，只有新和生技是第一次
    assert client.get(f"/api/visits/{visit_id}").json()["first_competitors"] == ["新和生技"]


# ── 促銷的口（docs/superpowers/specs/2026-10-07-quote-promotion-packs-design.md）────────────


def premium_small(engine):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT item_code FROM v_promotion_item WHERE status = '進行中' AND item_name = 'Premium眼藥水(小口)'")
        ).scalar_one()


def test_a_pack_in_the_voice_note_is_quoted_as_that_pack(client, providers, engine):
    code = premium_small(engine)
    pack = {"product_text": "小口 Premium 眼藥水", "sku": "F749579", "qty": 2, "unit": "口", "promo_code": code}
    extractor = FakeExtractor(fields={**FIELDS, "intent": [pack, *FIELDS["intent"]]})
    visit_id = make_draft(client, providers, extractor)
    assert code in {p.code for p in extractor.packs}  # 這一期的口有帶給模型
    assert client.get(f"/api/visits/{visit_id}").json()["fields"]["intent"][0] == pack

    visit = client.post(f"/api/visits/{visit_id}/confirm").json()
    assert statuses(visit)["sap"] == "success"
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT promo_code, packs, qty, free_qty, amount, unit_price FROM sap_quotation_draft"
                " WHERE visit_id = :v ORDER BY line_no"
            ),
            {"v": visit_id},
        ).all()
    assert [tuple(r) for r in rows] == [(code, 2, 44, 2, 11000, 250), (None, None, 20, 0, 8100, 405)]


def test_a_pack_the_ai_made_up_is_cleared_for_the_rep_to_pick(client, providers):
    made_up = {"product_text": "小口眼藥水", "sku": "F749579", "qty": 1, "unit": "口", "promo_code": "PP-999999"}
    visit_id = make_draft(client, providers, FakeExtractor(fields={**FIELDS, "intent": [made_up]}))
    assert client.get(f"/api/visits/{visit_id}").json()["fields"]["intent"] == [made_up | {"sku": None, "promo_code": None}]
    assert "缺少品項" in str(client.post(f"/api/visits/{visit_id}/confirm").json())


def test_the_rep_cannot_save_a_pack_for_another_product(client, providers, engine):
    visit_id = make_draft(client, providers)
    wrong = [{"product_text": "魚油", "sku": "HS-FO30", "qty": 1, "unit": "口", "promo_code": premium_small(engine)}]
    response = client.put(f"/api/visits/{visit_id}/fields", json={"fields": {**FIELDS, "intent": wrong}})
    assert response.status_code == 422 and "不是這個品項" in str(response.json())

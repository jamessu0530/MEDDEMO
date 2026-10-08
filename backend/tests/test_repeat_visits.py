"""錄音講「跟上次一樣」：整理完就照上次訂的展開下單意向，確認頁拿得到快照，送出就是這個月的 SAP 報價草稿。"""

from sqlalchemy import text
from sqlalchemy.orm import Session
from test_visits import FakeExtractor, client, providers, run_jobs, statuses, upload  # noqa: F401  client、providers 是 fixture

from app.services import last_order, promo_packs, repeat_order
from app.services.extraction import Extraction

FIELDS = {"competitor": None, "complaint": None, "intent": None, "commitment": None, "follow_up_date": None, "notes": None}
SAID = "跟上次一樣就好"
TRANSCRIPT = "跟店長聊了一下，跟上次一樣就好，威鎮這次先不要，Premium 小口再加一口。"


class RepeatExtractor:
    def __init__(self, repeat, intent=None, said=SAID):
        self.repeat, self.intent, self.said = repeat, intent, said

    def extract(self, transcript, visit_date, products, packs=()):
        return Extraction({**FIELDS, "intent": self.intent}, {"repeat_last": self.said}, repeat_last=self.repeat)


def draft(client, providers, extractor):
    """沒有語音辨識：上傳後轉文字失敗，再用手打的逐字稿整理。"""
    providers(extractor=extractor)
    visit_id = upload(client).json()["id"]
    run_jobs()
    client.post(f"/api/visits/{visit_id}/transcript", json={"text": TRANSCRIPT})
    run_jobs()
    return client.get(f"/api/visits/{visit_id}").json()


def current_code(engine, name):
    with Session(engine) as session:
        return next(p.code for p in promo_packs.current_packs(session) if p.name == name)


def test_same_as_last_time_becomes_this_months_quote(client, providers, engine):
    premium = current_code(engine, "Premium眼藥水(小口)")
    visit = draft(client, providers, RepeatExtractor({
        "all": True, "except_skus": ["D120013"],
        "relative": [{"product_text": "Premium 小口", "sku": "F749579", "promo_code": premium, "delta": 1}],
    }))
    intent = {(i["sku"], i["promo_code"]): i for i in visit["fields"]["intent"]}
    # 忠孝店上次訂的 22 列，威鎮不要
    assert len(intent) == 21 and ("D120013", None) not in intent
    assert intent[("F749579", premium)]["qty"] == 2
    assert intent[("F763630", None)] == {"product_text": "40EXa眼藥水", "sku": "F763630", "qty": 57, "unit": "瓶", "promo_code": None}
    snapshot = visit["repeat_last"]
    assert (snapshot["said"], snapshot["copied"], snapshot["except_names"]) == (SAID, 21, ["威鎮凝膠"])
    assert snapshot["order"] == {"order_no": "SO20261005-C001", "date": "2026-10-05"}
    assert [c["text"] for c in snapshot["changes"]] == [
        "中口這期沒了，只剩小口（買 22 送 1，$3,080）", "從買 10 送 2 變成買 15 送 2，一口 $800 → $1,200",
    ]
    assert snapshot["relative"] == [{"sku": "F749579", "promo_code": premium, "last_qty": 1, "delta": 1}]
    # 意向沒有自己的原文，用「跟上次一樣」那句
    assert visit["sources"]["intent"] == SAID and visit["error_message"] is None

    confirmed = client.post(f"/api/visits/{visit['id']}/confirm").json()
    assert statuses(confirmed)["sap"] == "success"
    with engine.connect() as conn:
        jin = conn.execute(
            text("SELECT packs, amount FROM sap_quotation_draft WHERE visit_id = :v AND sku = 'C130082'"), {"v": visit["id"]}
        ).one()
    # 金舒胃平小口照這期的條件：一口 1,200 × 3 口
    assert (jin.packs, float(jin.amount)) == (3, 3600)


def test_same_as_last_time_for_a_customer_who_never_ordered(client, providers, monkeypatch):
    monkeypatch.setattr(last_order, "build", lambda session, customer: None)
    spoken = [{"product_text": "魚油", "sku": "HS-FO30", "qty": 20, "unit": "盒", "promo_code": None}]
    visit = draft(client, providers, RepeatExtractor({"all": True, "except_skus": [], "relative": []}, intent=spoken))
    assert visit["fields"]["intent"] == spoken
    assert visit["error_message"] == repeat_order.EMPTY_NOTE and visit["repeat_last"]["empty"] is True


def test_a_malformed_repeat_from_the_ai_falls_into_the_failure_path(client, providers):
    # 相對加減少了 delta：不能讓它悄悄當成 0 展開
    visit = draft(client, providers, RepeatExtractor({
        "all": True, "except_skus": [],
        "relative": [{"product_text": "Premium 小口", "sku": "F749579", "promo_code": None}],
    }))
    assert visit["error_message"].startswith("欄位沒有自動整理出來")
    assert "relative/0" in visit["error_message"] and "delta" in visit["error_message"]  # 驗證訊息，不是展開時才炸的 KeyError
    assert visit["repeat_last"] is None and visit["fields"]["intent"] is None


def test_no_snapshot_without_same_as_last_time_and_it_is_rebuilt_on_retyping(client, providers):
    visit = draft(client, providers, RepeatExtractor({"all": True, "except_skus": [], "relative": []}))
    assert visit["repeat_last"]["all"] is True
    # 業務改了逐字稿重新整理：這次沒講跟上次一樣，快照跟著清掉
    providers(extractor=FakeExtractor())
    client.post(f"/api/visits/{visit['id']}/transcript", json={"text": TRANSCRIPT})
    run_jobs()
    assert client.get(f"/api/visits/{visit['id']}").json()["repeat_last"] is None

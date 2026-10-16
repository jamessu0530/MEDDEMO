"""名稱候選只做召回；不改逐字稿、不把近音或共同別名當成確定品項。"""

from datetime import date
from types import SimpleNamespace

from app.services import extraction
from app.services.scope import Scope
from app.services.speech_names import NameMatcher, customer_candidates, customer_terms


def test_names_keep_original_spelling_for_source_quotes():
    transcript = "今天去臺北的康泰忠孝店，訂Ａｍｌｏｄｉｐｉｎｅ。"
    matcher = NameMatcher(transcript)
    assert matcher.match(customer_terms("康泰連鎖藥局 · 忠孝店")).quote == "康泰忠孝店"
    match = matcher.match(["Amlodipine"])
    assert match.kind == "exact" and match.quote == "Ａｍｌｏｄｉｐｉｎｅ"
    assert matcher.match(["台北"]).quote == "臺北"


def test_phonetic_candidates_do_not_rewrite_taiwanese_or_negation():
    transcript = "今仔日去康太中孝店，毋愛十盒，欲二十盒。"
    match = NameMatcher(transcript).match(customer_terms("康泰連鎖藥局 · 忠孝店"))
    assert match.kind == "phonetic" and match.quote == "康太中孝店"
    assert match.quote in transcript and "毋愛十盒，欲二十盒" in transcript
    assert NameMatcher("推貨").match(["退貨"]) is None


def test_english_names_require_word_boundaries_but_allow_normal_spaces():
    assert NameMatcher("We need Zan, twenty boxes.").match(["Zan"]).quote == "Zan"
    assert NameMatcher("tizanidine").match(["Zan"]) is None
    assert NameMatcher("不要Omega-3，要Metformin。").match(["Metformin"]).quote == "Metformin"
    assert NameMatcher("RX-AML50").match(["RX-AML5"]) is None
    assert NameMatcher("15mg").match(["5mg"]) is None
    assert NameMatcher("ｔｉＺａｎｉｄｉｎｅ").match(["Zan"]) is None


def test_multiple_branches_stay_candidates_and_use_real_source_text():
    session = SimpleNamespace(execute=lambda query: [
        ("C1", "康泰連鎖藥局 · 忠孝店"), ("C2", "福安連鎖藥局 · 忠孝店"), ("C3", "福安連鎖藥局 · 板橋店"),
    ])
    found = customer_candidates(session, "忠孝店欲閣訂魚油。", Scope.everything())
    assert {c["id"] for c in found} == {"C1", "C2"}
    assert all(c["quote"] == "忠孝店" for c in found)
    found = customer_candidates(session, "今天去福安板橋店。", Scope.everything())
    assert found[0]["id"] == "C3" and found[0]["quote"] == "福安板橋店"


def test_catalog_search_adds_noncommon_products_and_keeps_ambiguous_sizes():
    rows = [
        ("COMMON", "魚油 30 入", "盒", ["魚油"], True),
        ("RARE5", "虎讚 5MG", "盒", ["虎讚"], False),
        ("RARE20", "虎讚 20MG", "盒", ["虎讚"], False),
        ("CALCIUM", "中化360海藻鈣錠 60錠", "盒", [], False),
        ("UNRELATED", "日本牙刷", "支", [], False),
    ]
    session = SimpleNamespace(execute=lambda query: rows)
    hints = extraction.product_hints(session, "虎讚跟海藻鈣各十盒。")
    assert {h.sku for h in hints} == {"COMMON", "RARE5", "RARE20", "CALCIUM"}


def test_an_overflowing_ambiguous_group_does_not_look_like_a_unique_product():
    rows = [(f"P{i}", f"護膝規格{i}", "雙", ["護膝"], False) for i in range(extraction.MAX_EXTRA_PRODUCTS + 1)]
    assert extraction.product_hints(SimpleNamespace(execute=lambda query: rows), "護膝一雙") == []


def test_guessed_skus_outside_candidates_are_cleared_without_changing_quantity():
    hint = extraction.ProductHint("KNOWN", "魚油", "盒", [])
    item = {"product_text": "某種品項", "sku": "GUESSED", "qty": 20, "unit": "盒", "promo_code": "P1"}
    assert extraction.drop_unknown_products([item], [hint]) == [{**item, "sku": None, "promo_code": None}]


def test_taiwanese_name_check_attaches_original_audio_to_the_existing_extraction_call():
    sent = []
    fields = extraction.empty_fields()
    fields["intent"] = [{"product_text": "尾鎮", "sku": "D120013", "qty": 2, "unit": "支", "promo_code": None}]

    class LLM:
        def json(self, **kwargs):
            sent.append(kwargs)
            return {"fields": fields, "sources": {"intent": "尾鎮兩支"}, "repeat_last": None}

    audio = (b"original-audio", "audio/m4a")
    result = extraction.LLMFieldExtractor(LLM()).extract(
        "毋愛十支，欲尾鎮兩支。", date(2026, 10, 16),
        [extraction.ProductHint("D120013", "威鎮凝膠", "支", ["威鎮"])],
        name_audio=audio, name_terms=["威鎮", "康泰忠孝店"],
    )
    assert len(sent) == 1 and sent[0]["media"] == [audio]
    assert "康泰忠孝店" in sent[0]["prompt"] and "近音候選不能直接當答案" in sent[0]["prompt"]
    assert result.sources["intent"] == "尾鎮兩支" and result.fields["intent"][0]["qty"] == 2


def test_without_audio_the_extractor_remains_text_only():
    class LLM:
        def json(self, **kwargs):
            assert "media" not in kwargs
            return {"fields": extraction.empty_fields(), "sources": {}, "repeat_last": None}

    extraction.LLMFieldExtractor(LLM()).extract("例行拜訪。", date(2026, 10, 16), [])

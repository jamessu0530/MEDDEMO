"""內部文件與知識評測題的檢查。

文件是知識查詢的唯一依據：格式要一致、不能有醫療內容；評測題的關鍵詞要真的出現在指定的小節，
量出來的正確率才能拿去當出場條件的數字。
"""

import json
from pathlib import Path

import pytest

from app.services.documents import DOCUMENTS_DIR, parse_document

ROOT = Path(__file__).resolve().parents[2]
QUESTIONS = ROOT / "data" / "eval" / "knowledge_questions.json"
DOC_TYPES = {"作業規範", "合約條件", "產品資訊", "業務守則"}
# 文件是展示用的虛構內容，不能出現可能被當成真實用藥建議的字眼
MEDICAL_WORDS = ("劑量", "副作用", "適應症", "禁忌", "療效", "每日服用", "治療")

DOCS = sorted(DOCUMENTS_DIR.glob("*.md"))
pytestmark = pytest.mark.skipif(not DOCS, reason="data/documents 還沒有文件")


@pytest.mark.parametrize("path", DOCS, ids=lambda p: p.name)
def test_document_follows_the_format_and_has_no_medical_content(path):
    text = path.read_text(encoding="utf-8")
    sections = parse_document(path)
    assert "展示用虛構內容" in text
    assert 3 <= len(sections) <= 6
    assert sections[0].doc_type in DOC_TYPES
    assert all(section.content for section in sections)
    assert [word for word in MEDICAL_WORDS if word in text] == []


@pytest.mark.skipif(not QUESTIONS.exists(), reason="knowledge_questions.json 還沒寫好")
def test_knowledge_questions_point_at_real_sections():
    data = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    assert len(data["answerable"]) == 10
    assert len(data["out_of_scope"]) == 10
    sections = {(s.source_name, s.section): s.content for path in DOCS for s in parse_document(path)}
    for item in data["answerable"]:
        content = sections[(item["source"], item["section"])]
        missing = [phrase for phrase in item["must_include"] if phrase not in content]
        assert missing == [], (item["id"], missing)
    assert len({item["source"] for item in data["answerable"]}) >= 8

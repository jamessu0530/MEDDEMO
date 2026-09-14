"""檢索：關鍵字腿、向量腿（Postgres）與 HybridRetriever 並行融合。

關鍵字腿、向量腿是 MEDDEMO 自己的（CARE 是 MongoDB Atlas，這裡是 Postgres），
按 task-4-brief 給的兩個測試逐字搬過來。`HybridRetriever` 本身照搬 CARE
`app/services/rag/retriever.py`，融合測試移植自
CARE/tests/unit/services/rag/test_retriever.py 裡 `HybridRetriever` 那一段
（`_stub_retriever`／`_d`／`_slow_retriever` 改用 task-4-brief 给的
`Leg`／`doc` 寫法，行為相同）。

刪掉／未搬的測試與原因：
- `test_ensure_collection_creates_motor_collection_once`、
  `test_warmup_touches_the_connection`、
  `test_hybrid_warmup_reports_failure_without_raising`：Mongo 專屬的
  warmup／collection 快取，MEDDEMO 的兩條腿直接開 SQLAlchemy Session，
  沒有這個概念；task-4-brief 也明講 HybridRetriever 移植時要「刪 warmup」。
- `test_retriever_rejects_empty_embedding`、`test_retriever_rejects_wrong_dimension`、
  `test_retriever_filters_by_min_score`、`test_retriever_keeps_low_score_docs_by_default`、
  `test_retriever_still_honours_explicit_min_score`、
  `test_vector_retriever_projects_and_exposes_original_title`、
  `test_vector_retriever_projects_and_exposes_verdict`、
  `test_vector_retriever_verdict_metadata_is_none_for_non_tfc_docs`、
  `test_text_retriever_builds_search_pipeline`、
  `test_text_retriever_also_matches_title_when_configured`、
  `test_text_retriever_falls_back_to_content_only_without_title_field`、
  `test_text_retriever_keeps_low_bm25_scores`、
  `test_text_retriever_skips_blank_text_and_empty_query`、
  `test_text_retriever_requires_text_index_name`、
  `test_text_retriever_projects_and_exposes_original_title`、
  `test_text_retriever_projects_and_exposes_verdict`：
  這些驗的是 `$vectorSearch`／`$search` pipeline 組裝、`verdict`／
  `original_title` 投影、`min_score` 門檻、title boost，都是 Mongo Atlas
  Search 專屬欄位與查詢語法。MEDDEMO 的 `KeywordRetriever`／`VectorRetriever`
  查的是 `DocumentChunk`，沒有 `verdict`／`original_title`／`min_score`，
  以 task-4-brief 給的兩個直查測試資料庫的測試取代。
- `test_hybrid_applies_limit_and_passes_query_to_both`：驗證 `ainvoke` 有把
  query 原封不動傳給兩條腿，這裡用 task-4-brief 的 `Leg` 假腿同樣可以驗，
  併入 `test_hybrid_weights_vector_0_6_and_text_0_4`（傳入的 query 就是
  兩條腿唯一拿到的引數）不必獨立成一個測試。
- `test_hybrid_defaults_to_rrf_so_existing_deployments_are_unchanged`：CARE
  的預設融合模式是 rrf（既有線上行為不能變）；MEDDEMO 沒有既有線上流量，
  task-4-brief 明講預設要改成 `FUSION_MODE_CONVEX`，改成
  `test_hybrid_defaults_to_convex_fusion` 驗新的預設值。
"""

import asyncio

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.crag.documents import Document
from app.services.crag.rank_fusion import FUSION_MODE_CONVEX, FUSION_MODE_RRF
from app.services.crag.retriever import (
    DEFAULT_LEG_TIMEOUT_SECONDS,
    FUSION_ALPHA,
    RETRIEVE_CANDIDATES,
    TEXT_SOURCE_NAME,
    VECTOR_SOURCE_NAME,
    HybridRetriever,
    KeywordRetriever,
    VectorRetriever,
)


def test_keyword_leg_scores_the_right_section_first(engine, docs):
    hits = KeywordRetriever(engine).invoke("近效期的東西要多久前申請退貨")
    assert hits[0].metadata["section"] == "近效期退貨的申請期限"
    assert hits[0].metadata["score"] > 0


def test_keyword_leg_returns_empty_when_query_has_no_tokens(engine, docs):
    """空白或純標點問不出任何 token，直接回空清單，不必打資料庫。"""
    assert KeywordRetriever(engine).invoke("？？？") == []


async def test_keyword_leg_ainvoke_matches_invoke(engine, docs):
    sync_hits = KeywordRetriever(engine).invoke("近效期的東西要多久前申請退貨")
    async_hits = await KeywordRetriever(engine).ainvoke("近效期的東西要多久前申請退貨")
    assert [d.metadata["chunk_id"] for d in async_hits] == [d.metadata["chunk_id"] for d in sync_hits]


def test_vector_leg_is_empty_without_an_embedder(engine, docs):
    assert VectorRetriever(engine, None).invoke("任何問題") == []


def test_vector_leg_scores_by_cosine_distance(engine, docs):
    """有 embedder 時向量腿要真的查到資料庫裡的段落，分數是 1 - cosine_distance。

    seed 資料沒有 embedding（EMBEDDING_PROVIDER 清空），這裡直接灌一筆方向相同的
    向量（cosine_distance = 0）與一筆方向垂直的向量（cosine_distance = 1），
    驗證向量腿真的照 cosine 距離排序、分數等於 1 - distance。
    """
    with Session(engine) as session:
        chunk_id = session.execute(text("SELECT id FROM document_chunk ORDER BY id LIMIT 1")).scalar_one()
        other_id = session.execute(text("SELECT id FROM document_chunk WHERE id != :id ORDER BY id LIMIT 1"), {"id": chunk_id}).scalar_one()
        session.execute(text("UPDATE document_chunk SET embedding = '[1,0,0]' WHERE id = :id"), {"id": chunk_id})
        session.execute(text("UPDATE document_chunk SET embedding = '[0,1,0]' WHERE id = :id"), {"id": other_id})
        session.commit()

    hits = VectorRetriever(engine, lambda _query: [1.0, 0.0, 0.0]).invoke("任何問題")
    assert hits[0].metadata["chunk_id"] == chunk_id
    assert hits[0].metadata["score"] == pytest.approx(1.0)
    assert any(h.metadata["chunk_id"] == other_id and h.metadata["score"] == pytest.approx(0.0) for h in hits)


# ── HybridRetriever：假腿驗融合行為，不碰資料庫 ──────────────────────────


class Leg:
    def __init__(self, docs=(), error=None, delay=0.0):
        self.docs, self.error, self.delay = list(docs), error, delay

    async def ainvoke(self, query):
        await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return self.docs


def doc(chunk_id, score):
    return Document(f"段落 {chunk_id}", {"id": str(chunk_id), "chunk_id": chunk_id, "score": score})


async def test_hybrid_weights_vector_0_6_and_text_0_4():
    retriever = HybridRetriever(
        vector_retriever=Leg([doc(1, 0.9), doc(2, 0.1)]), text_retriever=Leg([doc(2, 5.0), doc(1, 1.0)])
    )
    fused = await retriever.ainvoke("問題")
    assert [d.metadata["chunk_id"] for d in fused] == [1, 2]
    assert fused[0].metadata["fusion_weights"] == {"vector": 0.6, "text": 0.4}


async def test_a_slow_or_broken_leg_falls_back_to_the_other(monkeypatch):
    retriever = HybridRetriever(
        vector_retriever=Leg([doc(1, 0.9)], delay=1.0), text_retriever=Leg([doc(2, 3.0)]), leg_timeout_seconds=0.05
    )
    assert [d.metadata["chunk_id"] for d in await retriever.ainvoke("問題")] == [2]
    broken = HybridRetriever(vector_retriever=Leg(error=RuntimeError("壞")), text_retriever=Leg([doc(2, 3.0)]))
    assert [d.metadata["chunk_id"] for d in await broken.ainvoke("問題")] == [2]


async def test_hybrid_fuses_both_sources():
    """移植自 CARE test_hybrid_fuses_both_sources：兩邊都命中的浮上來。

    這是 RRF 天生的性質（rank_fusion.py 模組 docstring 的取捨 3：凸組合沒有
    這個先天性質，min-max 正規化下「vector 墊底、text 第一」可能贏過
    「兩腿都中段」），MEDDEMO 預設改成 convex 之後這個測試若沿用預設會失敗
    ——這裡明確傳 `fusion_mode=FUSION_MODE_RRF` 才是忠於原測試在驗的行為：
    HybridRetriever 真的把兩條腿的結果聯集起來、並集去重、metadata 記對
    retrievers。convex 模式下「兩腿都命中」的行為由 `test_hybrid_convex_mode_uses_alpha`
    另外驗證。
    """
    hybrid = HybridRetriever(
        vector_retriever=Leg([doc("only-vector", 0.9), doc("both", 0.5)]),
        text_retriever=Leg([doc("both", 5.0), doc("only-text", 1.0)]),
        fusion_mode=FUSION_MODE_RRF,
    )
    docs_ = await hybrid.ainvoke("乙醯胺酚劑量")
    ids = [d.metadata["chunk_id"] for d in docs_]
    assert ids[0] == "both"
    assert set(ids) == {"both", "only-vector", "only-text"}
    assert docs_[0].metadata["retrievers"] == [VECTOR_SOURCE_NAME, TEXT_SOURCE_NAME]


async def test_hybrid_returns_empty_when_both_legs_fail():
    """移植自 CARE test_hybrid_returns_empty_when_both_fail。"""
    hybrid = HybridRetriever(vector_retriever=Leg(error=RuntimeError("a")), text_retriever=Leg(error=RuntimeError("b")))
    assert await hybrid.ainvoke("查詢") == []


async def test_hybrid_returns_empty_when_both_legs_time_out():
    """移植自 CARE test_hybrid_returns_empty_when_both_legs_time_out。"""
    hybrid = HybridRetriever(
        vector_retriever=Leg([doc("v1", 1.0)], delay=5.0),
        text_retriever=Leg([doc("t1", 1.0)], delay=5.0),
        leg_timeout_seconds=0.05,
    )
    assert await hybrid.ainvoke("查詢") == []


async def test_hybrid_leg_timeout_zero_means_unlimited():
    """移植自 CARE test_hybrid_leg_timeout_zero_means_unlimited：0 表示不設限，慢腿也等得到。"""
    hybrid = HybridRetriever(
        vector_retriever=Leg([doc("v1", 1.0)], delay=0.1),
        text_retriever=Leg([doc("t1", 1.0)]),
        leg_timeout_seconds=0,
    )
    docs_ = await hybrid.ainvoke("查詢")
    assert {d.metadata["chunk_id"] for d in docs_} == {"v1", "t1"}


def test_hybrid_defaults_to_convex_fusion():
    """task-4-brief：預設 fusion_mode 改成 convex（CARE 預設 rrf 是為了不動既有線上行為，
    MEDDEMO 沒有既有流量，直接採用凸組合）。"""
    hybrid = HybridRetriever(vector_retriever=Leg(), text_retriever=Leg())
    assert hybrid.fusion_mode == FUSION_MODE_CONVEX
    assert hybrid.alpha == FUSION_ALPHA
    assert hybrid.limit == RETRIEVE_CANDIDATES
    assert hybrid.leg_timeout_seconds == DEFAULT_LEG_TIMEOUT_SECONDS


async def test_hybrid_convex_mode_uses_alpha():
    """移植自 CARE test_hybrid_convex_mode_uses_alpha：alpha 是向量腿的權重，方向要釘住。"""
    vector_only = doc("v-only", 0.9)
    text_only = doc("t-only", 9.0)

    vector_heavy = HybridRetriever(
        vector_retriever=Leg([vector_only]), text_retriever=Leg([text_only]), fusion_mode=FUSION_MODE_CONVEX, alpha=0.9
    )
    text_heavy = HybridRetriever(
        vector_retriever=Leg([vector_only]), text_retriever=Leg([text_only]), fusion_mode=FUSION_MODE_CONVEX, alpha=0.1
    )
    assert (await vector_heavy.ainvoke("查詢"))[0].metadata["chunk_id"] == "v-only"
    assert (await text_heavy.ainvoke("查詢"))[0].metadata["chunk_id"] == "t-only"


async def test_hybrid_can_use_rrf_mode():
    """凸組合是新預設，但 rrf 仍是合法選項（rank_fusion 兩種模式都要能被 HybridRetriever 用到）。"""
    hybrid = HybridRetriever(vector_retriever=Leg([doc("a", 0.9)]), text_retriever=Leg([doc("b", 9.0)]), fusion_mode=FUSION_MODE_RRF)
    docs_ = await hybrid.ainvoke("查詢")
    assert docs_[0].metadata["fusion"] == "rrf"


def test_hybrid_rejects_unknown_fusion_mode_and_out_of_range_alpha():
    """移植自 CARE test_hybrid_rejects_unknown_fusion_mode_and_out_of_range_alpha：
    設定打錯要在啟動時就炸，不能悄悄以錯誤的比重上線。"""
    with pytest.raises(ValueError, match="unknown fusion_mode"):
        HybridRetriever(vector_retriever=Leg(), text_retriever=Leg(), fusion_mode="rff")
    with pytest.raises(ValueError, match="alpha"):
        HybridRetriever(vector_retriever=Leg(), text_retriever=Leg(), alpha=1.5)

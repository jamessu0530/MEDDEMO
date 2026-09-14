"""混合檢索（SDD Iteration 2）：關鍵字與語意兩路各自排序，再用 RRF 融合。"""

import re
from dataclasses import dataclass

from sqlalchemy import func, literal_column, select
from sqlalchemy.orm import Session

from app.models import DocumentChunk

CJK_RUN = re.compile(r"[㐀-鿿豈-﫿]+")
WORD = re.compile(r"[A-Za-z0-9]+")
# RRF 的 k 取 60，沿用原始論文的設定（Cormack、Clarke、Büttcher，SIGIR 2009）
RRF_K = 60
# 兩路各取前 20 段再融合：任一路排在前面的段落都有機會進到最後的前幾名
CANDIDATES_PER_CHANNEL = 20
# 文字搜尋設定必須是 regconfig 型別；寫成綁定參數會變成 varchar，Postgres 會找不到對應的函式
SIMPLE = literal_column("'simple'::regconfig")


@dataclass
class Hit:
    chunk_id: int
    source_name: str
    doc_title: str
    section: str
    content: str
    score: float


def keyword_tokens(text: str) -> list[str]:
    """中文切成相鄰兩字（SDD：中文以 n-gram 斷詞），英數字整個字轉小寫。只有一個字的中文詞保留單字。"""
    tokens: list[str] = []
    for run in CJK_RUN.findall(text):
        tokens += [run] if len(run) == 1 else [run[i : i + 2] for i in range(len(run) - 1)]
    tokens += [word.lower() for word in WORD.findall(text)]
    return list(dict.fromkeys(tokens))


def to_tsvector_input(text: str) -> str:
    return " ".join(keyword_tokens(text))


def keyword_search(session: Session, query: str, limit: int = CANDIDATES_PER_CHANNEL) -> list[int]:
    tokens = keyword_tokens(query)
    if not tokens:
        return []
    # 任一個詞命中就算候選，排序看命中的多寡與密度
    tsquery = func.to_tsquery(SIMPLE, " | ".join(f"'{t}'" for t in tokens))
    rank = func.ts_rank_cd(DocumentChunk.search_tokens, tsquery)
    stmt = (
        select(DocumentChunk.id)
        .where(DocumentChunk.search_tokens.op("@@")(tsquery))
        .order_by(rank.desc(), DocumentChunk.id)
        .limit(limit)
    )
    return list(session.scalars(stmt))


def vector_search(session: Session, query_embedding: list[float], limit: int = CANDIDATES_PER_CHANNEL) -> list[int]:
    stmt = (
        select(DocumentChunk.id)
        .where(DocumentChunk.embedding.is_not(None))
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding), DocumentChunk.id)
        .limit(limit)
    )
    return list(session.scalars(stmt))


def reciprocal_rank_fusion(rankings: list[list[int]], k: int = RRF_K) -> list[tuple[int, float]]:
    scores: dict[int, float] = {}
    for ranking in rankings:
        for position, chunk_id in enumerate(ranking, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + position)
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))


def hybrid_search(session: Session, query: str, limit: int, query_embedding: list[float] | None = None) -> list[Hit]:
    """關鍵字一定跑；有 embedding 才加跑語意檢索。回傳融合後的前 limit 段。"""
    rankings = [keyword_search(session, query)]
    if query_embedding is not None:
        rankings.append(vector_search(session, query_embedding))
    fused = reciprocal_rank_fusion(rankings)[:limit]
    if not fused:
        return []
    chunks = {c.id: c for c in session.scalars(select(DocumentChunk).where(DocumentChunk.id.in_([cid for cid, _ in fused])))}
    return [
        Hit(cid, chunks[cid].source_name, chunks[cid].doc_title, chunks[cid].section, chunks[cid].chunk_content, score)
        for cid, score in fused
    ]

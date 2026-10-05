"""Hybrid retrieval (dense + full text, RRF) with optional cross-encoder reranking and abstention."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from functools import lru_cache

from app import db, llm
from app.config import get_settings

log = logging.getLogger(__name__)


@dataclass
class Passage:
    chunk_id: int
    document_id: str
    title: str
    source_url: str | None
    publisher: str | None
    state: str | None
    heading_path: str
    content: str
    dense_score: float
    text_score: float
    rrf_score: float
    rerank_score: float | None = None

    def citation(self, n: int) -> dict:
        return {"n": n, "title": self.title, "source_url": self.source_url, "publisher": self.publisher,
                "heading": self.heading_path, "chunk_id": self.chunk_id, "snippet": self.content[:280]}


@dataclass
class Retrieval:
    query: str
    passages: list[Passage]
    abstain: bool
    reason: str = ""


@lru_cache
def _cross_encoder():
    s = get_settings()
    if s.reranker == "none":
        return None
    try:
        from sentence_transformers import CrossEncoder
    except ImportError:
        if s.reranker != "auto":
            log.warning("sentence-transformers not installed; reranking disabled")
        return None
    return CrossEncoder(s.reranker_model, max_length=512)


def _rerank(query: str, passages: list[Passage]) -> list[Passage]:
    model = _cross_encoder()
    if model is None or not passages:
        return passages
    scores = model.predict([(query, p.content) for p in passages])
    for p, sc in zip(passages, scores, strict=True):
        p.rerank_score = float(sc)
    return sorted(passages, key=lambda p: p.rerank_score or 0, reverse=True)


async def retrieve(user_id: str, query: str, *, state: str | None = None, k: int = 5, candidates: int = 20) -> Retrieval:
    s = get_settings()
    english = await llm.to_english(query)
    vec = await llm.embed_query(english)
    async with db.as_user(user_id, read_only=True) as conn:
        rows = await db.fetch_all(
            conn,
            "select * from public.kb_hybrid_search(%s::extensions.vector, %s, %s, %s)",
            (db.vector_literal(vec), english, candidates, state),
        )
    passages = [
        Passage(r["chunk_id"], str(r["document_id"]), r["title"], r["source_url"], r["publisher"], r["state"],
                r["heading_path"], r["content"], r["dense_score"] or 0.0, r["text_score"] or 0.0, r["rrf_score"] or 0.0)
        for r in rows
    ]
    if not passages:
        return Retrieval(english, [], True, "No matching documents in the knowledge base.")
    passages = await asyncio.to_thread(_rerank, english, passages)
    top = passages[:k]
    best_dense = max((p.dense_score for p in top), default=0.0)
    if top[0].rerank_score is not None:
        abstain = top[0].rerank_score < -2.0 and best_dense < s.rag_min_dense
    else:
        abstain = best_dense < s.rag_min_dense and top[0].text_score == 0
    return Retrieval(english, top, abstain, "Retrieved passages are not relevant enough to answer reliably." if abstain else "")

"""Knowledge-base ingestion. Usage:
    python -m app.rag.ingest kb/            # ingest every .md file with front matter
    python -m app.rag.ingest https://... --title "..." --state GJ --scheme "..."
Re-ingesting identical content is a no-op; changed content creates a new version and retires the old one.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import re
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from app import db, llm
from app.rag.chunking import chunk_text


@dataclass
class SourceDoc:
    title: str
    text: str
    source_url: str | None = None
    publisher: str | None = None
    state: str | None = None
    scheme: str | None = None
    language: str = "en"
    effective_from: str | None = None
    effective_to: str | None = None
    meta: dict = field(default_factory=dict)


def parse_front_matter(raw: str) -> tuple[dict, str]:
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    meta = {}
    for line in raw[3:end].strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"').strip("'") or None
    return meta, raw[end + 4 :].lstrip()


def html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|nav|footer|header).*?</\1>", " ", html)
    html = re.sub(r"(?i)<h([1-6])[^>]*>", lambda m: "\n" + "#" * int(m.group(1)) + " ", html)
    html = re.sub(r"(?i)</(p|div|li|h[1-6]|tr|br)\s*>", "\n", html)
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def pdf_to_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join((page.extract_text() or "").strip() for page in reader.pages)


def load_markdown(path: Path) -> SourceDoc:
    meta, body = parse_front_matter(path.read_text(encoding="utf-8"))
    return SourceDoc(
        title=meta.get("title") or path.stem.replace("-", " ").title(), text=body, source_url=meta.get("source_url"),
        publisher=meta.get("publisher"), state=meta.get("state"), scheme=meta.get("scheme"),
        language=meta.get("language") or "en", effective_from=meta.get("effective_from"), effective_to=meta.get("effective_to"),
    )


async def load_url(url: str, **meta) -> SourceDoc:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as http:
        resp = await http.get(url, headers={"User-Agent": "CropRaidGuard-KB/1.0"})
        resp.raise_for_status()
    ctype = resp.headers.get("content-type", "")
    text = pdf_to_text(resp.content) if "pdf" in ctype or url.lower().endswith(".pdf") else html_to_text(resp.text)
    return SourceDoc(title=meta.pop("title", None) or url, text=text, source_url=url, **meta)


async def ingest(doc: SourceDoc) -> dict:
    text = doc.text.strip()
    if len(text) < 40:
        raise ValueError(f"document '{doc.title}' has too little text to index")
    sha = hashlib.sha256(text.encode()).hexdigest()
    chunks = chunk_text(text)
    async with db.service() as conn:
        existing = await db.fetch_one(conn, "select id from public.kb_documents where sha256 = %s", (sha,))
        if existing:
            return {"document_id": str(existing["id"]), "status": "unchanged", "chunks": len(chunks)}
    vectors = await llm.embed([c.content for c in chunks]) if chunks else []
    async with db.service() as conn:
        prev = await db.fetch_one(
            conn,
            "select id, version from public.kb_documents where title = %s and coalesce(source_url,'') = coalesce(%s,'')"
            " and is_active order by version desc limit 1",
            (doc.title, doc.source_url),
        )
        version = (prev["version"] + 1) if prev else 1
        if prev:
            await conn.execute("update public.kb_documents set is_active = false, effective_to = coalesce(effective_to, current_date) where id = %s", (prev["id"],))
        row = await db.fetch_one(
            conn,
            """insert into public.kb_documents (title, source_url, publisher, state, scheme, language, effective_from,
                 effective_to, version, sha256) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
            (doc.title, doc.source_url, doc.publisher, doc.state, doc.scheme, doc.language, doc.effective_from,
             doc.effective_to, version, sha),
        )
        doc_id = row["id"]
        async with conn.cursor() as cur:
            await cur.executemany(
                "insert into public.kb_chunks (document_id, chunk_index, heading_path, content, token_count, embedding)"
                " values (%s,%s,%s,%s,%s,%s::extensions.vector)",
                [(doc_id, c.index, c.heading_path, c.content, c.token_count, db.vector_literal(v)) for c, v in zip(chunks, vectors, strict=True)],
            )
    return {"document_id": str(doc_id), "status": "updated" if prev else "created", "version": version, "chunks": len(chunks)}


async def ingest_dir(path: Path) -> list[dict]:
    return [await ingest(load_markdown(f)) for f in sorted(path.glob("*.md"))]


async def _main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="directory of .md files, a file, or a URL")
    parser.add_argument("--title")
    parser.add_argument("--state")
    parser.add_argument("--scheme")
    parser.add_argument("--publisher")
    parser.add_argument("--effective-from")
    args = parser.parse_args()
    await db.open_pool()
    try:
        if args.source.startswith("http"):
            docs = [await load_url(args.source, title=args.title, state=args.state, scheme=args.scheme,
                                   publisher=args.publisher, effective_from=args.effective_from)]
        else:
            p = Path(args.source)
            docs = [load_markdown(f) for f in sorted(p.glob("*.md"))] if p.is_dir() else [load_markdown(p)]
        for d in docs:
            print(d.title, "->", await ingest(d))
    finally:
        await db.close_pool()


if __name__ == "__main__":
    asyncio.run(_main())

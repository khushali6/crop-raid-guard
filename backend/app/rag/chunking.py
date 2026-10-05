"""Structure-aware chunking: split on headings/clauses, keep the heading path, then pack to a token budget."""

from __future__ import annotations

import re
from dataclasses import dataclass

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
CLAUSE_RE = re.compile(r"^\s*((\d+(\.\d+)*[.)])|([a-z][.)])|(\([a-z0-9]+\)))\s+")


@dataclass
class Chunk:
    index: int
    heading_path: str
    content: str
    token_count: int


def approx_tokens(text: str) -> int:
    return max(1, int(len(text.split()) * 1.35))


def _sections(text: str) -> list[tuple[str, str]]:
    path: list[str] = []
    out: list[tuple[str, list[str]]] = [("", [])]
    for line in text.splitlines():
        m = HEADING_RE.match(line)
        if m:
            level = len(m.group(1))
            path = path[: level - 1] + [m.group(2).strip()]
            out.append((" > ".join(path), []))
        else:
            out[-1][1].append(line)
    return [(h, "\n".join(lines).strip()) for h, lines in out if "\n".join(lines).strip()]


def _paragraphs(body: str) -> list[str]:
    paras: list[str] = []
    buf: list[str] = []
    for line in body.splitlines():
        if not line.strip() or CLAUSE_RE.match(line):
            if buf:
                paras.append(" ".join(buf).strip())
                buf = []
        if line.strip():
            buf.append(line.strip())
    if buf:
        paras.append(" ".join(buf).strip())
    return [p for p in paras if p]


def chunk_text(text: str, max_tokens: int = 450, overlap_tokens: int = 60) -> list[Chunk]:
    chunks: list[Chunk] = []
    for heading, body in _sections(text):
        current: list[str] = []
        size = 0
        for para in _paragraphs(body):
            t = approx_tokens(para)
            if t > max_tokens:
                words = para.split()
                step = int(max_tokens / 1.35)
                pieces = [" ".join(words[i : i + step]) for i in range(0, len(words), max(step - 40, 1))]
            else:
                pieces = [para]
            for piece in pieces:
                pt = approx_tokens(piece)
                if current and size + pt > max_tokens:
                    chunks.append(_make(len(chunks), heading, current))
                    tail = " ".join(" ".join(current).split()[-int(overlap_tokens / 1.35):])
                    current, size = ([tail] if tail else []), approx_tokens(tail) if tail else 0
                current.append(piece)
                size += pt
        if current:
            chunks.append(_make(len(chunks), heading, current))
    return chunks


def _make(index: int, heading: str, parts: list[str]) -> Chunk:
    body = "\n".join(parts).strip()
    content = f"{heading}\n{body}" if heading else body
    return Chunk(index, heading, content, approx_tokens(content))

"""Guardrails shared by agents, MCP tools and the pipeline."""

from __future__ import annotations

import json
import re
from typing import Any

INJECTION_PATTERNS = [
    r"ignore (all|any|the)? ?(previous|prior|above) (instructions|prompts?)",
    r"disregard (all|any|the)? ?(previous|prior|above)",
    r"you are now",
    r"system prompt",
    r"reveal (your|the) (instructions|prompt|keys?)",
    r"(call|use|invoke) the \w+ tool",
    r"approve (this|the) claim",
    r"<\s*/?\s*(system|assistant|tool|untrusted_data)\s*>",
]
_INJECTION_RE = re.compile("|".join(INJECTION_PATTERNS), re.IGNORECASE)
MAX_INPUT_CHARS = 2000


def looks_like_injection(text: str | None) -> bool:
    return bool(text and _INJECTION_RE.search(text))


def fence_untrusted(text: str | None, limit: int = 600) -> str:
    """Wrap stored, user- or model-generated text so the LLM treats it as data, never as instructions."""
    if not text:
        return ""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)[:limit]
    cleaned = re.sub(r"<\s*/?\s*untrusted_data[^>]*>", "", cleaned, flags=re.IGNORECASE)
    flag = ' flagged="possible-injection"' if looks_like_injection(cleaned) else ""
    return f"<untrusted_data{flag}>{cleaned}</untrusted_data>"


def sanitize_tool_output(value: Any) -> Any:
    """Recursively fence free-text fields that originate from users or models."""
    risky = {"description", "vlm_caption", "farmer_notes", "notes", "draft_text", "caption", "content", "body"}
    if isinstance(value, dict):
        return {k: (fence_untrusted(v) if k in risky and isinstance(v, str) else sanitize_tool_output(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_tool_output(v) for v in value]
    return value


def check_user_input(text: str) -> str | None:
    """Return a refusal reason, or None when the message may proceed."""
    if not text or not text.strip():
        return "Please type a question."
    if len(text) > MAX_INPUT_CHARS:
        return f"Please keep questions under {MAX_INPUT_CHARS} characters."
    return None


_NUM_RE = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)(?![\w])")
# Numbers that may appear without coming from a tool: list markers, the 72-hour window, citation markers, years, clock parts.
_ALLOWED = {"0", "1", "2", "3", "4", "5", "7", "24", "72", "100"}


def _numbers(text: str) -> set[str]:
    out = set()
    for m in _NUM_RE.findall(text):
        n = m.replace(",", "")
        if n.endswith(".0"):
            n = n[:-2]
        out.add(n)
    return out


def unsupported_numbers(answer: str, evidence: list[Any]) -> set[str]:
    """Numbers in the answer that do not appear in any tool output or retrieved passage."""
    blob = " ".join(json.dumps(e, default=str, ensure_ascii=False) if not isinstance(e, str) else e for e in evidence)
    known = _numbers(blob)
    # Allow percentages of known fractions (e.g. 0.94 -> 94) and rounded values.
    for n in list(known):
        try:
            f = float(n)
        except ValueError:
            continue
        if 0 < f <= 1:
            known.add(str(int(round(f * 100))))
        known.add(str(int(round(f))))
    stripped = re.sub(r"\[\d+\]", " ", answer)  # citation markers
    stripped = re.sub(r"\b\d{1,2}:\d{2}\b", " ", stripped)  # clock times are checked via timestamps
    stripped = re.sub(r"\b(19|20)\d{2}\b", " ", stripped)  # years
    stripped = re.sub(r"\b\d{1,2}\s?(AM|PM|am|pm)\b", " ", stripped)
    return {n for n in _numbers(stripped) if n not in known and n not in _ALLOWED}

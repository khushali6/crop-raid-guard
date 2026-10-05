"""Gemini client wrapper with retries and per-run usage accounting."""

from __future__ import annotations

import asyncio
import json
import logging
import math
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.config import get_settings

log = logging.getLogger(__name__)

LANGUAGE_NAMES = {"en": "English", "hi": "Hindi", "gu": "Gujarati"}


class LLMUnavailable(RuntimeError):
    pass


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0
    by_model: dict[str, int] = field(default_factory=dict)

    @property
    def cost_usd(self) -> float:
        s = get_settings()
        return round(self.input_tokens / 1e6 * s.llm_price_in + self.output_tokens / 1e6 * s.llm_price_out, 6)


_usage: ContextVar[Usage | None] = ContextVar("llm_usage", default=None)
_client: genai.Client | None = None


def start_usage() -> Usage:
    usage = Usage()
    _usage.set(usage)
    return usage


def _record(model: str, resp: Any) -> None:
    usage = _usage.get()
    meta = getattr(resp, "usage_metadata", None)
    if usage is None or meta is None:
        return
    usage.calls += 1
    usage.input_tokens += meta.prompt_token_count or 0
    usage.output_tokens += (meta.candidates_token_count or 0) + (meta.thoughts_token_count or 0)
    usage.by_model[model] = usage.by_model.get(model, 0) + 1


def client() -> genai.Client:
    global _client
    settings = get_settings()
    if not settings.gemini_api_key:
        raise LLMUnavailable("GEMINI_API_KEY is not configured")
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


async def _with_retry(fn, *, attempts: int = 4):
    delay = 2.0
    for attempt in range(attempts):
        try:
            return await fn()
        except genai_errors.APIError as exc:
            code = getattr(exc, "code", None)
            if code in (429, 500, 503) and attempt < attempts - 1:
                log.warning("gemini %s, retrying in %.0fs", code, delay)
                await asyncio.sleep(delay)
                delay *= 2
                continue
            raise


async def generate(
    contents: Any,
    *,
    system: str | None = None,
    model: str | None = None,
    tools: list[types.Tool] | None = None,
    json_schema: dict | None = None,
    temperature: float = 0.2,
    max_output_tokens: int = 2048,
) -> types.GenerateContentResponse:
    settings = get_settings()
    model = model or settings.llm_model
    config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        tools=tools,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True) if tools else None,
        response_mime_type="application/json" if json_schema else None,
        response_json_schema=json_schema,
    )

    async def call():
        return await client().aio.models.generate_content(model=model, contents=contents, config=config)

    resp = await _with_retry(call)
    _record(model, resp)
    return resp


async def generate_json(prompt: str, schema: dict, *, system: str | None = None, model: str | None = None) -> dict:
    resp = await generate(prompt, system=system, model=model, json_schema=schema, temperature=0)
    try:
        return json.loads(resp.text or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"model returned invalid JSON: {resp.text!r:.200}") from exc


async def generate_text(prompt: Any, *, system: str | None = None, model: str | None = None, temperature: float = 0.2) -> str:
    resp = await generate(prompt, system=system, model=model, temperature=temperature)
    return (resp.text or "").strip()


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


async def embed(texts: list[str], *, task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    settings = get_settings()
    out: list[list[float]] = []
    for i in range(0, len(texts), 90):
        batch = texts[i : i + 90]

        async def call(batch=batch):
            return await client().aio.models.embed_content(
                model=settings.embed_model,
                contents=batch,
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=settings.embed_dim),
            )

        resp = await _with_retry(call)
        out.extend(_normalize(list(e.values or [])) for e in resp.embeddings or [])
    if len(out) != len(texts):
        raise RuntimeError("embedding count mismatch")
    return out


async def embed_query(text: str) -> list[float]:
    return (await embed([text], task_type="RETRIEVAL_QUERY"))[0]


async def caption_image(image: bytes, prompt: str) -> str:
    part = types.Part.from_bytes(data=image, mime_type="image/jpeg")
    return await generate_text([part, prompt], model=get_settings().llm_router_model, temperature=0)


async def transcribe_audio(audio: bytes, mime_type: str) -> str:
    part = types.Part.from_bytes(data=audio, mime_type=mime_type)
    return await generate_text(
        [part, "Transcribe this voice note verbatim in its original language and script. Return only the transcript."],
        model=get_settings().llm_router_model,
        temperature=0,
    )


async def translate(text: str, target: str) -> str:
    if target == "en" or not text.strip():
        return text
    name = LANGUAGE_NAMES.get(target, "English")
    return await generate_text(
        f"Translate the following text to {name}. Keep numbers as Western digits, keep names, links and "
        f"markdown unchanged. Return only the translation.\n\n{text}",
        model=get_settings().llm_router_model,
        temperature=0,
    )


async def to_english(text: str) -> str:
    if text.isascii():
        return text
    return await generate_text(
        f"Translate this farmer's question to English. Return only the translation.\n\n{text}",
        model=get_settings().llm_router_model,
        temperature=0,
    )
